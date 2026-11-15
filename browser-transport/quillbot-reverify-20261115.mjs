import fs from 'node:fs';import assert from 'node:assert/strict';import {db} from '../runtime/db.mjs';import {encryptQuillBotSession,decryptQuillBotSession} from '../src/lib/quillbot-session.server.ts';import {WriterStore} from './writer-store.mjs';
const identities=JSON.parse(decryptQuillBotSession(fs.readFileSync(new URL('../.secrets/reverify-writer-tests.enc',import.meta.url),'utf8')));
assert.equal(identities.length,2);
const origin='https://quillbot.topratedseotools.com',base=origin+'/__qbtest';
const checked=r=>{if(r.error)throw Error('Validation database operation failed: '+r.error.code);return r.data;};
const store=new WriterStore(new URL('../.secrets/quillbot-writers.sqlite',import.meta.url).pathname);
const sessions=[],launchUrls=[];
for(const [i,id] of identities.entries()){
 const grants=checked(await db.from('tool_access_grants').select('id,notes').eq('user_id',id.userId).eq('tool_slug','quillbot'));
 assert.ok(grants.length&&grants.every(g=>/validation/i.test(g.notes)));
 checked(await db.from('tool_access_grants').update({status:'active',expires_at:new Date(Date.now()+3600000).toISOString()}).eq('user_id',id.userId).eq('tool_slug','quillbot'));
 checked(await db.from('quillbot_user_controls').upsert({user_id:id.userId,status:'active'},{onConflict:'user_id'}));
 let r=await fetch(base+'/__trst/app-login',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({email:id.email,password:id.password})});assert.equal(r.status,200);const jwt=(await r.json()).access_token;
 const devices=checked(await db.from('quillbot_devices').select('device_fingerprint').eq('user_id',id.userId).limit(1));
 const h={origin:'https://topratedseotools.com',authorization:'Bearer '+jwt,...(devices[0]?{cookie:'trst_qb_device='+devices[0].device_fingerprint}:{})};
 r=await fetch(base+'/__trst/launch',{method:'POST',headers:h});assert.equal(r.status,200);assert.equal(r.headers.get('access-control-allow-origin'),'https://topratedseotools.com');const ticket=await r.json();
 r=await fetch(ticket.launch_url,{redirect:'manual',headers:h});assert.equal(r.status,302);assert.equal(r.headers.get('location'),'/paraphrasing-tool');
 const cookie=r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
 const replay=await fetch(ticket.launch_url,{redirect:'manual'});assert.equal(replay.status,401);
 r=await fetch(base+'/__trst/launch',{method:'POST',headers:h});assert.equal(r.status,200);launchUrls.push((await r.json()).launch_url);
 sessions.push({userId:id.userId,cookie,jwt});
 const state=await fetch(base+'/__trst/auth-state',{headers:{cookie}}).then(r=>r.json());assert.equal(state.uid,id.userId);assert.equal(state.premium,true);
 console.log('PASS writer '+(i+1)+' public launch, one-time ticket, private Premium identity');
}
const texts=['Fresh vegetables from nearby farms support healthy family meals.','Reading every day helps students improve their writing skills.'];
const operations=[];
await Promise.all(sessions.map(async(s,i)=>{
 const headers={cookie:s.cookie,origin,'content-type':'application/json','platform-type':'webapp','qb-product':'paraphraser'};
 let r=await fetch(base+'/api/utils/sentence-spiltter',{method:'POST',headers,body:JSON.stringify({fallback:true,text:texts[i]})});assert.equal(r.status,200);const op=r.headers.get('x-trst-operation');assert.ok(op);operations[i]=op;await r.text();
 r=await fetch(base+'/api/paraphraser/single-paraphrase/2',{method:'POST',headers:{...headers,'x-trst-operation':op},body:JSON.stringify({fthresh:-1,autoflip:false,wikify:false,inputLang:'en',strength:2,quoteIndex:-1,text:texts[i],frozenWords:[],nBeams:4,freezeQuotes:true,preferActive:false,dialect:'US',promptVersion:'v2',multilingualModelVersion:'v2'})});assert.equal(r.status,200);const result=await r.json();
 const outputs=[];const scan=(v,k='')=>{if(typeof v==='string'&&/^(alt|text|para|paraphrase|output|sent)$/.test(k))outputs.push(v);else if(Array.isArray(v))v.forEach(x=>scan(x,k));else if(v&&typeof v==='object')Object.entries(v).forEach(([k,x])=>scan(x,k));};scan(result);
 const output=outputs.find(x=>x.trim()&&x.trim()!==texts[i]);assert.ok(output,'Actual paraphrase required');
 r=await fetch(base+'/__trst/history',{method:'POST',headers,body:JSON.stringify({input:texts[i],output})});assert.equal(r.status,200);
 console.log('PASS writer '+(i+1)+' concurrent real paraphrase and saved result');
}));
for(const [i,s] of sessions.entries()){
 const h={cookie:s.cookie};
 for(let n=0;n<2;n++){const r=await fetch(base+'/__trst/history',{headers:h});assert.equal(r.status,200);const result=await r.json();assert.ok(result.items.some(v=>v.input===texts[i]));assert.ok(result.items.every(v=>v.input!==texts[1-i]));}
 let r=await fetch(base+'/__trst/history?user_id='+sessions[1-i].userId,{headers:h});assert.equal(r.status,403);
 r=await fetch(base+'/api/paraphraser/single-paraphrase/2',{method:'POST',headers:{...h,origin,'content-type':'application/json','x-trst-operation':operations[1-i]},body:JSON.stringify({text:texts[1-i]})});assert.equal(r.status,403);
 r=await fetch(base+'/__trst/admin/writers',{headers:{authorization:'Bearer '+s.jwt}});assert.equal(r.status,403);
 console.log('PASS writer '+(i+1)+' persisted own history; cross-writer history/operation and admin access blocked');
}
const limit=store.status(sessions[0].userId).daily_limit;
try{store.setLimit(sessions[0].userId,store.status(sessions[0].userId).used);const r=await fetch(base+'/api/utils/sentence-spiltter',{method:'POST',headers:{cookie:sessions[0].cookie,origin,'content-type':'application/json'},body:JSON.stringify({text:'Daily limit verification.'})});assert.equal(r.status,429);}finally{store.setLimit(sessions[0].userId,limit);}
console.log('PASS immediate daily limit enforcement');
fs.writeFileSync(new URL('../.secrets/reverification-sessions.enc',import.meta.url),encryptQuillBotSession(JSON.stringify(sessions)),{mode:0o600});
fs.writeFileSync(new URL('../.secrets/reverification-launches.enc',import.meta.url),encryptQuillBotSession(JSON.stringify(launchUrls)),{mode:0o600});
store.db.close();console.log('PASS fresh public two-writer verification');
