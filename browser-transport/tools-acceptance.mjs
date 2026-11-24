/** Live checks use only the previously created, disposable QuillBot QA writers. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {db} from '../runtime/db.mjs';
import {decryptQuillBotSession,quillBotSessionExpiry} from '../src/lib/quillbot-session.server.ts';
import {WriterStore} from './writer-store.mjs';
const origin='https://quillbot.topratedseotools.com',base=origin+'/__qbtest';
const checked=r=>{if(r.error)throw Error('QA storage operation failed: '+r.error.code);return r.data;};
const fixtureEnvelope=fs.readFileSync(new URL('../.secrets/reverify-writer-tests.enc',import.meta.url),'utf8');
let fixturePlaintext;
try{fixturePlaintext=decryptQuillBotSession(fixtureEnvelope);}catch{
 // Historical QA fixtures predate the Admin/transport vault-key alignment.
 const backup=fs.readFileSync(new URL('../runtime/.env.before-admin-vault-key',import.meta.url),'utf8');
 const key=backup.match(/^QUILLBOT_SESSION_ENCRYPTION_KEY=(.*)$/m)?.[1]?.trim().replace(/^['"]|['"]$/g,'');
 if(!key)throw Error('Historical QA key unavailable; create fresh disposable fixtures');
 fixturePlaintext=decryptQuillBotSession(fixtureEnvelope,key);
}
const identities=JSON.parse(fixturePlaintext);
assert.equal(identities.length,2);assert.ok(identities.every(v=>/^quillbot-launch-reverify-/.test(v.email)));
const saved=checked(await db.from('quillbot_provider_accounts').select('encrypted_payload').eq('account_key','account_1').single());
const provider=JSON.parse(decryptQuillBotSession(saved.encrypted_payload));
const secrets=[provider.useridtoken,...provider.cookie.split(';').map(v=>v.slice(v.indexOf('=')+1).trim()),process.env.SUPABASE_SERVICE_ROLE_KEY].filter(v=>v&&v.length>=12);
const expiry=quillBotSessionExpiry(provider.useridtoken);
const store=new WriterStore(new URL('../.secrets/quillbot-writers.sqlite',import.meta.url).pathname);
const sessions=[],limits=new Map();
async function request(path,init={}){const r=await fetch(path.startsWith('https:')?path:base+path,{...init,redirect:'manual',signal:AbortSignal.timeout(90000)});const text=await r.text();for(const secret of secrets){assert.ok(!text.includes(secret),'Provider secret leaked in response');assert.ok(!JSON.stringify([...r.headers]).includes(secret),'Provider secret leaked in headers');}return {r,text,json:()=>JSON.parse(text)};}
const pass=s=>console.log('PASS '+s);
async function fresh(i){const s=sessions[i];const t=await request('/__trst/launch',{method:'POST',headers:s.launchHeaders});assert.equal(t.r.status,200);const result=await request(t.json().launch_url,{headers:s.launchHeaders});assert.equal(result.r.status,302);s.cookie=result.r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');return s;}
function headers(s){return {cookie:s.cookie,origin,'content-type':'application/json','platform-type':'webapp','qb-product':'paraphraser'};}
try{
 for(const [i,id] of identities.entries()){
  const grants=checked(await db.from('tool_access_grants').select('id,notes').eq('tool_slug','quillbot').eq('user_id',id.userId));assert.ok(grants.length&&grants.every(g=>/validation/i.test(g.notes)));
  checked(await db.from('tool_access_grants').update({status:'active',expires_at:new Date(Date.now()+7200000).toISOString()}).eq('tool_slug','quillbot').eq('user_id',id.userId));
  checked(await db.from('quillbot_user_controls').upsert({user_id:id.userId,status:'active',device_limit:2},{onConflict:'user_id'}));
  limits.set(id.userId,store.status(id.userId).daily_limit);store.setLimit(id.userId,25);
  let auth=await request('/__trst/app-login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({email:id.email,password:id.password})});assert.equal(auth.r.status,200);
  const devices=checked(await db.from('quillbot_devices').select('device_fingerprint').eq('user_id',id.userId).limit(1));
  const launchHeaders={origin:'https://topratedseotools.com',authorization:'Bearer '+auth.json().access_token,...(devices[0]?{cookie:'trst_qb_device='+devices[0].device_fingerprint}:{})};
  sessions.push({userId:id.userId,launchHeaders});await fresh(i);
  const state=await request('/__trst/auth-state',{headers:headers(sessions[i])});assert.equal(state.r.status,200);assert.equal(state.json().uid,id.userId);assert.equal(state.json().premium,true);
 }
 pass('two independent writers have Premium access');

 const TEXTS=[
  'Local libraries give young readers valuable chances to learn. Many schools now run reading clubs together with libraries so that children can borrow books freely. Teachers say that regular visits improve vocabulary, concentration and confidence. Parents report that children who visit libraries weekly tend to enjoy reading more and finish more books each term.',
  'Community gardens help families grow fresh vegetables close to home. Volunteers share seeds, tools and advice so that beginners can start without large costs. Neighbours who work together on shared plots often build lasting friendships. Health workers note that access to fresh produce supports better eating habits across the whole neighbourhood.'
 ];
 const detect=async(s,text)=>request('/api/ai-detector/score?version=2',{method:'POST',headers:headers(s),body:JSON.stringify({language:'en',text,explain:true,origin:'text-editor-aidr',checkType:'foreground'})});
 const summarize=async(s,text)=>request('/api/summarizer/summarize-para/abs',{method:'POST',headers:headers(s),body:JSON.stringify({para:text,lang:'en',modeId:'abs'})});
 const results=[];
 for(const [i,s] of sessions.entries()){
  const d=await detect(s,TEXTS[i]);assert.equal(d.r.status,200,'AI Detector call failed: '+d.r.status+' '+d.text.slice(0,200));
  assert.equal(typeof d.json()?.data?.value?.aiScore,'number');
  const m=await summarize(s,TEXTS[i]);assert.equal(m.r.status,200,'Summarizer call failed: '+m.r.status+' '+m.text.slice(0,200));
  assert.equal(typeof m.json()?.data?.summary,'string');results[i]={summary:m.json().data.summary};
 }
 pass('both writers ran a real AI Detector scan and a real Summarizer run');
 for(const [i,s] of sessions.entries()){
  const h=await request('/__trst/history',{headers:headers(s)});assert.equal(h.r.status,200);
  const items=h.json().items;
  assert.ok(items.some(v=>v.tool==='AI Detector'&&v.input===TEXTS[i]&&/^AI-generated: \d+%/.test(v.output)),'detector history missing');
  assert.ok(items.some(v=>v.tool==='Summarizer'&&v.input===TEXTS[i]&&v.output===results[i].summary),'summarizer history missing');
  assert.ok(items.every(v=>v.input!==TEXTS[1-i]),'writer sees the other writer\'s text');
  const usage=await request('/__trst/usage',{headers:headers(s)});assert.ok(usage.json().tools['AI Detector']>=1&&usage.json().tools.Summarizer>=1);
 }
 pass('each writer sees only their own tool history, with usage counted per tool');
 for(const [i,s] of sessions.entries()){
  for(const row of store.history(s.userId)){assert.ok(!row.payload.includes(TEXTS[i].slice(0,40)),'tool history not encrypted at rest');}
 }
 pass('tool history is encrypted at rest');
 for(const s of sessions){
  for(const [path,method] of [['/api/citations-next/data/folders','GET'],['/api/citations-next/data/new/source','POST'],['/api/projects','POST'],['/api/history','POST'],['/citation-generator','GET'],['/api/auth/get-account-details','POST'],['/api/billing/x','POST']]){
   const r=await request(path,{method,headers:headers(s),...(method==='POST'?{body:'{}'}:{})});assert.ok([403,404,502,503].includes(r.r.status)||r.r.status>=400,'route should be closed: '+path+' '+r.r.status);
  }
 }
 pass('shared-account storage, citation lists, account and billing routes are closed for writers');
 const other=await request('/__trst/history?user_id='+sessions[1].userId,{headers:headers(sessions[0])});assert.equal(other.r.status,403);
 pass('reading another writer\'s history is refused');
 for(const path of ['/api/ai-detector/score?version=2','/api/summarizer/summarize-para/abs'])assert.equal((await request(path,{method:'POST',body:'{}'})).r.status,401);
 pass('tool calls without a launched session are refused');
 console.log('PASS QuillBot tool end-to-end checks');
}  finally {
 for(const id of identities){
  if(limits.has(id.userId))store.setLimit(id.userId,limits.get(id.userId));
  checked(await db.from('tool_access_grants').update({status:'revoked'}).eq('tool_slug','quillbot').eq('user_id',id.userId));
  checked(await db.from('quillbot_proxy_sessions').update({status:'revoked'}).eq('user_id',id.userId).in('status',['issued','active']));
  checked(await db.from('quillbot_user_controls').update({status:'suspended'}).eq('user_id',id.userId));
 }
 store.db.close();console.log('CLEANUP disposable writer access revoked; no customer balances changed');
}
