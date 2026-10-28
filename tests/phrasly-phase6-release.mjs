import assert from "node:assert/strict";
import fs from "node:fs";import path from "node:path";import {spawn} from "node:child_process";
import {createHash} from "node:crypto";import {createClient} from "@supabase/supabase-js";
import {decryptPhraslySession} from "../src/lib/phrasly-session.server.ts";
const dir=process.env.PHRASLY_ACCEPTANCE_PRIVATE_DIR,root=process.cwd();
const env=JSON.parse(fs.readFileSync(path.join(dir,"stage-env.private.json"),"utf8"));Object.assign(process.env,env);
const source=JSON.parse(fs.readFileSync(path.join(dir,"aws-account-snapshot.private.json"),"utf8"));
const writer=JSON.parse(fs.readFileSync(path.join(dir,"acceptance-writer.private.json"),"utf8"));
const packageFile=path.join(dir,"TopRated-Phrasly-Access.zip");assert.ok(fs.existsSync(packageFile));
function client(key){return createClient(env.SUPABASE_URL,key,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>{const headers=new Headers(init?.headers);if(key.startsWith("sb_")&&headers.get("authorization")==="Bearer "+key)headers.delete("authorization");headers.set("apikey",key);return fetch(input,{...init,headers});}}});}
const db=client(env.SUPABASE_SERVICE_ROLE_KEY),pub=client(env.SUPABASE_PUBLISHABLE_KEY||env.VITE_SUPABASE_PUBLISHABLE_KEY);
async function data(q){const r=await q;if(r.error)throw new Error(r.error.message);return r.data;}
const results=[];let app,qaToken,ownerToken,qaGrant;
const origin=process.env.PHRASLY_RELEASE_TEST_ORIGIN||"http://127.0.0.1:3331";
async function call(route,token,body){
 const r=await fetch(origin+route,{method:body===undefined?"GET":"POST",headers:{...(token?{authorization:"Bearer "+token}:{}),...(body!==undefined?{"Content-Type":"application/json"}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});
 const bytes=new Uint8Array(await r.arrayBuffer());let value;
 try{value=JSON.parse(new TextDecoder().decode(bytes));}catch{}
 return {status:r.status,body:value,bytes,headers:r.headers};
}
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
async function check(name,fn){await fn();results.push({name,status:"PASS"});console.log("PASS "+name);}
try{
 if(!process.env.PHRASLY_RELEASE_TEST_ORIGIN){
  const log=fs.openSync(path.join(dir,"phase6-release-test-nitro.log"),"w");
  app=spawn(process.execPath,[".output/server/index.mjs"],{cwd:root,env:{...process.env,...env,PHRASLY_EXTENSION_PACKAGE_PATH:packageFile,HOST:"127.0.0.1",PORT:"3331"},stdio:["ignore",log,log]});
  for(let i=0;i<60;i++){try{if((await call("/ext-whoami.php")).status===200)break;}catch{}await new Promise(r=>setTimeout(r,300));}
 }
 const qa=await data(pub.auth.signInWithPassword({email:writer.email,password:writer.password}));qaToken=qa.session.access_token;
 fs.writeFileSync(path.join(dir,"phase6-writer-session.private.json"),JSON.stringify(qa.session));
 const role=await data(db.from("user_roles").select("user_id").eq("role","admin").eq("is_active",true).eq("is_super_admin",true).single());
 const person=await data(db.auth.admin.getUserById(role.user_id));const ownerEmail=person.user.email;
 const link=await data(db.auth.admin.generateLink({type:"magiclink",email:ownerEmail}));
 const login=await data(pub.auth.verifyOtp({token_hash:link.properties.hashed_token,type:"magiclink"}));ownerToken=login.session.access_token;
 fs.writeFileSync(path.join(dir,"phase6-owner-session.private.json"),JSON.stringify(login.session));
 qaGrant=await data(db.from("tool_access_grants").select("expires_at").eq("user_id",writer.uid).eq("tool_slug","phrasly").single());
 const grant=(email,humanizer=20,expires_at=null)=>call("/ext-admin",ownerToken,{action:"grant",email,humanizer,ai_detector:20,expires_at});
 await check("signed-out endpoints reject access",async()=>{
  assert.equal((await call("/ext-admin")).status,401);assert.equal((await call("/ext-status")).status,401);assert.equal((await call("/ext-package",null,{})).status,401);
 });
 await check("writer cannot access owner administration",async()=>{
  assert.equal((await call("/ext-admin",qaToken)).status,403);
  assert.equal((await call("/ext-admin",qaToken,{action:"grant",email:ownerEmail,humanizer:20,ai_detector:20})).status,403);
 });
 await check("active existing Super Admin reads sanitized account and writer state",async()=>{
  const r=await call("/ext-admin",ownerToken);assert.equal(r.status,200);
  assert.ok(r.body.accounts.length);assert.ok(!JSON.stringify(r.body).includes("encrypted_cookies"));assert.ok(!JSON.stringify(r.body).includes('"cookies":'));
 });
 await check("owner receives explicit in-house feature grants",async()=>{
  assert.equal((await grant(ownerEmail)).status,200);
  assert.equal((await call("/ext-status",ownerToken)).status,200);
 });
 await check("writer grant updates allowance and restores original allowance",async()=>{
  assert.equal((await grant(writer.email,19,qaGrant.expires_at)).status,200);
  assert.equal((await call("/ext-status",qaToken)).body.features.find(f=>f.key==="humanizer").limit,19);
  assert.equal((await grant(writer.email,20,qaGrant.expires_at)).status,200);
 });
 await check("revoked feature grant blocks status, handoff and package until restored",async()=>{
  assert.equal((await call("/ext-admin",ownerToken,{action:"revoke",user_id:writer.uid})).status,200);
  assert.equal((await call("/ext-status",qaToken)).status,403);
  assert.equal((await call("/ext-handoff.php?feature=humanizer",qaToken)).status,403);
  assert.equal((await call("/ext-package",qaToken,{})).status,403);
  assert.equal((await grant(writer.email,20,qaGrant.expires_at)).status,200);
 });
 await check("unknown writer and invalid daily limits rejected",async()=>{
  assert.equal((await grant("unassigned-phase6@example.test")).status,404);
  assert.equal((await grant(writer.email,0,qaGrant.expires_at)).status,400);
 });
 await check("foreign-domain cookies rejected without changing encrypted account",async()=>{
  const before=await data(db.from("phrasly_oneclick_accounts").select("id,label,capacity,enabled,encrypted_cookies").single());
  const r=await call("/ext-admin",ownerToken,{action:"save_account",account_id:before.id,label:before.label,capacity:before.capacity,enabled:before.enabled,cookies:[{name:"session",value:"fixture",domain:"example.com"}]});
  assert.equal(r.status,400);
  const after=await data(db.from("phrasly_oneclick_accounts").select("encrypted_cookies").eq("id",before.id).single());assert.equal(after.encrypted_cookies,before.encrypted_cookies);
 });
 await check("owner refresh preserves original AWS cookie metadata encrypted at rest",async()=>{
  const before=await data(db.from("phrasly_oneclick_accounts").select("id,label,capacity,enabled").single());
  const cookies=JSON.parse(source.accounts[0].cookie_json);
  const r=await call("/ext-admin",ownerToken,{action:"save_account",account_id:before.id,label:before.label,capacity:before.capacity,enabled:before.enabled,cookies});
  assert.equal(r.status,200);assert.deepEqual(r.body,{ok:true});
  const after=await data(db.from("phrasly_oneclick_accounts").select("encrypted_cookies").eq("id",before.id).single());
  assert.deepEqual(JSON.parse(decryptPhraslySession(after.encrypted_cookies)).authenticated_cookies,cookies);
 });
 await check("assigned writer downloads the exact enabled extension package",async()=>{
  const r=await call("/ext-package",qaToken,{});assert.equal(r.status,200);
  assert.equal(sha(r.bytes),sha(fs.readFileSync(packageFile)));
  assert.ok(r.headers.get("content-disposition").includes("TopRated-Phrasly-Access.zip"));
 });
 await check("private pages, assets and no-index headers respond correctly",async()=>{
  for(const page of ["/phrasly","/admin/phrasly"]){
   const r=await call(page);assert.equal(r.status,200);assert.ok(r.headers.get("x-robots-tag").includes("noindex"));assert.ok(r.headers.get("content-security-policy").includes("frame-ancestors"));
  }
  for(const asset of ["writer.js","admin.js","workspace.css"])assert.equal((await call("/phrasly-assets/"+asset)).status,200);
 });
}catch(e){results.push({status:"FAIL",error:e.message});process.exitCode=1;}
finally{
 if(qaGrant&&ownerToken)try{await call("/ext-admin",ownerToken,{action:"grant",email:writer.email,humanizer:20,ai_detector:20,expires_at:qaGrant.expires_at});}catch{}
 if(app&&app.exitCode===null)app.kill();
 const evidence={utc:new Date().toISOString(),origin,results,financial_mutations:false,provider_generation_requests:0};
 fs.writeFileSync(path.join(dir,"phase6-release-acceptance.json"),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
}
