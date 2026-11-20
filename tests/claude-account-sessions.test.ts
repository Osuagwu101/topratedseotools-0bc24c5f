import {strict as assert} from "node:assert";
import {pushClaudeBrowserSession,claudeAccountUsesBrowser,BROWSER_RELAY_URL} from "../src/lib/claude-browser-fetch.server";
import {normaliseClaudeSession} from "../src/lib/claude-session.server";
const original=globalThis.fetch;
const saved={...process.env};
const calls:any[]=[];
globalThis.fetch=(async(input:any,init:any)=>{calls.push({input,init});return new Response('{"ok":true}');}) as typeof fetch;
try{
 // Browser cookie-export arrays are accepted and expirationDate is kept.
 const future=Math.floor(Date.now()/1000)+86400;
 const exported=JSON.parse(normaliseClaudeSession(JSON.stringify([
  {name:"sessionKey",value:"sk-ant-test",domain:".claude.ai",path:"/",expirationDate:future,sameSite:"lax"},
  {name:"_ga",value:"drop-me",domain:".claude.ai",path:"/"},
 ])));
 assert.equal(exported.cookies.length,1);assert.equal(exported.cookies[0].expires,future);
 assert.throws(()=>normaliseClaudeSession('[{"name":"sessionKey","value":"x","domain":".evil.test"}]'));
 // A sessionKey pasted without any expiry gets a lasting one, so a server
 // browser restart (e.g. after running out of memory) cannot silently drop it.
 const bare=JSON.parse(normaliseClaudeSession('[{"name":"sessionKey","value":"sk-ant-bare","domain":".claude.ai","path":"/"}]'));
 const days=(bare.cookies[0].expires-Date.now()/1000)/86400;
 assert(days>29&&days<=30,"sessionKey without expiry should persist about 30 days");
 const sessionOnly=JSON.parse(normaliseClaudeSession('[{"name":"sessionKey","value":"sk","domain":".claude.ai","expirationDate":-1}]'));
 assert(sessionOnly.cookies[0].expires>Date.now()/1000+29*86400);

 process.env.CLAUDE_BROWSER_RELAY_URL=BROWSER_RELAY_URL;
 process.env.CLAUDE_BROWSER_RELAY_KEY="one-private-test-key-12345678901234567890";
 process.env.CLAUDE_ACCOUNT_2_RELAY_URL="http://127.0.0.1:6112/request";
 process.env.CLAUDE_ACCOUNT_2_RELAY_KEY="two-private-test-key-12345678901234567890";
 assert(claudeAccountUsesBrowser("account_1"));assert(claudeAccountUsesBrowser("account_2"));
 // Card 1 activates only Account 1's browser; Card 2 only Account 2's.
 await pushClaudeBrowserSession("account_1",exported.cookies);
 await pushClaudeBrowserSession("account_2",exported.cookies);
 assert.equal(calls[0].input,"http://127.0.0.1:6101/session");
 assert.equal(calls[1].input,"http://127.0.0.1:6112/session");
 assert.equal(calls[0].init.headers.Authorization,"Bearer "+process.env.CLAUDE_BROWSER_RELAY_KEY);
 assert.equal(calls[1].init.headers.Authorization,"Bearer "+process.env.CLAUDE_ACCOUNT_2_RELAY_KEY);
 assert.equal(JSON.parse(calls[1].init.body).cookies[0].name,"sessionKey");
 // Older saved sessions without an expiry are made persistent when pushed.
 await pushClaudeBrowserSession("account_1",[{name:"sessionKey",value:"sk-old",domain:".claude.ai",path:"/"}]);
 const pushed=JSON.parse(calls[2].init.body).cookies[0];
 assert(pushed.expires>Date.now()/1000+29*86400);
 // Misconfigured or missing relays never fall back to another account.
 calls.length=0;
 process.env.CLAUDE_ACCOUNT_2_RELAY_URL=BROWSER_RELAY_URL;
 await assert.rejects(()=>pushClaudeBrowserSession("account_2",exported.cookies));
 delete process.env.CLAUDE_ACCOUNT_2_RELAY_URL;
 assert(!claudeAccountUsesBrowser("account_2"));
 await assert.rejects(()=>pushClaudeBrowserSession("account_2",exported.cookies));
 assert.equal(calls.length,0);
 globalThis.fetch=(async()=>new Response("",{status:404})) as typeof fetch;
 await assert.rejects(()=>pushClaudeBrowserSession("account_1",exported.cookies),/relay must be updated/);
 console.log("Claude per-account session cards: cookie-export parsing, per-account browser activation and no cross-account fallback passed.");
}finally{globalThis.fetch=original;process.env=saved;}
