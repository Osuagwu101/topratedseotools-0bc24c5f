/**
 * Phase 2 ChatGPT admin-session vault regression tests.
 * Run: bun tests/chatgpt-session-vault.test.ts
 */
import {
  decryptChatGptSession,
  encryptChatGptSession,
  normaliseChatGptSession,
} from "../src/lib/chatgpt-session.server";

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

const raw = JSON.stringify({
  authenticated_cookies: [
    {
      name: "__Secure-chat-session",
      value: "opaque-chat-session-value",
      domain: ".chatgpt.com",
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "Lax",
    },
    {
      name: "openai_app_state",
      value: "opaque-openai-state",
      domain: ".openai.com",
      path: "/",
      secure: true,
    },
    {
      name: "_ga",
      value: "analytics-value",
      domain: ".chatgpt.com",
      path: "/",
    },
    {
      name: "cf_clearance",
      value: "challenge-value",
      domain: ".chatgpt.com",
      path: "/",
    },
  ],
  session_tokens: {
    storage: {
      localStorage: { "app-key": "opaque-local" },
      sessionStorage: { "session-key": "opaque-session" },
    },
  },
});

const normalised = normaliseChatGptSession(raw);
const parsed = JSON.parse(normalised);

assert(
  parsed.authenticated_cookies.length === 2,
  "keeps reusable first-party ChatGPT/OpenAI cookies and drops excluded cookies",
);
assert(
  parsed.authenticated_cookies.some(
    (cookie: any) =>
      cookie.name === "__Secure-chat-session" &&
      cookie.value === "opaque-chat-session-value",
  ),
  "preserves ChatGPT first-party cookie values exactly",
);
assert(
  parsed.authenticated_cookies.some(
    (cookie: any) =>
      cookie.name === "openai_app_state" &&
      cookie.value === "opaque-openai-state",
  ),
  "preserves OpenAI first-party cookie values exactly",
);
assert(
  !parsed.authenticated_cookies.some(
    (cookie: any) => cookie.name === "_ga" || cookie.name === "cf_clearance",
  ),
  "does not store analytics or Cloudflare challenge cookies",
);
assert(
  parsed.session_tokens.storage.localStorage["app-key"] === "opaque-local" &&
    parsed.session_tokens.storage.sessionStorage["session-key"] ===
      "opaque-session",
  "preserves browser storage values inside the encrypted session container",
);

assert(
  throws(() =>
    normaliseChatGptSession(
      JSON.stringify({
        authenticated_cookies: [
          {
            name: "session",
            value: "opaque",
            domain: ".evil.example",
            path: "/",
          },
        ],
      }),
    ),
  ),
  "rejects cookies from unrelated domains",
);

assert(
  throws(() => normaliseChatGptSession("not-json")),
  "rejects malformed session JSON",
);

assert(
  throws(() =>
    normaliseChatGptSession(
      JSON.stringify({
        authenticated_cookies: [
          {
            name: "cf_clearance",
            value: "only-challenge-cookie",
            domain: ".chatgpt.com",
            path: "/",
          },
        ],
      }),
    ),
  ),
  "rejects a container that contains only excluded challenge state",
);

const keyA = "33".repeat(32);
const keyB = "44".repeat(32);
const encryptedA = encryptChatGptSession(normalised, keyA);
const encryptedB = encryptChatGptSession(normalised, keyA);

assert(encryptedA !== encryptedB, "uses a fresh AES-GCM IV for every save");
assert(
  !encryptedA.includes("opaque-chat-session-value") &&
    !encryptedA.includes("opaque-local"),
  "does not leave cookie/storage values visible in ciphertext",
);
assert(
  decryptChatGptSession(encryptedA, keyA) === normalised,
  "round-trips the encrypted ChatGPT session with the correct key",
);
assert(
  throws(() => decryptChatGptSession(encryptedA, keyB)),
  "fails closed when the wrong encryption key is used",
);
assert(
  throws(() => encryptChatGptSession(normalised, "too-short")),
  "rejects an invalid dedicated encryption key",
);

const previousDedicated = process.env.CHATGPT_SESSION_ENCRYPTION_KEY;
const previousServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.CHATGPT_SESSION_ENCRYPTION_KEY;
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-secret-chatgpt-A";
const derivedEncrypted = encryptChatGptSession(normalised);
assert(
  decryptChatGptSession(derivedEncrypted) === normalised,
  "derives a working isolated vault key from the server-only service key",
);
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-secret-chatgpt-B";
assert(
  throws(() => decryptChatGptSession(derivedEncrypted)),
  "derived ciphertext fails closed after the underlying server secret changes",
);

if (previousDedicated === undefined) {
  delete process.env.CHATGPT_SESSION_ENCRYPTION_KEY;
} else {
  process.env.CHATGPT_SESSION_ENCRYPTION_KEY = previousDedicated;
}
if (previousServiceRole === undefined) {
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
} else {
  process.env.SUPABASE_SERVICE_ROLE_KEY = previousServiceRole;
}

console.log(`chatgpt-session-vault: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
