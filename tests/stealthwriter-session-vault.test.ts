/**
 * Phase 2 StealthWriter admin-session vault regression tests.
 * Run: bun tests/stealthwriter-session-vault.test.ts
 */
import {
  decryptStealthWriterSession,
  encryptStealthWriterSession,
  normaliseStealthWriterSession,
} from "../src/lib/stealthwriter-session.server";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, message: string) {
  if (condition) {
    passed++;
  } else {
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

const keyA = "11".repeat(32);
const keyB = "22".repeat(32);
const input = JSON.stringify({
  "__Secure-better-auth.session_token": "token.value-_/=+",
  "__Secure-better-auth.session_data": "opaque.data.value==",
});

const normalised = normaliseStealthWriterSession(input);
const parsed = JSON.parse(normalised);
assert(
  parsed["__Secure-better-auth.session_token"] === "token.value-_/=+",
  "preserves the session-token value exactly",
);
assert(
  parsed["__Secure-better-auth.session_data"] === "opaque.data.value==",
  "preserves the session-data value exactly",
);

assert(
  throws(() =>
    normaliseStealthWriterSession(
      JSON.stringify({ "__Secure-better-auth.session_token": "only-one" }),
    ),
  ),
  "rejects a missing required cookie",
);

assert(
  throws(() =>
    normaliseStealthWriterSession(
      JSON.stringify({
        "__Secure-better-auth.session_token": "token",
        "__Secure-better-auth.session_data": "data",
        "another-cookie": "must-not-be-accepted",
      }),
    ),
  ),
  "rejects extra cookies instead of silently storing or discarding them",
);

assert(
  throws(() =>
    normaliseStealthWriterSession(
      JSON.stringify({
        "__Secure-better-auth.session_token": "PASTE_TOKEN_VALUE_HERE",
        "__Secure-better-auth.session_data": "PASTE_DATA_VALUE_HERE",
      }),
    ),
  ),
  "rejects the video-template placeholders",
);

assert(
  throws(() => normaliseStealthWriterSession("not-json")),
  "rejects malformed JSON",
);

const encryptedA = encryptStealthWriterSession(normalised, keyA);
const encryptedB = encryptStealthWriterSession(normalised, keyA);
assert(encryptedA !== encryptedB, "uses a fresh AES-GCM IV for every save");
assert(
  !encryptedA.includes("token.value") && !encryptedA.includes("opaque.data"),
  "does not leave the cookie values visible in stored ciphertext",
);
assert(
  decryptStealthWriterSession(encryptedA, keyA) === normalised,
  "round-trips the encrypted session with the correct key",
);
assert(
  throws(() => decryptStealthWriterSession(encryptedA, keyB)),
  "fails closed when the wrong encryption key is used",
);
assert(
  throws(() => encryptStealthWriterSession(normalised, "too-short")),
  "rejects an invalid encryption key",
);

const previousDedicated = process.env.STEALTHWRITER_SESSION_ENCRYPTION_KEY;
const previousServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.STEALTHWRITER_SESSION_ENCRYPTION_KEY;
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-secret-A";
const derivedEncrypted = encryptStealthWriterSession(normalised);
assert(
  decryptStealthWriterSession(derivedEncrypted) === normalised,
  "derives a working vault key from the existing server-only service key",
);
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-secret-B";
assert(
  throws(() => decryptStealthWriterSession(derivedEncrypted)),
  "derived vault ciphertext fails closed after the underlying server secret changes",
);
if (previousDedicated === undefined) {
  delete process.env.STEALTHWRITER_SESSION_ENCRYPTION_KEY;
} else {
  process.env.STEALTHWRITER_SESSION_ENCRYPTION_KEY = previousDedicated;
}
if (previousServiceRole === undefined) {
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
} else {
  process.env.SUPABASE_SERVICE_ROLE_KEY = previousServiceRole;
}

console.log(`stealthwriter-session-vault: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
