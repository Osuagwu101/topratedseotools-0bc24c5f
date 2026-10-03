import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createHash, randomBytes } from 'node:crypto';
const state=await mkdtemp(tmpdir()+'/trst-cg-unit-');
process.env.CHATGPT_PHASE3_STATE_DIR=state;
process.env.SUPABASE_URL='https://db.example';
process.env.SUPABASE_SERVICE_ROLE_KEY='test-only-key';
const {encryptPhase5State,CHATGPT_SESSION_FORMAT}=await import('../chatgpt-phase5/session-adapter.mjs');
const testVault=encryptPhase5State(JSON.stringify({
 version:3,
 cookies:[
  {name:'__Secure-next-auth.session-token.0',value:'opaque-0',domain:'.chatgpt.com',path:'/'},
  {name:'__Secure-next-auth.session-token.1',value:'opaque-1',domain:'.chatgpt.com',path:'/'},
 ],
}));
const {handle,ORIGIN}=await import('./gateway.mjs');
const hash=v=>createHash('sha256').update(v).digest('hex');
const jwt=user=>'eyJhbGciOiJub25lIn0.'+Buffer.from(JSON.stringify({sub:user,session_id:'session-'+user,exp:Math.floor(Date.now()/1000)+600})).toString('base64url')+'.testsignature';
let revoked=false, changedAccount=false, disabled=false, apiFails=false;
const registered=new Map();
global.fetch=async (url,options={})=>{
 if(apiFails) return new Response('{}',{status:500});
 const u=new URL(url);
 const json=x=>Response.json(x);
 if(u.pathname==='/auth/v1/user'){
  const token=options.headers.Authorization.slice(7);
  const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString());
  return json({id:claims.sub});
 }
 const who=u.searchParams.get('user_id')?.slice(3)||'writer-a';
 if(u.pathname.endsWith('/tool_settings'))return json([{enabled:!disabled,one_click_auth_enabled:true}]);
 if(u.pathname.endsWith('/profiles'))return json([{id:u.searchParams.get('id').slice(3),account_status:'active'}]);
 if(u.pathname.endsWith('/chatgpt_user_controls'))return json([{status:'active',device_limit:2}]);
 if(u.pathname.endsWith('/tool_orders'))return json([]);
 if(u.pathname.endsWith('/tool_access_grants')){
  if(who==='ineligible'||revoked)return json([]);
  return json([{id:'grant-'+who,user_id:who,tool_slug:'chatgpt',account_id:changedAccount?'changed':'account-1',access_type:'shared',status:'active',expires_at:null}]);
 }
 if(u.pathname.endsWith('/tool_accounts'))return json([{id:'account-1',tool_slug:'chatgpt',access_type:'shared',enabled:true,status:'working',expires_at:null}]);
 if(u.pathname.endsWith('/tool_authorized_sessions'))return json([{tool_slug:'chatgpt',encrypted_payload:testVault,session_format:CHATGPT_SESSION_FORMAT,status:'stored',updated_at:null}]);
 if(u.hostname==='chatgpt.com')return new Response('<html><head></head><body><a href="https://chatgpt.com/c/1">ok</a></body></html>',{status:200,headers:{'content-type':'text/html; charset=utf-8'}});
 if(u.pathname.endsWith('/chatgpt_devices')){
  if(options.method==='POST'){
   const body=JSON.parse(options.body);registered.set(body.user_id,[{id:'device-'+body.user_id,device_fingerprint:body.device_fingerprint}]);return json([body]);
  }
  const list=registered.get(who)||[];
  return json(u.searchParams.has('device_fingerprint')?list.filter(d=>d.device_fingerprint===u.searchParams.get('device_fingerprint').slice(3)):list);
 }
 throw Error('unexpected test endpoint');
};
const issue=user=>handle(new Request(ORIGIN+'/__trst/launch',{method:'POST',headers:{Origin:'https://topratedseotools.com',Authorization:'Bearer '+jwt(user)}}));
const cookieJar=r=>r.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
const mergeCookies=(...jars)=>{const m=new Map();for(const jar of jars)for(const part of jar.split(';')){const i=part.indexOf('=');if(i>0)m.set(part.slice(0,i).trim(),part.slice(i+1).trim());}return [...m].map(([k,v])=>k+'='+v).join('; ');};
const enter=(url,cs)=>handle(new Request(url,{headers:cs?{Cookie:cs}:{}}));
const ticketFile=url=>state+'/ticket-'+hash(new URL(url).searchParams.get('ticket'))+'.json';
let issuedUrl, issuedCookies, gatewaySessionCookies;
await test('eligible writer gets exact ChatGPT-only 60-second launch',async()=>{
 const r=await issue('writer-a');assert.equal(r.status,200);
 const b=await r.json();issuedUrl=b.launch_url;issuedCookies=cookieJar(r);
 assert.equal(new URL(b.launch_url).origin,ORIGIN);assert.equal(new URL(b.launch_url).pathname,'/__trst/enter');
 const record=JSON.parse(await readFile(ticketFile(b.launch_url),'utf8'));
 assert.equal(record.tool,'chatgpt');assert.equal(record.entitlement.user,'writer-a');assert.equal(record.entitlement.account,'account-1');
 assert.equal(record.expires-record.created<=60_000,true);
 for(const c of r.headers.getSetCookie()){assert.match(c,/Secure/);assert.match(c,/HttpOnly/);assert.match(c,/SameSite=Lax/);assert.doesNotMatch(c,/Domain=/i);assert.match(c,/^__Host-/);}
});
await test('missing ticket returns controlled 401',async()=>assert.equal((await enter(ORIGIN+'/__trst/enter')).status,401));
await test('copied ticket without browser proof is rejected',async()=>assert.equal((await enter(issuedUrl)).status,403));
await test('another writer browser cannot redeem writer A ticket',async()=>{
 const b=await issue('writer-b');assert.equal(b.status,200);assert.equal((await enter(issuedUrl,cookieJar(b))).status,403);
});
await test('valid ticket consumed exactly once under concurrent requests',async()=>{
 const rs=await Promise.all([enter(issuedUrl,issuedCookies),enter(issuedUrl,issuedCookies)]);
 assert.deepEqual(rs.map(r=>r.status).sort(),[302,403]);
 const ok=rs.find(r=>r.status===302);
 assert.equal(ok.headers.get('Location'),ORIGIN+'/');
 assert.match(ok.headers.getSetCookie().join(';'),/__Host-trst_cg_gateway_v3=/);
 gatewaySessionCookies=mergeCookies(issuedCookies,cookieJar(ok));
 assert.equal((await enter(issuedUrl,issuedCookies)).status,403);
});
await test('Phase 5 uses the single account after valid Phase 3 gateway session',async()=>{
 const root=await handle(new Request(ORIGIN+'/',{headers:{Cookie:gatewaySessionCookies,Accept:'text/html'}}));assert.equal(root.status,200);
 const html=await root.text();assert.equal(html.includes('https://chatgpt.com/c/1'),false);
 const restricted=await handle(new Request(ORIGIN+'/settings',{headers:{Cookie:gatewaySessionCookies,Accept:'text/html'}}));assert.equal(restricted.status,403);assert.match(await restricted.text(),/restricted/);
 const asset=await handle(new Request(ORIGIN+'/__host/evil.example/app.js',{headers:{Cookie:gatewaySessionCookies}}));assert.equal(asset.status,403);
 const method=await handle(new Request(ORIGIN+'/',{method:'PROPFIND',headers:{Cookie:gatewaySessionCookies}}));assert.equal(method.status,405);
});
await test('expired ticket rejected',async()=>{
 const r=await issue('writer-c');const b=await r.json();const f=ticketFile(b.launch_url);const row=JSON.parse(await readFile(f,'utf8'));row.expires=Date.now()-1;await writeFile(f,JSON.stringify(row));
 assert.equal((await enter(b.launch_url,cookieJar(r))).status,403);
});
await test('StealthWriter/generic tool records rejected',async()=>{
 for(const tool of ['stealthwriter','phrasly','generic']){
  const t=randomBytes(32).toString('base64url');
  await writeFile(state+'/ticket-'+hash(t)+'.json',JSON.stringify({version:3,tool,origin:ORIGIN,status:'issued',expires:Date.now()+60_000}));
  assert.equal((await enter(ORIGIN+'/__trst/enter?ticket='+t,issuedCookies)).status,403);
 }
});
await test('altered, duplicate and wrong-host tickets rejected',async()=>{
 assert.equal((await enter(issuedUrl.replace('ticket=','ticket=x'),issuedCookies)).status,403);
 assert.equal((await enter(issuedUrl+'&ticket=duplicate',issuedCookies)).status,403);
 assert.equal((await enter(issuedUrl.replace('chatgpt.topratedseotools.com','sw.topratedseotools.com'),issuedCookies)).status,403);
});
await test('missing entitlement and changed assignment fail closed',async()=>{
 assert.equal((await issue('ineligible')).status,403);
 const r=await issue('writer-d');const b=await r.json();changedAccount=true;
 assert.equal((await enter(b.launch_url,cookieJar(r))).status,403);changedAccount=false;
 revoked=true;assert.equal((await issue('writer-e')).status,403);revoked=false;
});
await test('disabled tool and database outage fail closed',async()=>{
 disabled=true;assert.equal((await issue('writer-f')).status,403);disabled=false;
 apiFails=true;assert.equal((await issue('writer-f')).status,503);apiFails=false;
});
await test('untrusted CORS origin and unauthenticated launches rejected',async()=>{
 const evil=await handle(new Request(ORIGIN+'/__trst/launch',{method:'POST',headers:{Origin:'https://evil.example'}}));
 assert.equal(evil.status,403);assert.equal(evil.headers.has('Access-Control-Allow-Origin'),false);
 const anon=await handle(new Request(ORIGIN+'/__trst/launch',{method:'POST',headers:{Origin:'https://topratedseotools.com'}}));assert.equal(anon.status,401);
});
await rm(state,{recursive:true,force:true});
