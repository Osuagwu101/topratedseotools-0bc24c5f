import {strict as assert} from "node:assert";
import {readFileSync} from "node:fs";
import {issueClaudeNativeAdminHandoff,issueClaudeNativeWriterHandoff,handleClaudeNativeRedeem} from "../src/lib/claude-native.server";
await assert.rejects(()=>issueClaudeNativeAdminHandoff("admin"),/pilot has ended/);
await assert.rejects(()=>issueClaudeNativeWriterHandoff("writer"),/pilot has ended/);
for (const method of ["GET","POST","OPTIONS"]) {
 const r=await handleClaudeNativeRedeem(new Request("https://topratedseotools.com/api/claude-native/redeem",{method}));
 assert.equal(r.status,410);
 assert.equal(r.headers.get("Cache-Control"),"no-store");
 assert.equal(r.headers.get("Access-Control-Allow-Origin"),null);
 assert(!(await r.text()).includes("sessionKey"));
}
const launcher=readFileSync("src/lib/tool-launcher.ts","utf8");
assert(!launcher.includes("launchClaudeNativeWriterPilot"));
assert(launcher.includes("await startClaudeProxyLaunch()"));
assert(!readFileSync("src/components/tools/ToolAccessPanel.tsx","utf8").includes("Download Claude extension"));
console.log("Claude extension retirement: issuance blocked, redemption returns 410, writer launch uses server proxy.");
