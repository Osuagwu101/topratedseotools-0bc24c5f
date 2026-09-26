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
      name: "session",
      value: "opaque-cookie-value==",
      domain: ".phrasly.ai",
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "Lax",
    },
    {
      name: "app_state",
      value: "opaque-first-party-state",
      domain: ".phrasly.ai",
      path: "/",
    },
    {
      name: "_ga",
      value: "tracking-only",
      domain: ".phrasly.ai",
      path: "/",
    },
    {
      name: "cf_clearance",
      value: "challenge-cookie-is-not-vaulted",
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
  parsed.authenticated_cookies.length === 2 &&
    parsed.authenticated_cookies[0].name === "session" &&
    parsed.authenticated_cookies.some((cookie: any) => cookie.name === "app_state"),
  "keeps reusable first-party Phrasly state while dropping tracker/challenge cookies",
);
assert(
  parsed.authenticated_cookies[0].value === "opaque-cookie-value==" &&
    parsed.authenticated_cookies.some(
      (cookie: any) =>
        cookie.name === "app_state" &&
        cookie.value === "opaque-first-party-state",
    ),
  "preserves reusable first-party cookie values exactly",
);
assert(
  !parsed.authenticated_cookies.some(
    (cookie: any) => cookie.name === "_ga" || cookie.name === "cf_clearance",
  ),
  "does not vault analytics or Cloudflare challenge cookies",
);
assert(
  parsed.session_tokens.storage.localStorage["auth-token"] === "opaque-local-token",
  "preserves localStorage token values exactly",
);
assert(
  parsed.session_tokens.storage.sessionStorage["workspace-state"] === "opaque-session-value",
  "preserves sessionStorage values exactly",
);

const quickPaste = normalisePhraslySession("eyJhbGciOiJIUzI1NiJ9.test.signature");
const quickParsed = JSON.parse(quickPaste);
assert(
  quickParsed.authenticated_cookies.length === 1 &&
    quickParsed.authenticated_cookies[0].name === "session" &&
    quickParsed.authenticated_cookies[0].domain === ".phrasly.ai" &&
    quickParsed.authenticated_cookies[0].path === "/",
  "wraps a bare Phrasly session cookie value into the canonical server-only shape",
);
assert(
  quickParsed.session_tokens.storage.localStorage &&
    Object.keys(quickParsed.session_tokens.storage.localStorage).length === 0 &&
    Object.keys(quickParsed.session_tokens.storage.sessionStorage).length === 0,
  "quick-paste does not invent browser-storage secrets",
);

const cookiePairPaste = normalisePhraslySession(
  "session=opaque-cookie-pair-value==",
);
assert(
  JSON.parse(cookiePairPaste).authenticated_cookies[0].value ===
    "opaque-cookie-pair-value==",
  "accepts a session=<value> quick-paste form",
);

const friendlyShape = normalisePhraslySession(
  JSON.stringify({
    cookies: [
      { name: "session", value: "value-_/=+", domain: ".phrasly.ai", path: "/" },
    ],
    storage: {
      localStorage: { token: "abc" },
      sessionStorage: {},
    },
  }),
);
assert(
  JSON.parse(friendlyShape).authenticated_cookies[0].domain === ".phrasly.ai",
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
  throws(() =>
    normalisePhraslySession(
      JSON.stringify({
        cookies: [
          { name: "session", value: "secret", domain: "app.phrasly.ai", path: "/" },
        ],
      }),
    ),
  ),
  "rejects a session cookie scoped only to a Phrasly subdomain",
);

assert(
  throws(() =>
    normalisePhraslySession(
      JSON.stringify({
        cookies: [
          { name: "_fbp", value: "tracking-only", domain: ".phrasly.ai", path: "/" },
        ],
      }),
    ),
  ),
  "requires the actual Phrasly session cookie instead of tracker cookies",
);

assert(
  throws(() => normalisePhraslySession(JSON.stringify({ cookies: [] }))),
  "requires at least one reusable Phrasly cookie",
);
assert(
  throws(() => normalisePhraslySession('{"cookies":')),
  "rejects malformed JSON when the Admin uses the JSON format",
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
  "supabase/migrations/20260925161301_phrasly_session_vault.sql",
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
