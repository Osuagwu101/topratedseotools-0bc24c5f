/**
 * Phase 2 Phrasly admin-session vault regression tests.
 * Run: bun tests/phrasly-session-vault.test.ts
 */
import {
  decryptPhraslySession,
  encryptPhraslySession,
  normalisePhraslySession,
} from "../src/lib/phrasly-session.server";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, message: string) {
  if (condition) passed++;
  else {
    failed++;
    failures.push(message);
    console.error("  ✗", message);
  }
}

function throws(fn: () => unknown) {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

const keyA = "33".repeat(32);
const keyB = "44".repeat(32);

const legacyCapture = JSON.stringify({
  authenticated_cookies: [
    {
      name: "__session",
      value: "opaque-cookie-value==",
      domain: ".phrasly.ai",
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "Lax",
    },
    {
      name: "_ga",
      value: "tracking-only",
      domain: ".phrasly.ai",
      path: "/",
    },
  ],
  session_tokens: {
    captured_at: "2026-09-25T00:00:00.000Z",
    storage: {
      localStorage: {
        "auth-token": "opaque-local-token",
      },
      sessionStorage: {
        "workspace-state": "opaque-session-value",
      },
    },
  },
  auth_headers: {},
});

const normalised = normalisePhraslySession(legacyCapture);
const parsed = JSON.parse(normalised);
assert(
  parsed.authenticated_cookies.length === 1 &&
    parsed.authenticated_cookies[0].name === "__session",
  "keeps reusable first-party cookies and drops analytics cookies",
);
assert(
  parsed.authenticated_cookies[0].value === "opaque-cookie-value==",
  "preserves cookie values exactly",
);
assert(
  parsed.session_tokens.storage.localStorage["auth-token"] === "opaque-local-token",
  "preserves localStorage token values exactly",
);
assert(
  parsed.session_tokens.storage.sessionStorage["workspace-state"] === "opaque-session-value",
  "preserves sessionStorage values exactly",
);

const friendlyShape = normalisePhraslySession(
  JSON.stringify({
    cookies: [
      { name: "session", value: "value-_/=+", domain: "app.phrasly.ai" },
    ],
    storage: {
      localStorage: { token: "abc" },
      sessionStorage: {},
    },
  }),
);
assert(
  JSON.parse(friendlyShape).authenticated_cookies[0].domain === "app.phrasly.ai",
  "accepts the simpler admin-friendly cookies/storage shape",
);

assert(
  throws(() =>
    normalisePhraslySession(
      JSON.stringify({
        cookies: [
          { name: "session", value: "secret", domain: ".google.com" },
        ],
      }),
    ),
  ),
  "rejects cookies from unrelated domains",
);

assert(
  throws(() => normalisePhraslySession(JSON.stringify({ cookies: [] }))),
  "requires at least one reusable Phrasly cookie",
);
assert(
  throws(() => normalisePhraslySession("not-json")),
  "rejects malformed JSON",
);

const encryptedA = encryptPhraslySession(normalised, keyA);
const encryptedB = encryptPhraslySession(normalised, keyA);
assert(encryptedA !== encryptedB, "uses a fresh AES-GCM IV for every save");
assert(
  !encryptedA.includes("opaque-cookie-value") &&
    !encryptedA.includes("opaque-local-token"),
  "does not leave cookie or storage secrets visible in ciphertext",
);
assert(
  decryptPhraslySession(encryptedA, keyA) === normalised,
  "round-trips the encrypted Phrasly session with the correct key",
);
assert(
  throws(() => decryptPhraslySession(encryptedA, keyB)),
  "fails closed with the wrong encryption key",
);
assert(
  throws(() => encryptPhraslySession(normalised, "too-short")),
  "rejects an invalid dedicated encryption key",
);

const previousDedicated = process.env.PHRASLY_SESSION_ENCRYPTION_KEY;
const previousServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.PHRASLY_SESSION_ENCRYPTION_KEY;
process.env.SUPABASE_SERVICE_ROLE_KEY = "phrasly-test-service-role-secret-A";
const derivedEncrypted = encryptPhraslySession(normalised);
assert(
  decryptPhraslySession(derivedEncrypted) === normalised,
  "derives an isolated Phrasly vault key from the server-only service key",
);
process.env.SUPABASE_SERVICE_ROLE_KEY = "phrasly-test-service-role-secret-B";
assert(
  throws(() => decryptPhraslySession(derivedEncrypted)),
  "derived ciphertext fails closed after the underlying server secret changes",
);
if (previousDedicated === undefined) delete process.env.PHRASLY_SESSION_ENCRYPTION_KEY;
else process.env.PHRASLY_SESSION_ENCRYPTION_KEY = previousDedicated;
if (previousServiceRole === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
else process.env.SUPABASE_SERVICE_ROLE_KEY = previousServiceRole;

const migration = await Bun.file(
  "supabase/migrations/20260925170000_phrasly_session_vault.sql",
).text();
assert(
  migration.includes("'stealthwriter', 'phrasly'"),
  "vault migration keeps StealthWriter and adds only Phrasly",
);

const functions = await Bun.file("src/lib/phrasly-session.functions.ts").text();
assert(
  functions.includes("adminGetPhraslySessionStatus") &&
    functions.includes("adminSavePhraslySession") &&
    functions.includes("is_super_admin"),
  "Phrasly vault exposes metadata read + Super Admin write operations",
);
assert(
  !functions.includes("decryptPhraslySession"),
  "Admin server functions never decrypt or return stored Phrasly state",
);

console.log(`phrasly-session-vault: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
