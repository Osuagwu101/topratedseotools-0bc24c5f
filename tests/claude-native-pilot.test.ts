import { strict as assert } from "node:assert";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import vm from "node:vm";
import {mock} from "bun:test";
import {encryptClaudeSession} from "../src/lib/claude-session.server";
import {CLAUDE_NATIVE_EXTENSION_ID,CLAUDE_NATIVE_APP_ORIGIN,CLAUDE_NATIVE_REDEEM_PATH} from "../src/lib/claude-native-config";
const ORIGIN=CLAUDE_NATIVE_APP_ORIGIN;
const secret="test-admin-session-value-not-real";
const manifest=JSON.parse(readFileSync("extensions/claude-native-pilot/manifest.json","utf8"));
const calculated=[...createHash("sha256").update(Buffer.from(manifest.key,"base64")).digest().subarray(0,16)].map(b=>String.fromCharCode(97+(b>>4),97+(b&15))).join("");
assert.equal(calculated,CLAUDE_NATIVE_EXTENSION_ID);
assert.deepEqual(manifest.permissions,["cookies"]);
assert.deepEqual(manifest.externally_connectable.matches,[ORIGIN+"/*"]);
process.env.CLAUDE_SESSION_ENCRYPTION_KEY="33".repeat(32);
const stamp="2026-11-12T14:44:09.981Z";
let isSuper=true,stored=true,vaultVersion=stamp,count=0,row:any=null;
let writerActive=true,writerEnabled=true,allowlisted=true,pilotActive=true,grantActive=true;
let pilotExpiry=new Date(Date.now()+86400000).toISOString();
const encrypted=encryptClaudeSession(JSON.stringify({version:2,cookies:[{name:"sessionKey",value:secret,domain:".claude.ai",path:"/"}]}));
const db={async rpc(){return {data:isSuper,error:null}},from(table:string){
 const filters:Record<string,any>={};let update:any=null;
 const q:any={select(){return q},eq(k:string,v:any){filters[k]=v;return q},gte(){return q},gt(){return q},
 update(v:any){update=v;return q},
 async insert(data:any){if(table==="claude_native_admin_handoffs")row={id:"handoff",...data};return {error:null}},
 async maybeSingle(){
  if(table==="profiles")return {data:{account_status:writerActive?"active":"suspended"},error:null};
  if(table==="tool_settings")return {data:{enabled:writerEnabled,one_click_auth_enabled:writerEnabled},error:null};
  if(table==="claude_native_pilot_writers")return {data:allowlisted?{enabled:pilotActive,expires_at:pilotExpiry}:null,error:null};
  if(table==="tool_authorized_sessions")return {data:{status:stored?"stored":"revoked",updated_at:vaultVersion,encrypted_payload:encrypted},error:null};
  if(!row || (filters.token_hash && row.token_hash!==filters.token_hash) || (filters.status && row.status!==filters.status))return {data:null,error:null};
  if(update)Object.assign(row,update);
  return {data:{...row},error:null};
 },
 then(resolve:any){resolve(table==="tool_access_grants"?{data:grantActive?[{expires_at:null}]:[],error:null}:{count,error:null})}};return q;
}};
mock.module("../src/integrations/supabase/client.server",()=>({supabaseAdmin:db}));
const {issueClaudeNativeAdminHandoff:issue,issueClaudeNativeWriterHandoff:issueWriter,handleClaudeNativeRedeem:redeem}=await import("../src/lib/claude-native.server");
function req(ticket:string,origin=`chrome-extension://${CLAUDE_NATIVE_EXTENSION_ID}`,method="POST") {
 return new Request(ORIGIN+CLAUDE_NATIVE_REDEEM_PATH,{method,headers:{Origin:origin,"Content-Type":"application/json"},body:method==="POST"?JSON.stringify({ticket}):undefined});
}
try {
 isSuper=false;await assert.rejects(()=>issue("writer"));isSuper=true;
 count=5;await assert.rejects(()=>issue("admin"));count=0;
 let handoff=await issue("admin");
 assert(!JSON.stringify(handoff).includes(secret));assert.equal(handoff.ticket.length,43);assert.notEqual(row.token_hash,handoff.ticket);
 assert.equal((await redeem(req(handoff.ticket,"https://attacker.test"))).status,403);
 assert.equal((await redeem(req("not-a-valid-ticket"))).status,400);
 const preflight=await redeem(req("",undefined,"OPTIONS"));assert.equal(preflight.status,204);assert.equal(preflight.headers.get("Access-Control-Allow-Credentials"),null);
 let response=await redeem(req(handoff.ticket));assert.equal(response.status,200);
 const payload=await response.json();assert.equal(payload.cookie.value,secret);assert.equal(payload.url,"https://claude.ai/new");assert.equal(response.headers.get("Cache-Control"),"no-store");
 assert.equal((await redeem(req(handoff.ticket))).status,403,"one-use ticket rejects replay");
 handoff=await issue("admin");row.expires_at=new Date(1).toISOString();assert.equal((await redeem(req(handoff.ticket))).status,403);
 handoff=await issue("admin");isSuper=false;assert.equal((await redeem(req(handoff.ticket))).status,403,"revoked Admin rejected");isSuper=true;
 handoff=await issue("admin");stored=false;assert.equal((await redeem(req(handoff.ticket))).status,403);stored=true;
 handoff=await issue("admin");vaultVersion="2026-11-12T15:00:00Z";assert.equal((await redeem(req(handoff.ticket))).status,409);vaultVersion=stamp;
 handoff=await issue("admin");const concurrent=await Promise.all([redeem(req(handoff.ticket)),redeem(req(handoff.ticket))]);assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,403]);

 isSuper=false;
 allowlisted=false;await assert.rejects(()=>issueWriter("writer"));allowlisted=true;
 writerActive=false;await assert.rejects(()=>issueWriter("writer"));writerActive=true;
 writerEnabled=false;await assert.rejects(()=>issueWriter("writer"));writerEnabled=true;
 pilotActive=false;await assert.rejects(()=>issueWriter("writer"));pilotActive=true;
 const futureExpiry=pilotExpiry;pilotExpiry=new Date(1).toISOString();await assert.rejects(()=>issueWriter("writer"));pilotExpiry=futureExpiry;
 grantActive=false;await assert.rejects(()=>issueWriter("writer"));grantActive=true;
 handoff=await issueWriter("writer");assert.equal(row.audience,"writer");response=await redeem(req(handoff.ticket));assert.equal(response.status,200);
 const writerPayload=await response.json();assert.equal(writerPayload.cookie.expirationDate,Math.floor(Date.parse(pilotExpiry)/1000));
 handoff=await issueWriter("writer");grantActive=false;assert.equal((await redeem(req(handoff.ticket))).status,403);grantActive=true;
 handoff=await issueWriter("writer");pilotActive=false;assert.equal((await redeem(req(handoff.ticket))).status,403);pilotActive=true;
 handoff=await issueWriter("writer");writerActive=false;assert.equal((await redeem(req(handoff.ticket))).status,403);writerActive=true;
 handoff=await issueWriter("writer");row.audience="unknown";assert.equal((await redeem(req(handoff.ticket))).status,403);
}finally{mock.restore()}

// Background worker tests use mocked Chrome APIs, not a real browser/session.
let listener:any,existing:any[]=[],saved:any[]=[],opened:any[]=[],calls=0;
const chrome={runtime:{onMessageExternal:{addListener(fn:any){listener=fn}}},cookies:{async getAll(){return existing},async set(c:any){saved.push(c);return c}},tabs:{async create(t:any){opened.push(t);return {id:1}}}};
new vm.Script(readFileSync("extensions/claude-native-pilot/background.js","utf8")).runInNewContext({chrome,URL,Date,fetch:async()=>{calls++;return {ok:true,async json(){return {ok:true,url:"https://claude.ai/new",cookie:{name:"sessionKey",value:secret,domain:".claude.ai",path:"/"}}}}},JSON});
const send=(message:any,sender:any={url:ORIGIN+"/admin/tools/claude",frameId:0})=>new Promise<any>(resolve=>listener(message,sender,resolve));
const ticket="a".repeat(43);
assert.equal((await send({type:"trst_claude_pilot_ping"})).ok,true);
assert.equal((await send({type:"trst_claude_native_pilot",ticket},{url:"https://attacker.test/admin/tools/claude"})).ok,false);
assert.equal(calls,0);
for(const path of ["/tools/claude","/dashboard","/orders"])assert.equal((await send({type:"trst_claude_pilot_ping"},{url:ORIGIN+path,frameId:0})).version,"0.2.0");
assert.equal((await send({type:"trst_claude_pilot_ping"},{url:ORIGIN+"/tools/claude",frameId:1})).ok,false);
assert.equal((await send({type:"trst_claude_pilot_ping"},{url:ORIGIN+"/tools/other-tool"})).ok,false);
existing=[{value:"different-session"}];assert.equal((await send({type:"trst_claude_native_pilot",ticket})).ok,false);assert.equal(saved.length,0);assert.equal(opened.length,0);
existing=[];let result=await send({type:"trst_claude_native_pilot",ticket});assert.equal(result.mode,"imported");assert.equal(saved.length,1);assert.equal(saved[0].httpOnly,true);assert.equal(opened[0].url,"https://claude.ai/new");assert(!JSON.stringify(result).includes(secret));
existing=[{value:secret}];result=await send({type:"trst_claude_native_pilot",ticket});assert.equal(result.mode,"existing");assert.equal(saved.length,1,"does not rewrite existing matching login");
console.log("Claude native pilot: Admin and allowlisted writer access, expiry/revocation, audience/version binding, expiry, one-use/concurrent redemption, sender checks and cookie isolation guards passed.");
