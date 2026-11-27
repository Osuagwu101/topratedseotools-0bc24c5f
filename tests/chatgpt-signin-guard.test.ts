/** Run: bun tests/chatgpt-signin-guard.test.ts */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isChatGptSignInPath } from "../src/lib/chatgpt-access-notice";

for (const p of ["/auth/login", "/auth/login/", "/auth/login_with", "/auth/logout", "/auth/error", "/auth/signin", "/auth/signup"]) {
  if (p === "/auth/login_with") assert.equal(isChatGptSignInPath(p), false, p);
  else assert.equal(isChatGptSignInPath(p), true, p);
}
for (const p of ["/", "/c/abc", "/api/auth/session", "/backend-api/me", "/g/g-p-abc/project"]) {
  assert.equal(isChatGptSignInPath(p), false, p);
}

// The proxy must use the guard before fetching and on redirects.
const src = readFileSync(new URL("../src/lib/chatgpt-proxy.server.ts", import.meta.url), "utf8");
assert.equal((src.match(/isChatGptSignInPath\(/g) ?? []).length >= 2, true);
console.log("chatgpt-signin-guard: ok");
