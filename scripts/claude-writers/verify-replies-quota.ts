import {readFile} from "node:fs/promises";
import {randomUUID,createHash} from "node:crypto";
import {strict as assert} from "node:assert";
import {supabaseAdmin as db0} from "../../src/integrations/supabase/client.server";
import {fetchClaudeProvider} from "../../src/lib/claude-browser-fetch.server";
import {getClaudeUsage,reserveClaudeMessage,releaseClaudeMessage,claudeUsageDay,claudeResetAt} from "../../src/lib/claude-controls.server";
const db=db0 as any;
const log=await readFile("/home/ubuntu/claude-writers-acceptance-20261114.log","utf8");
const accepted=log.split("\n").flatMap(l=>{try{return [JSON.parse(l)]}catch{return []}}).find(l=>l.backend_acceptance==="passed");
assert(accepted);
const orgs=await fetchClaudeProvider("https://claude.ai/api/organizations").then(r=>r.json()) as any[];
const org=orgs[0].uuid;
for(let i=0;i<2;i++){
 const r=await fetchClaudeProvider("https://claude.ai/api/organizations/"+org+"/chat_conversations/"+accepted.conversations[i]+"?tree=True");
 const d=await r.json() as any;
 const messages=d.chat_messages??[],marker="WRITER_"+(i+1)+"_PRIVATE_OK",other="WRITER_"+(2-i)+"_PRIVATE_OK";
 const ownReply=messages.some((m:any)=>m.sender==="assistant"&&JSON.stringify(m).includes(marker));
 console.log(JSON.stringify({writer:i+1,status:r.status,messages:messages.length,assistant_reply_verified:ownReply,other_writer_marker_present:JSON.stringify(d).includes(other),settings_keys:Object.keys(d.settings??{})}));
 assert(ownReply);assert(!JSON.stringify(d).includes(other));
}
const g=await db.from("tool_access_grants").select("user_id,expires_at").eq("tool_slug","claude").eq("status","active");
const user=g.data.find((g:any)=>!g.expires_at||Date.parse(g.expires_at)>Date.now()).user_id;
const before=await getClaudeUsage(user),keys=Array.from({length:10},()=>createHash("sha256").update("quota-test-"+randomUUID()).digest("hex"));
try{
 let r=await db.from("claude_user_controls").update({daily_message_limit:before.used+2}).eq("user_id",user);if(r.error)throw Error(r.error.message);
 const outcomes=await Promise.all(keys.map(key=>reserveClaudeMessage(user,key)));
 assert.equal(outcomes.filter(r=>r.allowed).length,2);
 assert.equal((await getClaudeUsage(user)).used,before.used+2);
 const acceptedKey=keys[outcomes.findIndex(r=>r.allowed)];
 assert.equal((await reserveClaudeMessage(user,acceptedKey)).code,"duplicate");
 await db.from("claude_user_controls").update({daily_message_limit:before.used+5}).eq("user_id",user);
 assert.equal((await getClaudeUsage(user)).remaining,3);
 await db.from("claude_user_controls").update({daily_message_limit:0}).eq("user_id",user);
 assert.equal((await reserveClaudeMessage(user,keys.find((k,i)=>!outcomes[i].allowed)!)).code,"daily_limit");
 console.log(JSON.stringify({quota_race:"10 concurrent requests, exactly 2 admitted",duplicate:"blocked",admin_increase:"immediate",admin_zero_limit:"blocked"}));
}finally{
 await Promise.all(keys.map(key=>releaseClaudeMessage(user,key)));
 await Promise.all(keys.map(key=>releaseClaudeMessage(user,key)));
 await db.from("claude_user_controls").update({daily_message_limit:before.limit}).eq("user_id",user);
 const after=await getClaudeUsage(user);assert.equal(after.used,before.used);assert.equal(after.limit,before.limit);
 console.log(JSON.stringify({quota_test_cleanup:"restored original usage and limit",limit:after.limit}));
}
assert.equal(claudeUsageDay(new Date("2026-11-14T22:59:59Z")),"2026-11-14");
assert.equal(claudeUsageDay(new Date("2026-11-14T23:00:00Z")),"2026-11-15");
assert.equal(claudeResetAt(new Date("2026-11-14T22:59:59Z")),"2026-11-14T23:00:00.000Z");
assert.equal(claudeResetAt(new Date("2026-11-14T23:00:00Z")),"2026-11-15T23:00:00.000Z");
console.log(JSON.stringify({nigeria_midnight_boundary:"passed"}));
