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
let owns=true;
let assigned="account_1",sessionAccount="account_1";
mock.module("../src/integrations/supabase/client.server",()=>({supabaseAdmin:{from(table:string){
 const filters:Record<string,string>={};
 const q:any={select(){return q;},eq(k:string,v:string){filters[k]=v;return q;},update(){return q;},then(resolve:any){resolve({data:null,error:null});},
 async maybeSingle(){
  if(table==="claude_proxy_sessions")return {data:{id:"s",provider_account_key:sessionAccount,user_id:"writer",source_kind:"grant",source_id:"g",expires_at:new Date(Date.now()+100000).toISOString()}};
  if(table==="claude_conversation_owners" && (filters.organization_id!=="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" || filters.conversation_id!=="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" || filters.provider_account_key!=="account_1"))return {data:null};
  if(table==="claude_conversation_owners")return {data:{user_id:owns?"writer":"other",organization_id:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}};
  if(table==="tool_access_grants")return {data:{status:access?"active":"revoked",expires_at:null}};
  if(table==="claude_user_controls")return {data:{provider_account_key:assigned}};
 if(table==="claude_provider_accounts")return {data:{status:"connected"}};
 if(table==="tool_settings")return {data:{enabled:true,one_click_auth_enabled:true}};
  if(table==="tool_authorized_sessions")return {data:{status:"stored",encrypted_payload:encrypted}};
  return {data:null};
 }};return q;
}}}));
const {handleClaudeProxyRequest:handle}=await import("../src/lib/claude-proxy.server");
const org="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",conversation="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const path=`/api/organizations/${org}/chat_conversations/${conversation}/tool_approval`;
const original=globalThis.fetch;
globalThis.fetch=(async(input:any,init:any)=>{calls++;last={input,init};return new Response(null,{status:204});}) as typeof fetch;
const approval={tool_use_id:"toolu_test123",approval_key:"opaque-test-key",is_approved:true,approval_option:"once"};
function req(payload:any=approval,options:any={}){return new Request(origin+(options.path??path),{method:options.method??"POST",headers:{"Content-Type":"application/json",Origin:options.origin??origin,...(options.cookie===false?{}:{Cookie:"trst_claude_proxy="+"a".repeat(43)})},body:options.raw??JSON.stringify(payload)});}
try {
 assert.equal((await handle(req(approval,{cookie:false}))).status,401);
 assert.equal((await handle(req(approval,{origin:"https://attacker.test"}))).status,403);
 owns=false;assert.equal((await handle(req())).status,404);owns=true;
 assert.equal((await handle(req(approval,{path:path.replace(org,"cccccccc-cccc-4ccc-8ccc-cccccccccccc")}))).status,404);
 assert.equal((await handle(req(approval,{path:path.replace(conversation,"dddddddd-dddd-4ddd-8ddd-dddddddddddd")}))).status,404);
 assert.equal(calls,0);
 for(const payload of [approval,{...approval,approval_option:"perChat",params:{query:"nutrition"}},{tool_use_id:"toolu_test123",approval_key:null,is_approved:false}]){
  const res=await handle(req(payload));assert.equal(res.status,204);
  assert.equal(last.input,"http://127.0.0.1:6101/request");
  const envelope=JSON.parse(last.init.body);
  assert.equal(envelope.path,path);
  assert.deepEqual(JSON.parse(envelope.body),payload);
 }
 const before=calls;
 const always=await handle(req({...approval,approval_option:"always"}));assert.equal(always.status,403);assert.match(await always.text(),/Allow once/);
 for(const payload of [null,[],{...approval,is_approved:"true"},{...approval,tool_use_id:"../other"},{...approval,approval_option:"unknown"},{...approval,admin:true},{...approval,params:[]}])
  assert.equal((await handle(req(payload))).status,400);
 assert.equal((await handle(req(approval,{raw:"{"}))).status,400);
 assert.equal((await handle(req({...approval,params:{text:"x".repeat(65536)}}))).status,413);
 assert.equal((await handle(req(approval,{method:"PUT"}))).status,403);
 assert.equal((await handle(req(approval,{path:path+"/extra"}))).status,403);
 access=false;assert.equal((await handle(req())).status,401);access=true;
 assigned="account_2";assert.equal((await handle(req())).status,503);assigned="account_1";
 assert.equal(calls,before);
 console.log("Tool approvals: owned-chat allow once, per-chat and deny forwarded; auth, origin, ownership, account assignment, validation and global grants protected.");
}finally{globalThis.fetch=original;mock.restore();}
