import {strict as assert} from "node:assert";
import {mock} from "bun:test";
import {encryptClaudeSession,normaliseClaudeSession} from "../src/lib/claude-session.server";
const key="11".repeat(32),origin="https://claude.topratedseotools.com:4173";
process.env.CLAUDE_SESSION_ENCRYPTION_KEY=key;process.env.CLAUDE_PROXY_VERIFIED="true";
process.env.CLAUDE_BROWSER_RELAY_URL="http://127.0.0.1:6101/request";
process.env.CLAUDE_BROWSER_RELAY_KEY="test-only-relay-key-12345678901234567890";
process.env.CLAUDE_SHARED_BROWSER_TRANSPORT="true";
const encrypted=encryptClaudeSession(normaliseClaudeSession(JSON.stringify({cookies:[{name:"sessionKey",value:"test-only-session-1234",domain:".claude.ai",path:"/"}]})),key);
let access=true,calls=0,last:any;
mock.module("../src/integrations/supabase/client.server",()=>({supabaseAdmin:{from(table:string){
 const q:any={select(){return q;},eq(){return q;},update(){return q;},then(resolve:any){resolve({data:null,error:null});},
 async maybeSingle(){
  if(table==="claude_proxy_sessions")return {data:{id:"s",user_id:"writer",source_kind:"grant",source_id:"g",expires_at:new Date(Date.now()+100000).toISOString()}};
  if(table==="claude_conversation_owners")return {data:{user_id:"writer",organization_id:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}};
  if(table==="tool_access_grants")return {data:{status:access?"active":"revoked",expires_at:null}};
  if(table==="tool_settings")return {data:{enabled:true,one_click_auth_enabled:true}};
  if(table==="tool_authorized_sessions")return {data:{status:"stored",encrypted_payload:encrypted}};
  return {data:null};
 }};return q;
}}}));
const {handleClaudeProxyRequest:handle}=await import("../src/lib/claude-proxy.server");
const org="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",conversation="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const proto=new TextEncoder().encode(String.fromCharCode(10,36)+conversation);
const bytes=new Uint8Array([0,0,0,0,proto.length,...proto]);
const original=globalThis.fetch;
globalThis.fetch=(async(input:any,init:any)=>{calls++;last={input,init};return new Response(new ReadableStream({start(c){c.enqueue(bytes.slice(0,4));c.enqueue(bytes.slice(4));c.close();}}),{headers:{"Content-Type":"application/connect+proto","connect-content-encoding":"identity","Set-Cookie":"must-not-leak=secret"}});}) as typeof fetch;
const path="/claudeai-rpc/anthropic.bard.api.v1alpha.ConversationService/StreamTimeline";
function req(p=path,cookie=true,requestOrigin=origin){return new Request(origin+p,{method:"POST",headers:{"Content-Type":"application/connect+proto","x-organization-uuid":org,Origin:requestOrigin,...(cookie?{Cookie:"trst_claude_proxy="+"a".repeat(43)}:{})},body:bytes});}
try{
 assert.equal((await handle(req(path,false))).status,401);
 assert.equal((await handle(req(path,true,"https://attacker.test"))).status,403);
 assert.equal((await handle(req("/claudeai-rpc/anthropic.bard.api.v1alpha.AccountService/GetApiKeys"))).status,403);
 assert.equal(calls,0);
 const response=await handle(req());
 assert.equal(response.status,200);assert.equal(response.headers.get("content-type"),"application/connect+proto");
 assert.equal(response.headers.get("connect-content-encoding"),"identity");assert.equal(response.headers.get("set-cookie"),null);
 assert.deepEqual(new Uint8Array(await response.arrayBuffer()),bytes);
 assert.equal(last.input,"http://127.0.0.1:6101/request");
 assert.equal(JSON.parse(last.init.body).bodyBase64,Buffer.from(bytes).toString("base64"));
 access=false;assert.equal((await handle(req())).status,401);assert.equal(calls,1);access=true;
 process.env.CLAUDE_SHARED_BROWSER_TRANSPORT="false";const isolated=await handle(req());assert.equal(isolated.status,200);await isolated.body?.cancel();
 const invalid=new Request(origin+path,{method:"POST",headers:{"Content-Type":"application/connect+proto",Origin:origin,Cookie:"trst_claude_proxy="+"a".repeat(43)},body:new Uint8Array([0,0,0,0,3,255,0,128])});assert.equal((await handle(invalid)).status,403);
 const field=(n:number,text:string)=>{const b=new TextEncoder().encode(text);return [n*8+2,b.length,...b];};
 const header=field(2,conversation),action=[...field(1,"cccccccc-cccc-4ccc-8ccc-cccccccccccc"),...field(2,"dddddddd-dddd-4ddd-8ddd-dddddddddddd"),...field(3,"hello")];
 const write=new Request(origin+"/claudeai-rpc/anthropic.bard.api.v1alpha.ConversationService/PerformAction",{method:"POST",headers:{"Content-Type":"application/proto",Origin:origin,"x-organization-uuid":org,Cookie:"trst_claude_proxy="+"a".repeat(43)},body:new Uint8Array([10,header.length,...header,18,action.length,...action])});
 const beforeWrite=calls;assert.equal((await handle(write)).status,403);assert.equal(calls,beforeWrite);
 console.log("Native RPC handler: authentication, origin checks, route boundaries, binary integrity, streamed frames, response headers and revocation passed.");
}finally{globalThis.fetch=original;mock.restore();}
