import {strict as assert} from 'node:assert';
import {mock} from 'bun:test';
import {randomUUID} from 'node:crypto';
import {encryptChatGptSession,normaliseChatGptSession} from '../src/lib/chatgpt-session.server';
import {continuationBody,historyMessages,mergeSnapshots} from '../src/lib/chatgpt-history-model';
process.env.CHATGPT_SESSION_ENCRYPTION_KEY='11'.repeat(32);
process.env.CHATGPT_DURABLE_HISTORY='1';
process.env.CHATGPT_PROXY_PUBLIC_ORIGIN='https://chatgpt.topratedseotools.com';
const origin=process.env.CHATGPT_PROXY_PUBLIC_ORIGIN;
const userA=randomUUID(),userB=randomUUID(),chatA=randomUUID(),chatB=randomUUID(),chatC=randomUUID();
const vault=(identity:string)=>encryptChatGptSession(normaliseChatGptSession(JSON.stringify({cookies:[{name:'__Secure-next-auth.session-token',value:identity,domain:'.chatgpt.com',path:'/'}]})));
const sessions=[userA,userB].map((user_id,i)=>({id:randomUUID(),user_id,source_kind:'grant',source_id:'grant'+i,status:'active',token_hash:'',device_fingerprint:String(i+1).repeat(32),expires_at:new Date(Date.now()+100000).toISOString(),provider_account_key:'account_1'}));
const tables:Record<string,any[]>={chatgpt_history_threads:[],chatgpt_history_links:[],chatgpt_history_resumes:[],chatgpt_conversation_owners:[],chatgpt_proxy_sessions:sessions,chatgpt_user_controls:sessions.map(s=>({user_id:s.user_id,status:'active',device_limit:2,provider_account_key:'account_1'})),chatgpt_devices:sessions.map(s=>({id:randomUUID(),user_id:s.user_id,device_fingerprint:s.device_fingerprint})),chatgpt_provider_accounts:[{account_key:'account_1',status:'stored',verified_at:new Date().toISOString(),encrypted_payload:vault('official-one')}],tool_settings:[{tool_slug:'chatgpt',enabled:true,one_click_auth_enabled:true}],tool_access_grants:sessions.map(s=>({id:s.source_id,user_id:s.user_id,tool_slug:'chatgpt',status:'active',expires_at:null}))};
let dbFailure=false;
const database={from(table:string){
 const checks:((r:any)=>boolean)[]=[];let mutation:string|undefined,payload:any,options:any,offset=0,end=999,limit=1000;
 const run=()=>{
  if(dbFailure&&table.startsWith('chatgpt_history_'))return {data:null,error:{message:'unavailable'}};
  const all=tables[table]??(tables[table]=[]);let rows=all.filter(r=>checks.every(f=>f(r)));
  if(mutation==='insert'||mutation==='upsert') {
   const cols=table==='chatgpt_history_links'?['provider_identity','upstream_id']:['chatgpt_conversation_owners','chatgpt_history_backup_issues'].includes(table)?['provider_account_key','conversation_id']:table==='chatgpt_history_resumes'?['token_hash']:['id'];
   const existing=all.find(r=>cols.every(k=>r[k]===payload[k]));
   if(existing){if(mutation==='insert')return {data:null,error:{code:'23505'}};if(!options?.ignoreDuplicates)Object.assign(existing,payload);rows=[existing];}
   else {const row={created_at:new Date().toISOString(),...structuredClone(payload)};all.push(row);rows=[row];}
  }else if(mutation==='update')rows.forEach(r=>Object.assign(r,structuredClone(payload)));
  return {data:structuredClone(rows.slice(offset,Math.min(end+1,offset+limit))),error:null};
 };
 const q:any={select(){return q},eq(k:string,v:any){checks.push(r=>r[k]===v);return q},neq(k:string,v:any){checks.push(r=>r[k]!==v);return q},in(k:string,v:any[]){checks.push(r=>v.includes(r[k]));return q},is(k:string,v:any){checks.push(r=>(r[k]??null)===v);return q},gt(k:string,v:any){checks.push(r=>r[k]>v);return q},order(){return q},limit(n:number){limit=n;return q},range(a:number,b:number){offset=a;end=b;return q},insert(p:any){mutation='insert';payload=p;return q},update(p:any){mutation='update';payload=p;return q},upsert(p:any,o:any){mutation='upsert';payload=p;options=o;return q},async maybeSingle(){const r=run();return {...r,data:r.data?.[0]??null}},async single(){return q.maybeSingle()},then(fn:any){return Promise.resolve(run()).then(fn)}};return q;
}};
mock.module('../src/integrations/supabase/client.server',()=>({supabaseAdmin:database}));
const {handleChatGPTProxyRequest:handle,hashChatGPTProxyToken}=await import('../src/lib/chatgpt-proxy.server');
const {savedThread,saveSnapshot,savedHistoryItems,claimHistoryResume}=await import('../src/lib/chatgpt-history.server');
sessions.forEach((s,i)=>s.token_hash=hashChatGPTProxyToken(String(i+1).repeat(43)));
let offline=false;const snapshots=new Map<string,any>();let nextId=chatA;const upstreamBodies:any[]=[];
function snapshot(id:string,prompt:string,answer:string) {const root=randomUUID(),u=randomUUID(),a=randomUUID();return {id,conversation_id:id,title:prompt,create_time:1,update_time:Date.now()/1000,current_node:a,mapping:{[root]:{id:root,parent:null,children:[u],message:null},[u]:{id:u,parent:root,children:[a],message:{id:u,author:{role:'user'},content:{content_type:'text',parts:[prompt]}}},[a]:{id:a,parent:u,children:[],message:{id:a,author:{role:'assistant'},content:{content_type:'text',parts:[answer]}}}}};}
const realFetch=globalThis.fetch;
globalThis.fetch=(async(input:any,init:any)=>{
 const url=new URL(String(input));const h=new Headers(init?.headers);const identity=(h.get('cookie')??'').includes('official-two')?'official-two':'official-one';
 if(url.pathname==='/api/auth/session'&&offline)return new Response('',{status:401});
 if(url.pathname==='/api/auth/session')return Response.json({accessToken:'token-'+identity,user:{id:identity}});
 if(url.pathname==='/backend-api/f/conversation') {
  const body=JSON.parse(init.body instanceof ArrayBuffer?new TextDecoder().decode(init.body):init.body);upstreamBodies.push(body);
  const id=body.conversation_id??nextId;const snap=snapshot(id,body.messages[0].content.parts[0],'Answer '+id);
  const userNode=Object.values(snap.mapping).find((n:any)=>n.message?.author.role==='user') as any;userNode.message.id=body.messages[0].id;
  snapshots.set(id,snap);
  return new Response('data: '+JSON.stringify({conversation_id:id,message:{content:{parts:['Answer']}}})+'\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}});
 }
 if(url.pathname.startsWith('/backend-api/conversation/'))return snapshots.has(url.pathname.split('/').at(-1)!)?Response.json(snapshots.get(url.pathname.split('/').at(-1)!)):new Response('',{status:404});
 if(url.pathname==='/backend-api/conversations')return Response.json({items:[],total:0});
 return new Response('<html><head></head><body>ChatGPT</body></html>',{headers:{'Content-Type':'text/html'}});
}) as typeof fetch;
function req(i:number,path='/',body?:any,extra:any={}) {return new Request(origin+path,{method:body?'POST':'GET',headers:{Cookie:'trst_cg_proxy='+String(i+1).repeat(43)+'; trst_cg_device='+String(i+1).repeat(32),Origin:origin,Accept:path.startsWith('/backend-api/')?'application/json':'text/html','Content-Type':'application/json',...extra},body:body?JSON.stringify(body):undefined});}
const prompt=(text:string)=>({action:'next',parent_message_id:randomUUID(),messages:[{id:randomUUID(),author:{role:'user'},content:{content_type:'text',parts:[text]}}]});
try {
 const first=await handle(req(0,'/backend-api/f/conversation',prompt('Writer A private question')));assert.equal(first.status,200);await first.text();
 const saved=await savedThread(userA,chatA);assert(saved);assert.equal(historyMessages(saved.snapshot).length,2);
 assert(!tables.chatgpt_history_threads[0].encrypted_snapshot.includes('Writer A private question'));
 nextId=chatB;await (await handle(req(1,'/backend-api/f/conversation',prompt('Writer B private question')))).text();
 assert.equal((await savedHistoryItems(userA)).length,1);assert.equal(await savedThread(userB,chatA),null);
 const own=await handle(req(0,'/__trst/history/'+chatA));assert.equal(own.status,200);assert((await own.text()).includes('Writer A private question'));
 assert.equal((await handle(req(1,'/__trst/history/'+chatA))).status,404);
 assert.equal((await handle(req(1,'/backend-api/conversation/'+chatA))).status,404);
 // Expiry revokes access while retaining both the ciphertext and permanent user ownership.
 const ciphertext=tables.chatgpt_history_threads[0].encrypted_snapshot;
 tables.tool_access_grants[0].expires_at=new Date(Date.now()-1000).toISOString();assert.equal((await handle(req(0,'/__trst/history'))).status,401);assert.equal(tables.chatgpt_history_threads[0].encrypted_snapshot,ciphertext);
 tables.tool_access_grants[0].expires_at=new Date(Date.now()+100000).toISOString();sessions[0].status='active';assert.equal((await handle(req(0,'/__trst/history/'+chatA))).status,200);
 // Replacing the actual official login inside the SAME slot must retain history.
 tables.chatgpt_provider_accounts[0].encrypted_payload=vault('official-two');
 assert.equal((await handle(req(0,'/c/'+chatA))).status,200);
 const page=await handle(req(0,'/backend-api/conversations?offset=0&limit=28'));assert.equal((await page.json()).items[0].id,chatA);
 const continued=await handle(req(0,'/__trst/history/'+chatA+'/continue',{}));assert.equal(continued.status,303);
 const token=new URL(continued.headers.get('location')!,origin).searchParams.get('trst_resume')!;
 assert.equal((await handle(req(1,'/backend-api/f/conversation',prompt('steal'),{'x-trst-history-resume':token}))).status,409);
 nextId=chatC;const secondPrompt=prompt('Please continue with my next question');
 const continuedReply=await handle(req(0,'/backend-api/f/conversation',secondPrompt,{'x-trst-history-resume':token}));assert.equal(continuedReply.status,200);await continuedReply.text();
 const sent=upstreamBodies.at(-1);assert(!sent.conversation_id);assert(sent.messages[0].content.parts[0].includes('Writer A private question'));assert(!sent.messages[0].content.parts[0].includes('Writer B private question'));
 const combined=await savedThread(userA,chatA);assert.equal(historyMessages(combined.snapshot).length,4);assert.equal(historyMessages(combined.snapshot).at(-2).content.parts[0],'Please continue with my next question');
 assert.equal((await savedHistoryItems(userA)).length,1);assert.equal(tables.chatgpt_history_links.filter(x=>x.user_id===userA).length,2);
 assert.equal((await handle(req(0,'/backend-api/f/conversation',secondPrompt,{'x-trst-history-resume':token}))).status,409);
 // Re-fetching the same new provider snapshot never creates a cycle or removes the first half.
 const id=combined.latest_upstream_id;await saveSnapshot(userA,'account_1',combined.latest_provider_identity,id,snapshots.get(id),chatA);
 assert.equal(historyMessages((await savedThread(userA,chatA)).snapshot).length,4);
 const malicious=snapshot(randomUUID(),'<script>alert(1)</script>','answer');const merged=mergeSnapshots(null,malicious,malicious.id);assert.equal(merged.title,'<script>alert(1)</script>');
 assert.throws(()=>continuationBody({action:'next',messages:[]},combined.snapshot,randomUUID()));
 const huge=snapshot(randomUUID(),'x'.repeat(90001),'answer');assert.throws(()=>continuationBody(prompt('next'),huge,randomUUID()),/too long/);
 const files=snapshot(randomUUID(),'question','answer');(historyMessages(files)[0].content.parts as any[]).push({image_asset_pointer:'secret'});assert.throws(()=>continuationBody(prompt('next'),files,randomUUID()),/files or images/);
 const {captureHistoryStream}=await import('../src/lib/chatgpt-history.server');
 const bytes=new TextEncoder().encode('data: '+JSON.stringify({conversation_id:chatA,text:'héllo'})+'\n\ndata: [DONE]\n\n');
 let cursor=0,found='',finished='';
 const fragmented=new ReadableStream({pull(c){if(cursor===bytes.length)c.close();else c.enqueue(bytes.slice(cursor,++cursor));}});
 const streamed=await new Response(captureHistoryStream(fragmented,async id=>{found=id;},async id=>{finished=id;})).text();
 assert(streamed.includes('héllo'));assert.equal(found,chatA);assert.equal(finished,chatA);
 const {historyPage,historyBootstrap}=await import('../src/lib/chatgpt-history-ui.server');
 assert(!historyPage('',[],{id:chatA,title:'<script>alert(1)</script>',snapshot:malicious}).includes('<script>alert(1)</script>'));
 new Function(historyBootstrap('').replace(/^<script>|<\/script>$/g,''));
 const {backupChatGptAccount}=await import('../src/lib/chatgpt-history-backup.server');
 const missing=randomUUID();tables.chatgpt_conversation_owners.push({conversation_id:missing,provider_account_key:'account_1',user_id:userA});
 const report=await backupChatGptAccount('account_1',tables.chatgpt_provider_accounts[0].encrypted_payload);assert.equal(report.failed,0);assert.equal(report.unavailable,1);
 assert(tables.chatgpt_history_backup_issues.some(x=>x.conversation_id===missing&&x.status==='upstream_missing'));
 // An expired old login can still be replaced when every transcript is already accounted for.
 offline=true;const offlinePayload=vault('official-two');const offlineReport=await backupChatGptAccount('account_1',offlinePayload);assert.equal(offlineReport.failed,0);offline=false;
 dbFailure=true;assert.equal((await handle(req(0,'/__trst/history'))).status,503);dbFailure=false;
 console.log('Durable ChatGPT history passed: encrypted capture, two-user privacy, expiry/renewal, same-slot login replacement, merged history, context continuation, single-use tab token, repeat snapshot merge, attachment/length limits, and database failure.');
}finally{globalThis.fetch=realFetch;mock.restore();}
