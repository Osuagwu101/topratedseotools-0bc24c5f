import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {spawn} from "node:child_process";
import {createHash,randomUUID} from "node:crypto";
import {createClient} from "@supabase/supabase-js";
import {signAwsClaims,secondsUntilWatReset,watUsageDay} from "../src/lib/phrasly-extension/protocol.server.ts";
const dir=process.env.PHRASLY_ACCEPTANCE_PRIVATE_DIR;
const env=JSON.parse(fs.readFileSync(path.join(dir,"stage-env.private.json"),"utf8"));
const writer=JSON.parse(fs.readFileSync(path.join(dir,"acceptance-writer.private.json"),"utf8"));
const source=JSON.parse(fs.readFileSync(path.join(dir,"aws-account-snapshot.private.json"),"utf8"));
function client(key){return createClient(env.SUPABASE_URL,key,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>{const h=new Headers(init?.headers);if(key.startsWith("sb_")&&h.get("authorization")==="Bearer "+key)h.delete("authorization");h.set("apikey",key);return fetch(input,{...init,headers:h});}}});}
const db=client(env.SUPABASE_SERVICE_ROLE_KEY),results=[],restore=[];
async function data(q){const r=await q;if(r.error)throw new Error(r.error.message);return r.data;}
async function change(table,match,record){let q=db.from(table).update(record);for(const [k,v]of Object.entries(match))q=q.eq(k,v);await data(q);}
async function temporarily(table,match,before,after){restore.unshift(()=>change(table,match,before));await change(table,match,after);}
const origin="http://127.0.0.1:3330";
let app,token,opening;
async function request(route,options={}){const r=await fetch(origin+route,{...options,signal:AbortSignal.timeout(20000)});return {status:r.status,body:await r.json(),headers:r.headers};}
const handoff=()=>request("/ext-handoff.php?tool_id=phrasly&feature=humanizer",{headers:{authorization:"Bearer "+token}});
const fulfill=t=>request("/ext-fulfill.php?"+new URLSearchParams({payload:t.payload,signature:t.signature}));
const usage=t=>request("/ext-check-usage.php",{method:"POST",body:new URLSearchParams({record_token:t,feature:"humanizer"})});
async function test(name,run){await run();results.push({name,status:"PASS"});console.log("PASS "+name);}
try{
 const all=await data(db.from("phrasly_oneclick_feature_grants").select("user_id"));
 assert.ok(all.every(g=>g.user_id===writer.uid),"only the acceptance writer may be configured during this matrix");
 const profile=await data(db.from("profiles").select("account_status").eq("id",writer.uid).single());
 const grant=await data(db.from("tool_access_grants").select("id,status,expires_at").eq("user_id",writer.uid).eq("tool_slug","phrasly").single());
 const feature=await data(db.from("phrasly_oneclick_feature_grants").select("daily_limit,enabled").eq("user_id",writer.uid).eq("feature_key","humanizer").single());
 const account=await data(db.from("phrasly_oneclick_accounts").select("id,enabled,capacity").single());
 const config=await data(db.from("phrasly_oneclick_tool_config").select("enabled").eq("tool_id","phrasly").single());
 const signed=await data(client(env.SUPABASE_PUBLISHABLE_KEY||env.VITE_SUPABASE_PUBLISHABLE_KEY).auth.signInWithPassword({email:writer.email,password:writer.password}));
 token=signed.session.access_token;
 const log=fs.openSync(path.join(dir,"phase5-closeout-nitro.log"),"w");
 app=spawn(process.execPath,[".output/server/index.mjs"],{cwd:process.cwd(),env:{...process.env,...env,PORT:"3330",HOST:"127.0.0.1"},stdio:["ignore",log,log]});
 for(let i=0;i<60;i++){try{if((await request("/ext-whoami.php")).status===200)break;}catch{} await new Promise(r=>setTimeout(r,300));}
 const current=async()=>await data(db.from("phrasly_oneclick_daily_usage").select("used").eq("user_id",writer.uid).eq("feature_key","humanizer").eq("day",watUsageDay(Math.floor(Date.now()/1000))).maybeSingle());
 await test("real destination handoff, cookie parity and free opening",async()=>{
  const before=(await current())?.used||0; const h=await handoff();assert.equal(h.status,200);
  opening=(await fulfill(h.body)).body;assert.equal(opening.ok,true);
  assert.deepEqual(opening.cookies,JSON.parse(source.accounts[0].cookie_json));
  assert.equal((await current())?.used||0,before);
 });
 await test("missing and invalid bearer authentication rejected",async()=>{
  assert.equal((await request("/ext-handoff.php")).status,401);
  assert.equal((await request("/ext-handoff.php",{headers:{authorization:"Bearer invalid"}})).status,401);
 });
 await test("expired handoff, expired record and invalid signature rejected",async()=>{
  const expired=signAwsClaims({uid:writer.uid,tool_id:"phrasly",feature:"humanizer",exp:Math.floor(Date.now()/1000)-60},env.PHRASLY_AWS_EXTENSION_GATE_SECRET);
  assert.equal((await fulfill(expired)).body.error,"token_expired");
  assert.equal((await usage(expired.payload+"."+expired.signature)).body.error,"token_expired");
  assert.equal((await fulfill({...expired,signature:"0".repeat(64)})).body.error,"bad_signature");
 });
 await test("popup identity, expiry and revocation enforced",async()=>{
  const r=await request("/ext-session",{method:"POST",headers:{authorization:"Bearer "+token}});
  const session=r.headers.get("set-cookie").match(/PHPSESSID=([^;]+)/)[1];
  const hash=createHash("sha256").update(session).digest("hex");
  const identity=()=>request("/ext-whoami.php",{headers:{"X-Ext-Session":session}});
  assert.equal((await identity()).body.ok,true);
  const stored=await data(db.from("phrasly_oneclick_popup_sessions").select("expires_at,revoked_at").eq("token_hash",hash).single());
  await temporarily("phrasly_oneclick_popup_sessions",{token_hash:hash},stored,{expires_at:new Date(Date.now()-60000).toISOString()});
  assert.equal((await identity()).body.ok,false);
  await change("phrasly_oneclick_popup_sessions",{token_hash:hash},{...stored,revoked_at:new Date().toISOString()});
  assert.equal((await identity()).body.ok,false);
  await change("phrasly_oneclick_popup_sessions",{token_hash:hash},stored);
 });
 await test("expired staff grant and revoked access rejected",async()=>{
  await temporarily("tool_access_grants",{id:grant.id},{status:grant.status,expires_at:grant.expires_at},{expires_at:new Date(Date.now()-60000).toISOString()});
  assert.equal((await handoff()).body.error,"no_access");
  await change("tool_access_grants",{id:grant.id},{expires_at:grant.expires_at,status:"revoked"});
  assert.equal((await handoff()).body.error,"no_access");
  await change("tool_access_grants",{id:grant.id},{status:grant.status,expires_at:grant.expires_at});
 });
 await test("suspended destination writer rejected",async()=>{
  await temporarily("profiles",{id:writer.uid},profile,{account_status:"suspended"});
  assert.equal((await handoff()).body.error,"account_inactive");
  await change("profiles",{id:writer.uid},profile);
 });
 await test("account exhaustion returns no_accounts_available and restores",async()=>{
  const h=await handoff();
  await temporarily("phrasly_oneclick_accounts",{id:account.id},{enabled:account.enabled},{enabled:false});
  const r=await fulfill(h.body);assert.equal(r.status,503);assert.equal(r.body.error,"no_accounts_available");
  await change("phrasly_oneclick_accounts",{id:account.id},{enabled:account.enabled});
 });
 await test("full capacity denies additional assignments",async()=>{
  await temporarily("phrasly_oneclick_accounts",{id:account.id},{capacity:account.capacity},{capacity:1});
  const ids=await Promise.all(Array.from({length:4},()=>data(db.rpc("phrasly_oneclick_assign_account",{p_user:randomUUID()}))));
  assert.ok(ids.every(id=>id===null));
  await change("phrasly_oneclick_accounts",{id:account.id},{capacity:account.capacity});
 });
 await test("eight simultaneous fulfillments reuse one assignment without counting opens",async()=>{
  const before=(await current())?.used||0,h=await handoff();
  const responses=await Promise.all(Array.from({length:8},()=>fulfill(h.body)));
  assert.ok(responses.every(r=>r.status===200&&r.body.ok===true));
  const rows=await data(db.from("phrasly_oneclick_assignments").select("account_id").eq("user_id",writer.uid));
  assert.equal(rows.length,1);assert.equal(rows[0].account_id,account.id);
  assert.equal((await current())?.used||0,before);
 });
 await test("quota denial blocks opening/actions and reports WAT reset",async()=>{
  const used=(await current()).used;assert.ok(used>0);
  const h=await handoff();
  await temporarily("phrasly_oneclick_feature_grants",{user_id:writer.uid,feature_key:"humanizer"},feature,{daily_limit:used});
  const r=await fulfill(h.body);assert.equal(r.status,429);
  assert.ok(Math.abs(r.body.resets_in-secondsUntilWatReset(Math.floor(Date.now()/1000)))<5);
  const denied=await usage(opening.record_token);assert.equal(denied.body.allowed,false);
  assert.equal((await current()).used,used);
  await change("phrasly_oneclick_feature_grants",{user_id:writer.uid,feature_key:"humanizer"},feature);
 });
 await test("six simultaneous counted attempts increment atomically",async()=>{
  const before=(await current()).used;assert.ok(before+6<=feature.daily_limit);
  const responses=await Promise.all(Array.from({length:6},()=>usage(opening.record_token)));
  assert.ok(responses.every(r=>r.status===200&&r.body.allowed===true));
  assert.deepEqual(responses.map(r=>r.body.used).sort((a,b)=>a-b),Array.from({length:6},(_,i)=>before+i+1));
  assert.equal((await current()).used,before+6);
 });
 await test("disabled tool configuration rejects fulfillment",async()=>{
  const h=await handoff();
  await temporarily("phrasly_oneclick_tool_config",{tool_id:"phrasly"},config,{enabled:false});
  assert.equal((await fulfill(h.body)).body.error,"tool_not_found");
  await change("phrasly_oneclick_tool_config",{tool_id:"phrasly"},config);
 });
}catch(e){results.push({status:"FAIL",error:e.message});process.exitCode=1;}
finally{
 const errors=[];
 for(const action of restore)try{await action();}catch(e){errors.push(e.message);}
 if(app&&app.exitCode===null)app.kill();
 const evidence={utc:new Date().toISOString(),environment:"actual destination Supabase and compiled Nitro",results,restoration_errors:errors,financial_mutations:false,provider_generation_requests:0};
 fs.writeFileSync(path.join(dir,"phase5-final-matrix.json"),JSON.stringify(evidence,null,2));
 console.log(JSON.stringify(evidence));
 if(errors.length)process.exitCode=1;
}
