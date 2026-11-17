// Creates two isolated QA identities/grants only. Never modifies a customer or provider login.
import {strict as assert} from 'node:assert';
import {randomUUID,randomBytes} from 'node:crypto';
import {supabaseAdmin} from '../../src/integrations/supabase/client.server';
import {createChatGPTProxyLaunch,handleChatGPTProxyRequest} from '../../src/lib/chatgpt-proxy.server';
import {saveSnapshot,historyHash,savedThread} from '../../src/lib/chatgpt-history.server';
const db=supabaseAdmin as any,origin='https://chatgpt.topratedseotools.com';
const live=process.argv.includes('--live');
const request=(r:Request)=>live?fetch(r,{redirect:'manual'}):handleChatGPTProxyRequest(r);
const qaUsers:string[]=[];
const {data:account,error:accountError}=await db.from('tool_accounts').select('id').eq('tool_slug','chatgpt').limit(1).single();
assert(!accountError&&account,'A ChatGPT tool account is required.');
const check=(r:any)=>{assert(!r.error,'QA database write failed');return r.data;};
async function launch(user:string,fingerprint:string) {
 const l=await createChatGPTProxyLaunch(user,fingerprint);
 const r=await request(new Request(l.launchUrl,{headers:{Origin:origin}}));assert.equal(r.status,302);
 return r.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');
}
try {
 const fixtures:any[]=[];
 for(let i=0;i<2;i++) {
  const {data,error}=await db.auth.admin.createUser({email:'chatgpt-history-qa-'+Date.now()+'-'+i+'@topratedseotools.com',password:randomBytes(32).toString('base64url'),email_confirm:true,user_metadata:{is_qa_fixture:true,purpose:'ChatGPT durable history acceptance'}});
  assert(!error&&data.user);const user=data.user.id;qaUsers.push(user);
  const grant=check(await db.from('tool_access_grants').insert({user_id:user,tool_slug:'chatgpt',account_id:account.id,status:'active',expires_at:new Date(Date.now()+3600000).toISOString(),notes:'Automated ChatGPT history QA; no paid balance or customer access changed.'}).select('id').single());
  const id=randomUUID(),root=randomUUID(),u=randomUUID(),a=randomUUID();
  check(await db.from('chatgpt_conversation_owners').insert({conversation_id:id,user_id:user,provider_account_key:'account_1'}));
  await saveSnapshot(user,'account_1',historyHash('previous-official-account-qa'),id,{id,conversation_id:id,title:'QA private saved chat '+i,create_time:Date.now()/1000,update_time:Date.now()/1000,current_node:a,mapping:{[root]:{id:root,parent:null,children:[u],message:null},[u]:{id:u,parent:root,children:[a],message:{id:u,author:{role:'user'},content:{content_type:'text',parts:['QA private marker '+i]}}},[a]:{id:a,parent:u,children:[],message:{id:a,author:{role:'assistant'},content:{content_type:'text',parts:['QA saved answer '+i]}}}}});
  const fingerprint=randomBytes(16).toString('hex'),cookie=await launch(user,fingerprint);fixtures.push({user,id,grant:grant.id,cookie,fingerprint});
 }
 const call=(f:any,path:string,post=false)=>request(new Request(origin+path,{method:post?'POST':'GET',headers:{Cookie:f.cookie,Origin:origin,Accept:path.startsWith('/backend-api/')?'application/json':'text/html',...(post?{'Content-Type':'application/json'}:{})},body:post?'{}':undefined}));
 for(let i=0;i<2;i++) {
  const f=fixtures[i],other=fixtures[1-i];
  const own=await call(f,'/__trst/history/'+f.id);assert.equal(own.status,200);const text=await own.text();assert(text.includes('QA private marker '+i));assert(!text.includes('QA private marker '+(1-i)));
  assert.equal((await call(f,'/__trst/history/'+other.id)).status,404);
  assert.equal((await call(f,'/backend-api/conversation/'+other.id)).status,404);
  const old=await call(f,'/c/'+f.id);assert.equal(old.status,200);assert((await old.text()).includes('Continue this conversation'));
  const cont=await call(f,'/__trst/history/'+f.id+'/continue',true);assert.equal(cont.status,303);
  const landing=await call(f,cont.headers.get('location')!);assert.equal(landing.status,200);assert((await landing.text()).includes('trstHistoryResume'));
 }
 const f=fixtures[0];const before=(await savedThread(f.user,f.id)).encrypted_snapshot;
 check(await db.from('tool_access_grants').update({expires_at:new Date(Date.now()-1000).toISOString()}).eq('id',f.grant));
 assert.equal((await call(f,'/__trst/history/'+f.id)).status,401);assert.equal((await savedThread(f.user,f.id)).encrypted_snapshot,before);
 check(await db.from('tool_access_grants').update({expires_at:new Date(Date.now()+3600000).toISOString()}).eq('id',f.grant));
 f.cookie=await launch(f.user,f.fingerprint);assert.equal((await call(f,'/__trst/history/'+f.id)).status,200);
 console.log(JSON.stringify({mode:live?'live HTTPS':'staged handler',two_fresh_writer_launches:true,private_saved_reads:true,cross_user_denial:true,prior_account_transcript:true,native_continuation_landing:true,expiry_denied:true,renewal_retains_history:true,provider_message_sent:false}));
}finally {
 if(qaUsers.length) {
  check(await db.from('chatgpt_proxy_sessions').update({status:'revoked'}).in('user_id',qaUsers));
  check(await db.from('tool_access_grants').update({status:'revoked',notes:'Completed ChatGPT history QA; fixture only.'}).in('user_id',qaUsers));
 }
}
