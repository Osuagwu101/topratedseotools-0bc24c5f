/**
 * Phase 2 QuillBot admin-session vault regression tests.
 * Run: bun tests/quillbot-session-vault.test.ts
 */
import {
  decryptQuillBotSession,
  encryptQuillBotSession,
  normaliseQuillBotSession,
} from "../src/lib/quillbot-session.server.ts";

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
  "cookie": "a=opaqueValue==; b=second+value",
  "useridtoken": "opaque.user.token==",
});

const normalised = normaliseQuillBotSession(input);
const parsed = JSON.parse(normalised);
assert(
  parsed.cookie === "a=opaqueValue==; b=second+value",
  "preserves the session-token value exactly",
);
assert(
  parsed.useridtoken === "opaque.user.token==",
  "preserves the session-data value exactly",
);

assert(
  throws(() =>
    normaliseQuillBotSession(
      JSON.stringify({ "cookie": "only-one" }),
    ),
  ),
  "rejects a missing required cookie",
);

assert(
  throws(() =>
    normaliseQuillBotSession(
      JSON.stringify({
        "cookie": "a=token",
        "useridtoken": "data",
        "another-cookie": "must-not-be-accepted",
      }),
    ),
  ),
  "rejects extra cookies instead of silently storing or discarding them",
);

assert(
  throws(() =>
    normaliseQuillBotSession(
      JSON.stringify({
        "cookie": "PASTE_TOKEN_VALUE_HERE",
        "useridtoken": "PASTE_DATA_VALUE_HERE",
      }),
    ),
  ),
  "rejects the video-template placeholders",
);

assert(
  throws(() => normaliseQuillBotSession("not-json")),
  "rejects malformed JSON",
);

const encryptedA = encryptQuillBotSession(normalised, keyA);
const encryptedB = encryptQuillBotSession(normalised, keyA);
assert(encryptedA !== encryptedB, "uses a fresh AES-GCM IV for every save");
assert(
  !encryptedA.includes("opaqueValue") && !encryptedA.includes("opaque.user.token"),
  "does not leave the cookie values visible in stored ciphertext",
);
assert(
  decryptQuillBotSession(encryptedA, keyA) === normalised,
  "round-trips the encrypted session with the correct key",
);
assert(
  throws(() => decryptQuillBotSession(encryptedA, keyB)),
  "fails closed when the wrong encryption key is used",
);
assert(
  throws(() => encryptQuillBotSession(normalised, "too-short")),
  "rejects an invalid encryption key",
);

const previousDedicated = process.env.QUILLBOT_SESSION_ENCRYPTION_KEY;
const previousServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.QUILLBOT_SESSION_ENCRYPTION_KEY;
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-secret-A";
const derivedEncrypted = encryptQuillBotSession(normalised);
assert(
  decryptQuillBotSession(derivedEncrypted) === normalised,
  "derives a working vault key from the existing server-only service key",
);
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-secret-B";
assert(
  throws(() => decryptQuillBotSession(derivedEncrypted)),
  "derived vault ciphertext fails closed after the underlying server secret changes",
);
if (previousDedicated === undefined) {
  delete process.env.QUILLBOT_SESSION_ENCRYPTION_KEY;
} else {
  process.env.QUILLBOT_SESSION_ENCRYPTION_KEY = previousDedicated;
}
if (previousServiceRole === undefined) {
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
} else {
  process.env.SUPABASE_SERVICE_ROLE_KEY = previousServiceRole;
}

console.log(`quillbot-session-vault: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
