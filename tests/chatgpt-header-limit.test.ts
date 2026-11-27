/** Run: bun tests/chatgpt-header-limit.test.ts */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The ChatGPT process must always start with a larger header limit, or large
// ChatGPT response headers fail with UND_ERR_HEADERS_OVERFLOW (reference GPT-04).
const deploy = readFileSync(new URL("../scripts/deploy/ovh_deploy_main.py", import.meta.url), "utf8");
assert.match(deploy, /--max-http-header-size=1048576/);
assert.match(deploy, /UND_ERR_HEADERS_OVERFLOW/);
console.log("chatgpt-header-limit: ok");
