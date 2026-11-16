import {strict as assert} from "node:assert";
import {mock} from "bun:test";
import {encryptChatGptSession,decryptChatGptSession,normaliseChatGptSession} from "../src/lib/chatgpt-session.server";
process.env.CHATGPT_SESSION_ENCRYPTION_KEY="11".repeat(32);
process.env.CHATGPT_PROXY_PUBLIC_ORIGIN="https://chatgpt.topratedseotools.com";
const origin=process.env.CHATGPT_PROXY_PUBLIC_ORIGIN;
const sessions=["writer-one","writer-two"].map((user_id,i)=>({id:"session"+i,user_id,source_kind:"grant",source_id:"grant"+i,status:"active",token_hash:"",device_fingerprint:String(i+1).repeat(32),expires_at:new Date(Date.now()+100000).toISOString(),provider_account_key:"account_"+(i+1)}));
const controls=sessions.map(s=>({user_id:s.user_id,status:"active",device_limit:2,provider_account_key:s.provider_account_key}));
const accounts=[1,2].map(n=>({account_key:"account_"+n,status:"stored",verified_at:new Date().toISOString(),encrypted_payload:encryptChatGptSession(normaliseChatGptSession(JSON.stringify({cookies:[{name:"__Secure-next-auth.session-token",value:"test-session-account-"+n,domain:".chatgpt.com",path:"/"}]})))}));
const owners:any[]=[];
let dbError=false;
const tables:any={chatgpt_proxy_sessions:sessions,chatgpt_user_controls:controls,chatgpt_provider_accounts:accounts,chatgpt_conversation_owners:owners,chatgpt_devices:sessions.map(s=>({id:"dev"+s.id,user_id:s.user_id,device_fingerprint:s.device_fingerprint})),tool_settings:[{tool_slug:"chatgpt",enabled:true,one_click_auth_enabled:true}],tool_authorized_sessions:[{tool_slug:"chatgpt",status:"stored",encrypted_payload:accounts[0].encrypted_payload}],tool_access_grants:sessions.map(s=>({id:s.source_id,user_id:s.user_id,tool_slug:"chatgpt",status:"active",expires_at:null}))};
mock.module("../src/integrations/supabase/client.server",()=>({supabaseAdmin:{from(table:string){
 const filters:any={};let patch:any,insert:any;
 const result=()=>{if(dbError&&table==="chatgpt_conversation_owners")return {data:null,error:{message:"database unavailable"}};let rows=(tables[table]??[]).filter((r:any)=>Object.entries(filters).every(([k,v])=>r[k]===v));
 if(patch)rows.forEach((r:any)=>Object.assign(r,patch));
 if(insert){const a=insert;if(!owners.some(o=>o.provider_account_key===a.provider_account_key&&o.conversation_id===a.conversation_id))owners.push({...a});rows=[a];}
 return {data:rows,error:null};};
 const q:any={select(){return q},eq(k:string,v:any){filters[k]=v;return q},order(){return q},limit(){return q},update(p:any){patch=p;return q},upsert(p:any){insert=p;return q},async maybeSingle(){const r=result();return {...r,data:r.data?.[0]??null}},then(fn:any){return Promise.resolve(result()).then(fn)}};return q;
}}}));
const {handleChatGPTProxyRequest:handle,hashChatGPTProxyToken,persistRotatedChatGPTCookies}=await import("../src/lib/chatgpt-proxy.server");
const {ownerOfConversation,claimConversation}=await import("../src/lib/chatgpt-isolation.server");
sessions.forEach((s,i)=>s.token_hash=hashChatGPTProxyToken(String(i+1).repeat(43)));
const calls:any[]=[];const realFetch=globalThis.fetch;
globalThis.fetch=(async(input:any,init:any)=>{
 const h=new Headers(init?.headers),cookie=h.get("cookie")??"",account=cookie.includes("test-session-account-2")?2:1;
 calls.push({url:String(input),account,auth:h.get("authorization")});
 if(String(input).endsWith("/api/auth/session"))return Response.json({accessToken:"server-token-account-"+account});
 if(String(input).includes("/backend-api/f/conversation"))return new Response('data: {"conversation_id":"'+(account===1?"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")+'","v":"hello"}\n\ndata: [DONE]\n\n',{headers:{"Content-Type":"text/event-stream"}});
 return new Response("<html><head></head><body>ChatGPT</body></html>",{headers:{"Content-Type":"text/html"}});
}) as typeof fetch;
function req(i:number,path="/",body?:object){return new Request(origin+path,{method:body?"POST":"GET",headers:{Cookie:"trst_cg_proxy="+String(i+1).repeat(43)+"; trst_cg_device="+String(i+1).repeat(32),Origin:origin,Accept:"text/html","Content-Type":"application/json",Authorization:"Bearer forged-client-token"},body:body?JSON.stringify(body):undefined});}
try{
 const pages=await Promise.all([handle(req(0)),handle(req(1))]);assert.deepEqual(pages.map(p=>p.status),[200,200]);
 const html=await Promise.all(pages.map(p=>p.text()));assert(html.every(t=>t.includes("trstChatGptAccount")));assert.notEqual(html[0],html[1]);
 assert(calls.some(c=>c.account===1&&c.auth==="Bearer server-token-account-1"));assert(calls.some(c=>c.account===2&&c.auth==="Bearer server-token-account-2"));assert(!calls.some(c=>c.auth==="Bearer forged-client-token"));
 const streamed=await Promise.all([handle(req(0,"/backend-api/f/conversation",{conversation_id:null})),handle(req(1,"/backend-api/f/conversation",{conversation_id:null}))]);
 await Promise.all(streamed.map(r=>r.text()));assert.equal(owners.length,2);assert.equal(owners[0].provider_account_key,"account_1");assert.equal(owners[1].provider_account_key,"account_2");
 const foreign=await handle(req(0,"/backend-api/conversation/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"));assert.equal(foreign.status,302);
 const before=calls.length;controls[0].provider_account_key="account_2";assert.equal((await handle(req(0))).status,401);assert.equal(calls.length,before);controls[0].provider_account_key="account_1";sessions[0].status="active";
 accounts[1].status="revoked";assert.equal((await handle(req(1))).status,503);assert.equal(calls.length,before);accounts[1].status="stored";
 dbError=true;await assert.rejects(()=>ownerOfConversation("x","account_1"));await assert.rejects(()=>claimConversation("x","writer-one","account_1"));dbError=false;
 const firstPayload=accounts[0].encrypted_payload, secondPayload=accounts[1].encrypted_payload;
 await persistRotatedChatGPTCookies(new Response("ok",{headers:{"Set-Cookie":"__Secure-next-auth.session-token=second-account-rotated; Path=/; Secure; HttpOnly"}}),"account_2",secondPayload);
 assert.equal(accounts[0].encrypted_payload,firstPayload);assert.notEqual(accounts[1].encrypted_payload,secondPayload);
 assert(decryptChatGptSession(accounts[1].encrypted_payload).includes("second-account-rotated"));
 const currentSecond=accounts[1].encrypted_payload;
 await persistRotatedChatGPTCookies(new Response("ok",{headers:{"Set-Cookie":"__Secure-next-auth.session-token=stale-rotation; Path=/; Secure; HttpOnly"}}),"account_2",secondPayload);
 assert.equal(accounts[1].encrypted_payload,currentSecond);
 console.log("Two ChatGPT accounts: parallel cookies and server tokens, account-scoped streams/history, browser reset, immediate reassignment/revocation, and database failure checks passed.");
}finally{globalThis.fetch=realFetch;mock.restore();}
