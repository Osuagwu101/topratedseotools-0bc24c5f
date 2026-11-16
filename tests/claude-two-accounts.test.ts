import {strict as assert} from "node:assert";
import {fetchClaudeProvider,BROWSER_RELAY_URL} from "../src/lib/claude-browser-fetch.server";
import {claudeSessionMatchesAccount} from "../src/lib/claude-account-policy";
const original=globalThis.fetch;
const saved={...process.env};
const calls:any[]=[];
globalThis.fetch=(async(input:any,init:any)=>{calls.push({input,init});return new Response("ok");}) as typeof fetch;
try{
 process.env.CLAUDE_BROWSER_RELAY_URL=BROWSER_RELAY_URL;
 process.env.CLAUDE_BROWSER_RELAY_KEY="one-private-test-key-12345678901234567890";
 process.env.CLAUDE_ACCOUNT_2_RELAY_URL="http://127.0.0.1:6112/request";
 process.env.CLAUDE_ACCOUNT_2_RELAY_KEY="two-private-test-key-12345678901234567890";
 await Promise.all([fetchClaudeProvider("https://claude.ai/new",{},"account_1"),fetchClaudeProvider("https://claude.ai/new",{},"account_2")]);
 assert.equal(calls[0].input,BROWSER_RELAY_URL);assert.equal(calls[1].input,process.env.CLAUDE_ACCOUNT_2_RELAY_URL);
 assert.notEqual(calls[0].init.headers.Authorization,calls[1].init.headers.Authorization);
 assert(claudeSessionMatchesAccount("account_1","account_1"));
 assert(!claudeSessionMatchesAccount("account_2","account_1"));
 assert(!claudeSessionMatchesAccount(undefined,undefined));
 calls.length=0;delete process.env.CLAUDE_ACCOUNT_2_RELAY_URL;
 await assert.rejects(()=>fetchClaudeProvider("https://claude.ai/new",{},"account_2"));assert.equal(calls.length,0);
 process.env.CLAUDE_ACCOUNT_2_RELAY_URL=BROWSER_RELAY_URL;
 await assert.rejects(()=>fetchClaudeProvider("https://claude.ai/new",{},"account_2"));assert.equal(calls.length,0);
 await assert.rejects(()=>fetchClaudeProvider("https://claude.ai/new",{},"bad" as any));
 console.log("Two-account concurrent routing, separate relay credentials, reassignment checks and no-fallback behavior passed.");
}finally{globalThis.fetch=original;process.env=saved;}
