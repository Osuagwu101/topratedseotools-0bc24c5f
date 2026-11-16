import {strict as assert} from "node:assert";
import {mock} from "bun:test";
import {encryptGrammarlySession,decryptGrammarlySession,normaliseGrammarlySession} from "../src/lib/grammarly-session.server";
process.env.GRAMMARLY_SESSION_ENCRYPTION_KEY="22".repeat(32);
process.env.GRAMMARLY_PROXY_PUBLIC_ORIGIN="https://grammarly.topratedseotools.com";
const origin=process.env.GRAMMARLY_PROXY_PUBLIC_ORIGIN;
const sessions=[1,2].map(i=>({id:"session"+i,user_id:"writer"+i,source_kind:"grant",source_id:"grant"+i,status:"active",token_hash:"",expires_at:new Date(Date.now()+100000).toISOString(),provider_account_key:"account_"+i}));
const controls=sessions.map(s=>({user_id:s.user_id,provider_account_key:s.provider_account_key}));
const accounts=[1,2].map(n=>({account_key:"account_"+n,status:"stored",verified_at:new Date().toISOString(),encrypted_payload:encryptGrammarlySession(normaliseGrammarlySession(JSON.stringify({cookies:[{name:"grauth",value:"account-session-"+n,domain:".grammarly.com",path:"/"},{name:"csrf-token",value:"csrf-"+n,domain:".grammarly.com",path:"/"}]})))}));
const owners:any[]=[];let dbError=false,anonymous=false;
const tables:any={grammarly_proxy_sessions:sessions,grammarly_user_controls:controls,grammarly_provider_accounts:accounts,grammarly_document_owners:owners,tool_settings:[{tool_slug:"grammarly",enabled:true,one_click_auth_enabled:true}],tool_authorized_sessions:[{tool_slug:"grammarly",status:"stored",encrypted_payload:accounts[0].encrypted_payload}],tool_access_grants:sessions.map(s=>({id:s.source_id,user_id:s.user_id,status:"active",expires_at:null}))};
mock.module("../src/integrations/supabase/client.server",()=>({supabaseAdmin:{from(table:string){
 const filters:any={};let patch:any,insert:any;
 const result=()=>{
 if(dbError&&table==="grammarly_document_owners")return {data:null,error:{message:"unavailable"}};
 let rows=(tables[table]??[]).filter((r:any)=>Object.entries(filters).every(([k,v])=>r[k]===v));
 if(patch)rows.forEach((r:any)=>Object.assign(r,patch));
 if(insert){if(!owners.some(o=>o.document_id===insert.document_id))owners.push({...insert});rows=[insert]}
 return {data:rows,error:null};};
 const q:any={select(){return q},eq(k:string,v:any){filters[k]=v;return q},limit(){return q},order(){return q},update(v:any){patch=v;return q},upsert(v:any){insert=v;return q},async maybeSingle(){const r=result();return {...r,data:r.data?.[0]??null}},then(fn:any){return Promise.resolve(result()).then(fn)}};return q;
}}}));
const {handleGrammarlyProxyRequest:handle,hashGrammarlyProxyToken,grammarlyDocumentOwner,claimDocument,persistRotatedCookies,verifyGrammarlySession,verifyGrammarlyAccountSession}=await import("../src/lib/grammarly-proxy.server");
sessions.forEach((s,i)=>s.token_hash=hashGrammarlyProxyToken(String(i+1).repeat(43)));
const original=globalThis.fetch,calls:any[]=[];
globalThis.fetch=(async(input:any,init:any)=>{
 const h=new Headers(init?.headers),account=(h.get("cookie")??"").includes("account-session-2")?2:1;
 calls.push({url:String(input),account,auth:h.get("authorization"),csrf:h.get("x-csrf-token")});
 if(String(input).includes("auth.grammarly.com/v3/user"))return Response.json({id:anonymous?0:account,anonymous},{headers:{"Set-Cookie":"csrf-token=verification-csrf; Path=/; Secure"}});
 if(String(input).includes("dox.grammarly.com")){
  if(init.method==="POST")return Response.json({id:account===1?1001:2002,user_id:account,title:"Private document"});
  return Response.json([{id:1001,user_id:1,title:"One"},{id:2002,user_id:2,title:"Two"}]);
 }
 return new Response("<html><head></head><body>Editor</body></html>",{headers:{"Content-Type":"text/html"}});
}) as typeof fetch;
function req(i:number,path="/",body?:object){return new Request(origin+path,{method:body?"POST":"GET",headers:{Cookie:"trst_gr_proxy="+String(i+1).repeat(43)+"; trst_gr_storage_marker="+hashGrammarlyProxyToken("writer"+(i+1)+":account_"+(i+1)).slice(0,24),Origin:origin,Accept:path==="/"?"text/html":"application/json",Authorization:"Bearer foreign-token","Content-Type":"application/json","x-csrf-token":"wrong-csrf"},body:body?JSON.stringify(body):undefined});}
try{
 assert(await verifyGrammarlySession(accounts[0].encrypted_payload));anonymous=true;assert.equal(await verifyGrammarlySession(accounts[1].encrypted_payload),false);anonymous=false;
 const reset=await handle(req(0,"/__trst/reset"));const resetHtml=await reset.text();assert.equal(reset.status,200);assert(resetHtml.includes("indexedDB.deleteDatabase"));assert(resetHtml.includes("serviceWorker.getRegistrations"));
 const html=await Promise.all([handle(req(0)),handle(req(1))].map(async r=>{const response=await r;assert.equal(response.status,200);return response.text()}));
 assert(html.every(s=>s.includes("trstGrammarlyAccount")));assert.notEqual(html[0],html[1]);assert(!calls.some(c=>c.auth));
 const docs=await Promise.all([handle(req(0,"/__host/dox.grammarly.com/documents",{title:"one"})),handle(req(1,"/__host/dox.grammarly.com/documents",{title:"two"}))]);
 assert.deepEqual(docs.map(r=>r.status),[200,200]);assert.equal(owners.length,2);assert(calls.some(c=>c.account===1&&c.csrf==="csrf-1"));assert(calls.some(c=>c.account===2&&c.csrf==="csrf-2"));
 for(let i=0;i<2;i++){
 const listed=await handle(req(i,"/__host/dox.grammarly.com/documents"));const payload=await listed.json();assert.equal(payload.length,1);assert.equal(payload[0].id,i===0?1001:2002);
 }
 assert.equal((await handle(req(0,"/__host/dox.grammarly.com/documents/2002"))).status,404);
 const before=calls.length;controls[0].provider_account_key="account_2";assert.equal((await handle(req(0))).status,401);assert.equal(calls.length,before);controls[0].provider_account_key="account_1";
 accounts[1].status="revoked";assert.equal((await handle(req(1))).status,503);assert.equal(calls.length,before);accounts[1].status="stored";
 dbError=true;assert.equal((await handle(req(0,"/__host/dox.grammarly.com/documents"))).status,503);await assert.rejects(()=>grammarlyDocumentOwner("1001","account_1"));await assert.rejects(()=>claimDocument("1234","writer1","account_1"));dbError=false;
 const a1=accounts[0].encrypted_payload;
 const checked=await verifyGrammarlyAccountSession(accounts[1].encrypted_payload,"account_2");assert(checked.ok);assert.equal(checked.encrypted,accounts[1].encrypted_payload);assert(decryptGrammarlySession(checked.encrypted).includes("verification-csrf"));assert.equal(accounts[0].encrypted_payload,a1);
 const a2=accounts[1].encrypted_payload;
 await persistRotatedCookies(["grauth=new-account-two; Path=/; Secure"],"account_2",a2);assert.equal(accounts[0].encrypted_payload,a1);assert(decryptGrammarlySession(accounts[1].encrypted_payload).includes("new-account-two"));
 const fresh=accounts[1].encrypted_payload;await persistRotatedCookies(["grauth=stale-value; Path=/; Secure"],"account_2",a2);assert.equal(accounts[1].encrypted_payload,fresh);
 console.log("Grammarly two-account HTTP: isolated cookies/CSRF, stripped bearer, documents, assignment/revocation, database failure, browser reset and scoped stale-safe rotation passed.");
}finally{globalThis.fetch=original;mock.restore();}
