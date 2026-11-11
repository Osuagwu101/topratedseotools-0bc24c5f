/**
 * Grammarly authorised-session vault.
 * Run: bun tests/grammarly-session-vault.test.ts
 */
import { readFileSync } from "node:fs";
import {
  decryptGrammarlySession,
  encryptGrammarlySession,
  normaliseGrammarlySession,
} from "../src/lib/grammarly-session.server";

let passed = 0;
let failed = 0;
function assert(condition: boolean, message: string) {
  if (condition) passed++;
  else {
    failed++;
    console.error("  x", message);
  }
}
const throws = (fn: () => unknown) => {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
};

const key = "a".repeat(64);
const bundle = JSON.stringify({
  version: 2,
  cookies: [
    { name: "grauth", value: "AUTH", domain: ".grammarly.com", path: "/" },
    { name: "csrf-token", value: "CSRF", domain: ".grammarly.com", path: "/" },
    { name: "_ga", value: "x", domain: ".grammarly.com", path: "/" },
  ],
});
const normal = JSON.parse(normaliseGrammarlySession(bundle));
assert(normal.cookies.length === 2, "keeps Grammarly auth cookies and drops analytics");
assert(throws(() => normaliseGrammarlySession(JSON.stringify({ cookies: [{ name: "a", value: "b", domain: ".chatgpt.com", path: "/" }] }))), "rejects cookies for other sites");
assert(throws(() => normaliseGrammarlySession("[]")), "rejects a bare array");
const env = encryptGrammarlySession(normaliseGrammarlySession(bundle), key);
assert(!env.includes("AUTH") && !env.includes("CSRF"), "ciphertext hides cookie values");
assert(JSON.parse(decryptGrammarlySession(env, key)).cookies[0].value === "AUTH", "round-trips through encryption");
assert(throws(() => decryptGrammarlySession(env, "b".repeat(64))), "wrong key cannot decrypt");

const fns = readFileSync("src/lib/grammarly-session.functions.ts", "utf8");
assert(!fns.includes("setGrammarlyOneClickEnabled(admin, true)"), "saving does not switch on one-click before the proxy exists");
assert(fns.includes("assertSuperAdmin"), "only Super Admins can replace the session");
const migration = readFileSync("supabase/migrations/20261111230000_grammarly_session_vault.sql", "utf8");
assert(migration.includes("'grammarly'::text"), "vault accepts the grammarly slug");

console.log(`grammarly-session-vault: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
