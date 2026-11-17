// Native UI acceptance in disposable browser contexts on the existing authorized server browser.
// Sends one short QA question per test writer. Never changes provider logins or customer access.
import {strict as assert} from 'node:assert';
import {randomBytes,randomUUID} from 'node:crypto';
import {supabaseAdmin} from '../../src/integrations/supabase/client.server';
import {createChatGPTProxyLaunch} from '../../src/lib/chatgpt-proxy.server';
import {saveSnapshot,historyHash,savedThread} from '../../src/lib/chatgpt-history.server';
import {historyMessages,messageText} from '../../src/lib/chatgpt-history-model';
const db=supabaseAdmin as any;
const version=await fetch('http://127.0.0.1:9226/json/version').then(r=>r.json()) as any;
const socket=new WebSocket(version.webSocketDebuggerUrl);
await new Promise<void>((resolve,reject)=>{socket.addEventListener('open',()=>resolve(),{once:true});socket.addEventListener('error',()=>reject(Error('QA browser unavailable')),{once:true});});
let seq=0;const pending=new Map<number,any>();
socket.addEventListener('message',e=>{const d=JSON.parse(String(e.data));if(d.id&&pending.has(d.id)){const p=pending.get(d.id);pending.delete(d.id);clearTimeout(p.timer);d.error?p.reject(Error(d.error.message)):p.resolve(d.result);}});
function call(method:string,params:any={},sessionId?:string):Promise<any>{return new Promise((resolve,reject)=>{const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error('Browser command timed out: '+method));},20000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});}
async function evaluate(session:string,expression:string){const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},session);if(r.exceptionDetails)throw Error('QA browser evaluation failed');return r.result?.value;}
async function until(fn:()=>Promise<any>,label:string,ms=60000){const end=Date.now()+ms;while(Date.now()<end){const result=await fn();if(result)return result;await new Promise(r=>setTimeout(r,700));}throw Error('Timed out: '+label);}
const users:string[]=[],contexts:string[]=[],fixtures:any[]=[];
const check=(r:any)=>{assert(!r.error,'QA fixture write failed');return r.data;};
try {
 const account=check(await db.from('tool_accounts').select('id').eq('tool_slug','chatgpt').limit(1).single());
 for(let i=0;i<2;i++) {
  const userResult=await db.auth.admin.createUser({email:'chatgpt-history-browser-qa-'+Date.now()+'-'+i+'@topratedseotools.com',password:randomBytes(32).toString('base64url'),email_confirm:true,user_metadata:{is_qa_fixture:true,purpose:'Native ChatGPT saved-history continuation acceptance'}});assert(!userResult.error&&userResult.data.user);const user=userResult.data.user.id;users.push(user);
  check(await db.from('tool_access_grants').insert({user_id:user,tool_slug:'chatgpt',account_id:account.id,status:'active',expires_at:new Date(Date.now()+3600000).toISOString(),notes:'Native saved-history QA fixture; not a customer.'}));
  const id=randomUUID(),r=randomUUID(),u=randomUUID(),a=randomUUID(),marker='RIVER'+randomBytes(4).toString('hex').toUpperCase();
  check(await db.from('chatgpt_conversation_owners').insert({conversation_id:id,user_id:user,provider_account_key:'account_1'}));
  await saveSnapshot(user,'account_1',historyHash('prior-official-account-browser-qa'),id,{id,conversation_id:id,title:'Native QA saved history '+i,create_time:Date.now()/1000,update_time:Date.now()/1000,current_node:a,mapping:{[r]:{id:r,parent:null,children:[u],message:null},[u]:{id:u,parent:r,children:[a],message:{id:u,author:{role:'user'},content:{content_type:'text',parts:['Please remember my private code: '+marker]}}},[a]:{id:a,parent:u,children:[],message:{id:a,author:{role:'assistant'},content:{content_type:'text',parts:['I will remember your private code.']}}}}});
  const context=await call('Target.createBrowserContext',{disposeOnDetach:true});contexts.push(context.browserContextId);
  const target=await call('Target.createTarget',{url:'about:blank',browserContextId:context.browserContextId});
  const {sessionId}=await call('Target.attachToTarget',{targetId:target.targetId,flatten:true});
  await call('Page.enable',{},sessionId);await call('Runtime.enable',{},sessionId);
  const launch=await createChatGPTProxyLaunch(user);await call('Page.navigate',{url:launch.launchUrl},sessionId);
  await until(()=>evaluate(sessionId,"!!document.querySelector('[contenteditable=true]')"),'initial composer');
  await call('Page.navigate',{url:'https://chatgpt.topratedseotools.com/__trst/history/'+id},sessionId);
  await until(()=>evaluate(sessionId,"!!document.querySelector('form button')"),'saved transcript');
  await evaluate(sessionId,"document.querySelector('form').requestSubmit();true");
  await until(()=>evaluate(sessionId,"!!document.querySelector('[contenteditable=true]') && !!document.getElementById('trst-history-notice')"),'continuation composer');
  fixtures.push({user,id,marker,sessionId});console.log('Native writer '+(i+1)+' saved transcript and continuation composer passed.');
 }
 await Promise.all(fixtures.map(async(f,i)=>{
  await evaluate(f.sessionId,`(()=>{const e=document.querySelector('[contenteditable=true]');e.focus();document.execCommand('insertText',false,'What private code did I ask you to remember? Reply with only the code.');e.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText'}));return true})()`);
  await until(()=>evaluate(f.sessionId,"!!document.querySelector('button[data-testid=send-button]:not(:disabled)')"),'send button');
  await evaluate(f.sessionId,"document.querySelector('button[data-testid=send-button]').click();true");
  await until(async()=>{const t=await savedThread(f.user,f.id);return t&&historyMessages(t.snapshot).length>=4;},'saved continued response',90000);
  const saved=await savedThread(f.user,f.id),messages=historyMessages(saved.snapshot);assert(messageText(messages.at(-1)).includes(f.marker),'The reply must recall the archived private code.');assert(!JSON.stringify(saved.snapshot).includes(fixtures[1-i].marker),'No cross-writer context may be present.');
  assert.equal(messageText(messages.at(-2)),'What private code did I ask you to remember? Reply with only the code.');
  console.log('Native writer '+(i+1)+' successful context-aware reply and combined saved transcript passed.');
 }));
 console.log('Two disposable native writer sessions continued prior-account saved text concurrently with isolated context.');
}finally {
 for(const context of contexts)await call('Target.disposeBrowserContext',{browserContextId:context}).catch(()=>{});
 socket.close();
 if(users.length){check(await db.from('chatgpt_proxy_sessions').update({status:'revoked'}).in('user_id',users));check(await db.from('tool_access_grants').update({status:'revoked',notes:'Completed native ChatGPT saved-history QA fixture.'}).in('user_id',users));}
}
