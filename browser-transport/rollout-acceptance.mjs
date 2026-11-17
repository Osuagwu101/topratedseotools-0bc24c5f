/** Live checks use only the previously created, disposable QuillBot QA writers. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {db} from '../runtime/db.mjs';
import {decryptQuillBotSession,quillBotSessionExpiry} from '../src/lib/quillbot-session.server.ts';
import {WriterStore} from './writer-store.mjs';
const origin='https://quillbot.topratedseotools.com',base=origin+'/__qbtest';
const checked=r=>{if(r.error)throw Error('QA storage operation failed: '+r.error.code);return r.data;};
const identities=JSON.parse(decryptQuillBotSession(fs.readFileSync(new URL('../.secrets/reverify-writer-tests.enc',import.meta.url),'utf8')));
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
 const texts=['Local libraries provide valuable learning opportunities for young readers.','Community gardens give families access to fresh and nutritious food.'];const ops=[];const outputs=[];
 await Promise.all(sessions.map(async(s,i)=>{
  const split=await request('/api/utils/sentence-spiltter',{method:'POST',headers:headers(s),body:JSON.stringify({fallback:true,text:texts[i]})});assert.equal(split.r.status,200);ops[i]=split.r.headers.get('x-trst-operation');assert.ok(ops[i]);
  const para=await request('/api/paraphraser/single-paraphrase/2',{method:'POST',headers:{...headers(s),'x-trst-operation':ops[i]},body:JSON.stringify({fthresh:-1,autoflip:false,wikify:false,inputLang:'en',strength:2,quoteIndex:-1,text:texts[i],frozenWords:[],nBeams:4,freezeQuotes:true,preferActive:false,dialect:'US',promptVersion:'v2',multilingualModelVersion:'v2'})});assert.equal(para.r.status,200);
  const candidates=[];const visit=(v,k='')=>{if(typeof v==='string'&&/^(alt|text|para|paraphrase|output|sent)$/.test(k))candidates.push(v);else if(Array.isArray(v))v.forEach(x=>visit(x,k));else if(v&&typeof v==='object')Object.entries(v).forEach(([key,x])=>visit(x,key));};visit(para.json());outputs[i]=candidates.find(v=>v.trim()&&v.trim()!==texts[i]);assert.ok(outputs[i],'Actual paraphrase required');
  const save=await request('/__trst/history',{method:'POST',headers:headers(s),body:JSON.stringify({input:texts[i],output:outputs[i]})});assert.equal(save.r.status,200);
 }));pass('simultaneous actual paraphrases and separate encrypted history');
 for(const [i,s] of sessions.entries()){
  for(let n=0;n<2;n++){const history=await request('/__trst/history',{headers:headers(s)});assert.equal(history.r.status,200);assert.ok(history.json().items.some(v=>v.output===outputs[i]));assert.ok(history.json().items.every(v=>v.input!==texts[1-i]));}
  assert.equal((await request('/__trst/history?user_id='+sessions[1-i].userId,{headers:headers(s)})).r.status,403);
  assert.equal((await request('/api/paraphraser/single-paraphrase/2',{method:'POST',headers:{...headers(s),'x-trst-operation':ops[1-i]},body:JSON.stringify({text:texts[1-i]})})).r.status,403);
  assert.equal((await request('/__trst/admin/writers',{headers:{authorization:s.launchHeaders.authorization}})).r.status,403);
  for(const path of ['/api/auth/get-account-details','/api/auth/issue-token','/api/history','/api/projects','/grammar-check','/plagiarism-checker','/ai-humanizer']){const r=await request(path,{method:path.startsWith('/api/')?'POST':'GET',headers:headers(s),...(path.startsWith('/api/')?{body:'{}'}:{})});assert.ok([400,401,403,404].includes(r.r.status),'Unsupported route must not proxy');}
  pass('writer '+(i+1)+' isolation, direct request ownership, Admin denial and unsupported routes');
 }
 for(const path of ['/paraphrasing-tool','/__trst/auth-state','/__trst/history','/__trst/usage'])assert.equal((await request(path)).r.status,401);
 const s=sessions[0],id=s.userId;
 const used=store.status(id).used;store.setLimit(id,used);let r=await request('/api/utils/sentence-spiltter',{method:'POST',headers:headers(s),body:JSON.stringify({text:'Limit verification.'})});assert.equal(r.r.status,429);store.setLimit(id,used+2);pass('daily limit blocks immediately and Admin change restores allowance');
 // Entitlement revocation and expiry must block an already-open session.
 for(const change of [{status:'revoked'},{status:'active',expires_at:new Date(Date.now()-10000).toISOString()}]){
  checked(await db.from('tool_access_grants').update(change).eq('tool_slug','quillbot').eq('user_id',id));
  assert.ok([401,403].includes((await request('/__trst/history',{headers:headers(s)})).r.status));
  assert.ok([401,403].includes((await request('/__trst/launch',{method:'POST',headers:s.launchHeaders})).r.status));
  checked(await db.from('tool_access_grants').update({status:'active',expires_at:new Date(Date.now()+7200000).toISOString()}).eq('tool_slug','quillbot').eq('user_id',id));await fresh(0);
 }
 pass('revoked and expired entitlements block existing sessions and new launches');
 checked(await db.from('quillbot_user_controls').update({status:'suspended'}).eq('user_id',id));assert.ok([401,403].includes((await request('/__trst/usage',{headers:headers(s)})).r.status));checked(await db.from('quillbot_user_controls').update({status:'active'}).eq('user_id',id));await fresh(0);pass('Admin suspension invalidates an open writer session');
 // Only these disposable writers have their device registrations exercised.
 const deviceCookie=s.cookie.split('; ').find(v=>v.startsWith('trst_qb_device='));const fingerprint=deviceCookie.split('=')[1];
 checked(await db.from('quillbot_devices').delete().eq('user_id',id).eq('device_fingerprint',fingerprint));assert.ok([401,403].includes((await request('/__trst/history',{headers:headers(s)})).r.status));pass('removed device loses access immediately');
 checked(await db.from('quillbot_devices').delete().eq('user_id',id));
 for(let n=0;n<2;n++)assert.equal(checked(await db.rpc('register_quillbot_device',{_user_id:id,_fingerprint:randomBytes(16).toString('hex')})),true);
 assert.equal(checked(await db.rpc('register_quillbot_device',{_user_id:id,_fingerprint:randomBytes(16).toString('hex')})),false);pass('device registration cannot exceed its configured limit');
 for(const row of store.history(id)){assert.ok(!row.payload.includes(texts[0]));assert.ok(!row.payload.includes(outputs[0]));}pass('saved work is encrypted at rest');
 pass('provider credentials absent from all checked responses and headers');
 console.log('TOKEN_RENEWAL_HINT '+JSON.stringify({importedTokenExpiresAt:expiry.expiresAt,importedTokenAlreadyExpired:expiry.expired,livePremiumAndParaphrasesPassed:true}));
 console.log('PASS QuillBot live rollout checks');
} finally {
 for(const id of identities){
  if(limits.has(id.userId))store.setLimit(id.userId,limits.get(id.userId));
  checked(await db.from('tool_access_grants').update({status:'revoked'}).eq('tool_slug','quillbot').eq('user_id',id.userId));
  checked(await db.from('quillbot_proxy_sessions').update({status:'revoked'}).eq('user_id',id.userId).in('status',['issued','active']));
  checked(await db.from('quillbot_user_controls').update({status:'suspended'}).eq('user_id',id.userId));
 }
 store.db.close();console.log('CLEANUP disposable writer access revoked; no customer balances changed');
}
