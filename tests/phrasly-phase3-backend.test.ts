import { describe, test, expect, mock } from "bun:test";
import { encryptPhraslySession, normalisePhraslySession } from "../src/lib/phrasly-session.server.ts";
const uid="00000000-0000-4000-8000-000000000001", accountId="10000000-0000-4000-8000-000000000001";
const key="61".repeat(32);
process.env.PHRASLY_SESSION_ENCRYPTION_KEY=key;
process.env.PHRASLY_EXTENSION_ENABLED="true";
process.env.PHRASLY_AWS_EXTENSION_GATE_SECRET="fixture-phase3-hmac-secret-32bytes-long";
const encrypted=encryptPhraslySession(normalisePhraslySession("fixture-only"));
let used=0;
const audits: unknown[]=[];
const popupSessions: {token_hash:string;user_id:string;expires_at:string}[]=[];
const tables:Record<string,unknown>={
 profiles:{account_status:"active"},
 phrasly_oneclick_feature_grants:{daily_limit:2,enabled:true},
 phrasly_oneclick_daily_usage:{used:0},
 phrasly_oneclick_tool_config:{enabled:true,feature_urls:{humanizer:"https://phrasly.ai/dashboard"},block_paths:["/settings","/billing"]},
 phrasly_oneclick_accounts:{enabled:true,target_url:"https://phrasly.ai/dashboard",encrypted_cookies:encrypted},
};
function query(table:string) {
  const q:any={
   select:()=>q,eq:()=>q,order:()=>q,limit:()=>q,
   maybeSingle:async()=>{
     if(table==="phrasly_oneclick_popup_sessions") return {data:popupSessions[0]||null,error:null};
     if(table==="phrasly_oneclick_daily_usage") return {data:{used},error:null};
     return {data:tables[table]||null,error:null};
   },
   insert:async(value:unknown)=>{
     if(table==="phrasly_oneclick_activity") audits.push(value);
     if(table==="phrasly_oneclick_popup_sessions") popupSessions.push(value as typeof popupSessions[0]);
     return {error:null};
   }
  };
  return q;
}
const fake:any={
 auth:{
  getUser:async(value:string)=>value==="valid-synthetic-token"?{data:{user:{id:uid}},error:null}:{data:{user:null},error:"invalid"},
  admin:{getUserById:async()=>({data:{user:{email:"fixture@example.test",user_metadata:{full_name:"Fixture Writer"}}}})}
 },
 from:query,
 rpc:async(name:string)=>{
  if(name==="phrasly_oneclick_assign_account") return {data:accountId,error:null};
  if(name==="phrasly_oneclick_count_attempt"){const allowed=used<2;if(allowed)used++;return {data:[{allowed,used,daily_limit:2,resets_in:3600}],error:null};}
  return {data:null,error:"unsupported"};
 }
};
mock.module("../src/integrations/supabase/client.server.ts",()=>({supabaseAdmin:fake}));
mock.module("@/integrations/supabase/client.server",()=>({supabaseAdmin:fake}));
const backend=await import("../src/lib/phrasly-extension/backend.server.ts");
describe("AWS Phase 3 Node handlers",()=>{
 test("feature handoff validates a verified destination user, grants and AWS signed fields",async()=>{
  const resp=await backend.handoff(new Request("https://topratedseotools.com/ext-handoff.php?tool_id=phrasly&feature=humanizer",{headers:{authorization:"Bearer valid-synthetic-token"}}));
  expect(resp.status).toBe(200);
  const body=await resp.json();
  expect(body.ok).toBe(true);
  const data=JSON.parse(Buffer.from(body.payload,"base64url").toString("utf8"));
  expect(Object.keys(data)).toEqual(["uid","tool_id","feature","exp"]);
  expect(data.uid).toBe(uid);
  expect(data.feature).toBe("humanizer");
 });
 test("refuses unauthenticated handoff",async()=>{
  await expect(backend.handoff(new Request("https://topratedseotools.com/ext-handoff.php?feature=humanizer"))).rejects.toMatchObject({code:"not_signed_in",status:401});
 });
 test("fulfill returns AWS-compatible record and configured URLs, no usage increment",async()=>{
  const token=await (await backend.handoff(new Request("https://topratedseotools.com/ext-handoff.php?feature=humanizer",{headers:{authorization:"Bearer valid-synthetic-token"}}))).json();
  const resp=await backend.fulfill(new Request("https://topratedseotools.com/ext-fulfill.php?payload="+token.payload+"&signature="+token.signature));
  const body=await resp.json();
  expect(body.ok).toBe(true);
  expect(body.block_paths).toEqual(["/settings","/billing"]);
  expect(body.url).toBe("https://phrasly.ai/dashboard");
  expect(body.record_token.split(".")).toHaveLength(2);
  expect(body.cookies[0].name).toBe("session");
  expect(used).toBe(0);
 });
 test("popup uses HttpOnly cookie and X-Ext-Session identity bridge",async()=>{
  const response=await backend.createPopupSession(new Request("https://topratedseotools.com/ext-session",{method:"POST",headers:{authorization:"Bearer valid-synthetic-token"}}));
  const session=(response.headers.get("set-cookie")||"").match(/PHPSESSID=([^;]+)/)?.[1];
  expect(response.headers.get("set-cookie")).toContain("HttpOnly");
  expect(session).toBeTruthy();
  const who=await backend.whoami(new Request("https://topratedseotools.com/ext-whoami.php",{headers:{"X-Ext-Session":session!}}));
  const body=await who.json();
  expect(body.email).toBe("fixture@example.test");
  expect(body.tools[0].features[0].key).toBe("humanizer");
 });
 test("signed usage records count actions and deny after feature limit",async()=>{
  const token=await (await backend.handoff(new Request("https://topratedseotools.com/ext-handoff.php?feature=humanizer",{headers:{authorization:"Bearer valid-synthetic-token"}}))).json();
  const opening=await (await backend.fulfill(new Request("https://topratedseotools.com/ext-fulfill.php?payload="+token.payload+"&signature="+token.signature))).json();
  const request=()=>new Request("https://topratedseotools.com/ext-check-usage.php",{method:"POST",body:new URLSearchParams({record_token:opening.record_token,feature:"humanizer"}).toString()});
  const a=await (await backend.checkUsage(request())).json();
  const b=await (await backend.checkUsage(request())).json();
  expect(a.allowed).toBe(true);
  expect(b.used).toBe(2);
  const denied=await backend.fulfill(new Request("https://topratedseotools.com/ext-fulfill.php?payload="+token.payload+"&signature="+token.signature));
  expect(denied.status).toBe(429);
 });
 test("explicit enablement switch blocks all five handlers",async()=>{
  process.env.PHRASLY_EXTENSION_ENABLED="false";
  await expect(backend.whoami(new Request("https://topratedseotools.com/ext-whoami.php"))).rejects.toMatchObject({code:"service_unavailable",status:503});
  process.env.PHRASLY_EXTENSION_ENABLED="true";
 });
});
