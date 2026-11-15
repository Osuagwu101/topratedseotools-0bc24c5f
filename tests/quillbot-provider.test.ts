import assert from "node:assert/strict";
import {
  QUILLBOT_LANDING_PATH,
  isBlockedQuillBotPath,
  resolveQuillBotUpstreamPath,
  rewriteQuillBotUpstreamLocation,
} from "../src/lib/quillbot-provider.server.ts";

assert.equal(QUILLBOT_LANDING_PATH, "/paraphrasing-tool");
assert.equal(resolveQuillBotUpstreamPath("/paraphrasing-tool")?.href, "https://quillbot.com/paraphrasing-tool");
assert.equal(
  resolveQuillBotUpstreamPath("/__host/media.quillbot.com/api/auth/token")?.href,
  "https://media.quillbot.com/api/auth/token",
);
assert.equal(resolveQuillBotUpstreamPath("/__host/evil.example/admin"), null);
assert.equal(isBlockedQuillBotPath("/account/settings"), true);
assert.equal(resolveQuillBotUpstreamPath("/billing"), null);
assert.equal(
  rewriteQuillBotUpstreamLocation("/paraphrasing-tool?ref=home"),
  "/__qbtest/paraphrasing-tool?ref=home",
);
assert.equal(
  rewriteQuillBotUpstreamLocation("https://media.quillbot.com/api/auth/token"),
  "/__qbtest/__host/media.quillbot.com/api/auth/token",
);
assert.equal(rewriteQuillBotUpstreamLocation("https://example.com/"), null);
assert.equal(rewriteQuillBotUpstreamLocation("https://quillbot.com/account"), null);
assert.equal(resolveQuillBotUpstreamPath("/__host"), null);
assert.equal(resolveQuillBotUpstreamPath("/__host/"), null);
assert.equal(resolveQuillBotUpstreamPath("/__host/media.quillbot.com/account/settings"), null);
assert.equal(resolveQuillBotUpstreamPath("/__host/media.quillbot.com/billing"), null);
assert.equal(rewriteQuillBotUpstreamLocation("https://media.quillbot.com/account"), null);
assert.equal(rewriteQuillBotUpstreamLocation("https://media.quillbot.com/billing"), null);
assert.equal(resolveQuillBotUpstreamPath("/__host/media.quillbot.com//otherhost.example"), null);
console.log("quillbot-provider: 17 passed, 0 failed");
