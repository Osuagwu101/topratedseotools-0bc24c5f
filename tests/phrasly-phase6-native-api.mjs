/* Read-only public acceptance and fresh browser test session. No email is sent. */
import fs from "node:fs";import path from "node:path";import assert from "node:assert/strict";import {createHash} from "node:crypto";import {createClient} from "@supabase/supabase-js";
const dir=process.env.PHRASLY_ACCEPTANCE_PRIVATE_DIR,site="https://topratedseotools.com";
const env=JSON.parse(fs.readFileSync(path.join(dir,"stage-env.private.json"),"utf8"));
function client(key){return createClient(env.SUPABASE_URL,key,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>{const headers=new Headers(init?.headers);if(key.startsWith("sb_")&&headers.get("authorization")==="Bearer "+key)headers.delete("authorization");headers.set("apikey",key);return fetch(input,{...init,headers});}}});}
async function data(q){const r=await q;if(r.error)throw new Error(r.error.message);return r.data;}
const db=client(env.SUPABASE_SERVICE_ROLE_KEY),pub=client(env.SUPABASE_PUBLISHABLE_KEY||env.VITE_SUPABASE_PUBLISHABLE_KEY);
const role=await data(db.from("user_roles").select("user_id").eq("role","admin").eq("is_active",true).eq("is_super_admin",true).single());
const person=await data(db.auth.admin.getUserById(role.user_id));
const link=await data(db.auth.admin.generateLink({type:"magiclink",email:person.user.email}));
const login=await data(pub.auth.verifyOtp({token_hash:link.properties.hashed_token,type:"magiclink"}));
fs.writeFileSync(path.join(dir,"phase6-owner-session.private.json"),JSON.stringify(login.session));
const token=login.session.access_token,checks={};
for(const route of ["/ext-admin","/ext-status","/ext-package"]){const r=await fetch(site+route,{method:route==="/ext-package"?"POST":"GET"});assert.equal(r.status,401);checks["signed_out:"+route]=true;}
async function get(route,post=false){return fetch(site+route,{method:post?"POST":"GET",headers:{Authorization:"Bearer "+token},signal:AbortSignal.timeout(20000)});}
const state=await get("/ext-status");assert.equal(state.status,200);const s=await state.json();assert.equal(s.features.length,2);checks.explicit_writer_grants=true;
const admin=await get("/ext-admin");assert.equal(admin.status,200);const a=await admin.text();assert.ok(!a.includes("encrypted_cookies"));assert.ok(!a.includes('"cookies":'));checks.sanitized_admin=true;
const zip=await get("/ext-package",true);assert.equal(zip.status,200);
const sha=b=>createHash("sha256").update(b).digest("hex");
assert.equal(sha(new Uint8Array(await zip.arrayBuffer())),sha(fs.readFileSync(path.join(dir,"TopRated-Phrasly-Access.zip"))));checks.exact_enabled_package=true;
for(const route of ["/phrasly","/admin/phrasly"]){const r=await fetch(site+route);assert.equal(r.status,200);assert.ok(r.headers.get("x-robots-tag").includes("noindex"));assert.ok(r.headers.get("content-security-policy").includes("frame-ancestors"));checks["private_page:"+route]=true;}
const evidence={status:"PASS",utc:new Date().toISOString(),checks,browser_actor:"existing_owner_with_explicit_writer_grants",financial_mutations:false,grant_mutations:false,provider_generation_requests:0};
fs.writeFileSync(path.join(dir,"phase6-native-api.json"),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
