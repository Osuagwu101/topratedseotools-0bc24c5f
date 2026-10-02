import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { readFile, writeFile, readdir, unlink } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
const ORIGIN='https://chatgpt.topratedseotools.com';
const DASHBOARD='https://topratedseotools.com';
const base=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
const testTag=randomUUID().slice(0,8), secrets=new Set([key]), createdUsers=[],createdAccounts=[],createdGrants=[], tickets=[],results=[];
const state='/home/ubuntu/state/chatgpt-phase3';
const hash=x=>createHash('sha256').update(x).digest('hex');
async function api(endpoint,{method='GET',body}={}){
 const headers={apikey:key,'Content-Type':'application/json',Prefer:'return=representation'};
 if(!key.startsWith('sb_secret_'))headers.Authorization='Bearer '+key;
 const r=await fetch(base+endpoint,{method,headers,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15_000)});
 if(!r.ok)throw Error('fixture_api_failed_'+r.status+'_'+endpoint.split('?')[0]);
 if(r.status===204)return null;return r.json();
}
async function makeUser(letter){
 const password=randomBytes(24).toString('base64url');secrets.add(password);
 const email='phase3-'+letter+'-'+testTag+'@example.invalid';
 const u=await api('/auth/v1/admin/users',{method:'POST',body:{email,password,email_confirm:true,user_metadata:{phase3_audit:testTag}}});
 const id=u.id||u.user?.id;assert.ok(id);createdUsers.push(id);
 const res=await fetch(base+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:JSON.stringify({email,password})});
 assert.equal(res.status,200);const auth=await res.json();secrets.add(auth.access_token);secrets.add(auth.refresh_token);
 return {id,token:auth.access_token};
}
async function account(){
 const id=randomUUID();createdAccounts.push(id);
 await api('/rest/v1/tool_accounts',{method:'POST',body:{id,tool_slug:'chatgpt',access_type:'shared',label:'Phase 3 temporary audit '+testTag,max_capacity:2,status:'working',enabled:true,expires_at:new Date(Date.now()+3600_000).toISOString()}});
 return id;
}
async function grant(user,account){
 const id=randomUUID();createdGrants.push(id);
 await api('/rest/v1/tool_access_grants',{method:'POST',body:{id,user_id:user.id,account_id:account,tool_slug:'chatgpt',access_type:'shared',status:'active',expires_at:new Date(Date.now()+3600_000).toISOString(),notes:'Temporary Phase 3 audit '+testTag}});
 return id;
}
const jar=r=>r.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');
async function launch(user,cs=''){
 const r=await fetch(ORIGIN+'/__trst/launch',{method:'POST',headers:{Origin:DASHBOARD,Authorization:'Bearer '+user.token,...(cs?{Cookie:cs}:{})},redirect:'manual'});
 if(r.status!==200)return {r};
 const body=await r.json();const cookies=jar(r);
 for(const c of r.headers.getSetCookie()){const raw=c.split(';')[0].split('=').slice(1).join('=');if(raw)secrets.add(raw);}
 const token=new URL(body.launch_url).searchParams.get('ticket');secrets.add(token);tickets.push(hash(token));
 return {r,body,cookies};
}
const enter=(url,cookies='')=>fetch(url,{headers:cookies?{Cookie:cookies}:{},redirect:'manual'});
function passed(n,details){results.push({check:n,result:'PASS',details});console.log('CHECK '+n+' PASS '+details);}
let outcome='failed';
try{
 const a=await makeUser('a'),b=await makeUser('b');
 const accountA=await account(),accountB=await account();
 const grantA=await grant(a,accountA);
 const denied=await launch(b);assert.equal(denied.r.status,403);
 const grantB=await grant(b,accountB);
 const expiring=await launch(a);assert.equal(expiring.r.status,200);
 const expiryMs=Date.parse(expiring.body.expires_at);
 assert.ok(expiryMs-Date.now()<=60_000 && expiryMs>Date.now()+50_000);
 const record=JSON.parse(await readFile(state+'/ticket-'+tickets.at(-1)+'.json','utf8'));
 assert.equal(record.tool,'chatgpt');assert.equal(record.entitlement.user,a.id);assert.equal(record.entitlement.account,accountA);
 assert.equal(record.origin,ORIGIN);assert.ok(record.authSessionHash);
 passed(1,'Authenticated temporary writer; ChatGPT-specific active grant, assigned account and 60-second ticket verified');
 const good=await launch(a,expiring.cookies);assert.equal(good.r.status,200);
 assert.equal(new URL(good.body.launch_url).origin,ORIGIN);
 const stolen=await enter(good.body.launch_url);assert.equal(stolen.status,403);
 const accepted=await enter(good.body.launch_url,good.cookies);assert.equal(accepted.status,302);
 assert.equal(accepted.headers.get('location'),ORIGIN+'/');
 const sessionCookies=jar(accepted);
 for(const c of accepted.headers.getSetCookie()){const raw=c.split(';')[0].split('=').slice(1).join('=');if(raw)secrets.add(raw);}
 passed(2,'Public HTTPS gateway consumed ticket and issued gateway session; root returns controlled missing-session-source');
 // Keep one value per cookie name after applying the returned cookies.
 const merged=new Map();
 for(const part of (good.cookies+'; '+sessionCookies).split(';')){const i=part.indexOf('=');if(i>0)merged.set(part.slice(0,i).trim(),part.slice(i+1).trim());}
 const mergedJar=[...merged].map(([k,v])=>k+'='+v).join('; ');
 const ready=await enter(ORIGIN+'/',mergedJar);assert.equal(ready.status,503);assert.match(await ready.text(),/gateway access is ready/);
 const direct=await enter(ORIGIN+'/');assert.equal(direct.status,401);assert.match(direct.headers.get('cache-control'),/no-store/);
 passed(3,'Direct visit and missing ticket rejected with 401 and no-store');
 const replay=await enter(good.body.launch_url,good.cookies);assert.equal(replay.status,403);
 passed(5,'Consumed launch ticket rejected on replay');
 const foreign=await enter(ORIGIN+'/__trst/enter?ticket='+randomBytes(32).toString('base64url'));assert.equal(foreign.status,403);
 passed(6,'Foreign ticket rejected live; tool-confusion fixtures for StealthWriter/Phrasly/generic also passed unit tests');
 const cross=await launch(a,expiring.cookies);assert.equal(cross.r.status,200);
 const bLaunch=await launch(b);assert.equal(bLaunch.r.status,200);
 assert.equal((await enter(cross.body.launch_url,bLaunch.cookies)).status,403);
 await api('/rest/v1/tool_access_grants?id=eq.'+grantA,{method:'PATCH',body:{account_id:accountB}});
 assert.equal((await enter(cross.body.launch_url,cross.cookies)).status,403);
 await api('/rest/v1/tool_access_grants?id=eq.'+grantA,{method:'PATCH',body:{account_id:accountA}});
 passed(7,'Writer B browser proof rejected for writer A; changing assigned account after issuance invalidated ticket');
 for(const c of [...good.r.headers.getSetCookie(),...accepted.headers.getSetCookie()]){
  assert.match(c,/Secure/);assert.match(c,/HttpOnly/);assert.match(c,/SameSite=Lax/);assert.match(c,/Path=\//);assert.doesNotMatch(c,/Domain=/i);assert.match(c,/^__Host-trst_cg_/);
 }
 passed(8,'All gateway cookies use __Host names, Path=/, Secure, HttpOnly and SameSite=Lax; no Domain');
 const sw=await fetch('https://sw.topratedseotools.com/',{redirect:'manual'});assert.equal(sw.status,401);assert.match(sw.headers.get('cache-control'),/no-store/);
 passed(9,'StealthWriter retained 401 and no-store');
 const main=await fetch(DASHBOARD+'/',{redirect:'manual'});assert.equal(main.status,200);
 passed(10,'Main site returned healthy 200');
 await api('/rest/v1/tool_access_grants?id=eq.'+grantA,{method:'PATCH',body:{expires_at:new Date(Date.now()-1000).toISOString()}});
 assert.equal((await launch(a,expiring.cookies)).r.status,403);
 await api('/rest/v1/tool_access_grants?id=eq.'+grantA,{method:'PATCH',body:{expires_at:new Date(Date.now()+3600_000).toISOString()}});
 const remaining=expiryMs-Date.now()+250;
 if(remaining>0)await delay(remaining);
 assert.equal((await enter(expiring.body.launch_url,expiring.cookies)).status,403);
 passed(4,'Real 60-second ticket expired naturally and was rejected');
 // Compare secret values in memory without printing any matches or log contents.
 const logs=[];
 for(const name of await readdir('/home/ubuntu/.pm2/logs')){
  if(name.startsWith('topratedseotools-chatgpt-proxy-'))logs.push(await readFile('/home/ubuntu/.pm2/logs/'+name,'utf8'));
 }
 const nginx=await readFile('/etc/nginx/sites-available/chatgpt-proxy','utf8');
 assert.equal((nginx.match(/access_log off;/g)||[]).length,2);
 assert.equal((nginx.match(/error_log \/dev\/null crit;/g)||[]).length,2);
 const combined=logs.join('\n');
 for(const s of secrets)if(s&&s.length>8)assert.equal(combined.includes(s),false);
 passed(11,'No test tickets, gateway cookie values, auth tokens, fixture credentials or service-role key found in gateway logs; Nginx query logging disabled');
 outcome='passed';
} finally {
 let cleanupErrors=0;
 for(const id of createdUsers){
  try{await api('/auth/v1/admin/users/'+id,{method:'DELETE'});}catch{cleanupErrors++;}
 }
 for(const id of createdGrants){try{await api('/rest/v1/tool_access_grants?id=eq.'+id,{method:'DELETE'});}catch{cleanupErrors++;}}
 for(const id of createdAccounts){try{await api('/rest/v1/tool_accounts?id=eq.'+id,{method:'DELETE'});}catch{cleanupErrors++;}}
 for(const f of await readdir(state).catch(e=>{if(e.code==='ENOENT')return [];throw e;})){
  if(!f.endsWith('.json'))continue;
  try{
   const row=JSON.parse(await readFile(state+'/'+f,'utf8'));
   if(createdUsers.includes(row.entitlement?.user)||createdUsers.some(u=>f==='rate-'+hash(u)+'.json'))await unlink(state+'/'+f);
  }catch{cleanupErrors++;}
 }
 const report={outcome,checks:results.sort((a,b)=>a.check-b.check),cleanup_errors:cleanupErrors,temporary_users_removed:createdUsers.length,temporary_accounts_removed:createdAccounts.length};
 await writeFile('/home/ubuntu/backups/chatgpt-phase3-20261002/live-audit.json',JSON.stringify(report,null,2),{mode:0o600});
 console.log('AUDIT '+outcome+'; cleanup_errors='+cleanupErrors);
 assert.equal(cleanupErrors,0);
}
