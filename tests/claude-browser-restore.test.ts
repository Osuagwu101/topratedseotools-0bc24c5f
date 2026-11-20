import {strict as assert} from "node:assert";
import {fetchClaudeProvider,claudeBrowserLoggedOut,BROWSER_RELAY_URL} from "../src/lib/claude-browser-fetch.server";
const original=globalThis.fetch;const saved={...process.env};
let calls=0;
globalThis.fetch=(async()=>{calls++;return new Response("Claude browser is logged out.",{status:401,headers:{"X-TRST-Browser-Login":"required"}});}) as typeof fetch;
try{
 process.env.CLAUDE_BROWSER_RELAY_URL=BROWSER_RELAY_URL;
 process.env.CLAUDE_BROWSER_RELAY_KEY="restore-test-relay-key-12345678901234567890";
 assert(claudeBrowserLoggedOut(new Response("",{status:401})));
 assert(claudeBrowserLoggedOut(new Response("",{status:200,headers:{"X-TRST-Browser-Login":"required"}})));
 assert(!claudeBrowserLoggedOut(new Response("",{status:403})));
 assert(!claudeBrowserLoggedOut(new Response("",{status:503})));
 // The restore path's own verification never re-enters restore.
 const res=await fetchClaudeProvider("https://claude.ai/api/organizations",{},"account_1",{autoRestore:false});
 assert.equal(res.status,401);assert.equal(calls,1);
 console.log("Claude browser restore: logged-out detection and non-recursive verification passed.");
}finally{globalThis.fetch=original;process.env=saved;}
