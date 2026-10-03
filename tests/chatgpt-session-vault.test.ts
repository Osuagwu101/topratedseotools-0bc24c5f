/**
 * ChatGPT Phase 5 authorised-session vault regression tests.
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
      name: "__Secure-next-auth.session-token.0",
      value: "opaque-session-part-0",
      domain: ".chatgpt.com",
      path: "/",
    },
    {
      name: "__Secure-next-auth.session-token.1",
      value: "opaque-session-part-1",
      domain: ".chatgpt.com",
      path: "/",
    },
    {
      name: "__Host-next-auth.csrf-token",
      value: "opaque-csrf",
      domain: ".chatgpt.com",
      path: "/",
    },
    {
      name: "__Secure-next-auth.callback-url",
      value: "https://chatgpt.com/",
      domain: ".chatgpt.com",
      path: "/",
    },
    {
      name: "oai-did",
      value: "supporting-device",
      domain: ".chatgpt.com",
      path: "/",
    },
    {
      name: "_account",
      value: "supporting-account",
      domain: ".chatgpt.com",
      path: "/",
    },
    {
      name: "_puid",
      value: "supporting-puid",
      domain: ".chatgpt.com",
      path: "/",
    },
    {
      name: "_uasid",
      value: "supporting-uasid",
      domain: ".chatgpt.com",
      path: "/",
    },
    {
      name: "_umsid",
      value: "supporting-umsid",
      domain: ".chatgpt.com",
      path: "/",
    },
    {
      name: "oai-sc",
      value: "supporting-security",
      domain: ".chatgpt.com",
      path: "/",
    },
    {
      name: "cf_clearance",
      value: "discard-me-too",
      domain: ".chatgpt.com",
      path: "/",
    },
  ],
  session_tokens: {
    storage: {
      localStorage: { old: "must-not-survive" },
      sessionStorage: { old: "must-not-survive" },
    },
  },
});

const normalised = normaliseChatGptSession(raw);
const parsed = JSON.parse(normalised);

assert(parsed.version === 3, "writes the v3 minimal session format");
assert(
  JSON.stringify(parsed.cookies.map((cookie: any) => cookie.name)) ===
    JSON.stringify([
      "__Secure-next-auth.session-token.0",
      "__Secure-next-auth.session-token.1",
      "__Host-next-auth.csrf-token",
      "__Secure-next-auth.callback-url",
      "_account",
      "_puid",
      "_uasid",
      "_umsid",
      "oai-did",
      "oai-sc",
    ]),
  "keeps only the session-token family and known supporting auth cookies",
);
assert(
  parsed.cookies[0].value === "opaque-session-part-0" &&
    parsed.cookies[1].value === "opaque-session-part-1",
  "preserves session-token chunk values exactly",
);

const simpleMap = JSON.parse(
  normaliseChatGptSession(
    JSON.stringify({
      "__Secure-next-auth.session-token.0": "simple-part-0",
      "__Secure-next-auth.session-token.1": "simple-part-1",
      "_account": "simple-account",
      "oai-did": "simple-device",
      "oai-sc": "simple-security",
    }),
  ),
);
assert(
  simpleMap.cookies.some((cookie: any) => cookie.name === "_account") &&
    simpleMap.cookies.some((cookie: any) => cookie.name === "oai-did"),
  "accepts approved supporting cookies in the simple Admin cookie map",
);
assert(
  !normalised.includes("must-not-survive") &&
    normalised.includes("oai-did") &&
    !normalised.includes("cf_clearance"),
  "keeps approved supporting state while dropping browser storage and challenge cookies",
);

assert(
  throws(() =>
    normaliseChatGptSession(
      JSON.stringify({
        cookies: [
          {
            name: "__Host-next-auth.csrf-token",
            value: "csrf-only",
            domain: ".chatgpt.com",
            path: "/",
          },
        ],
      }),
    ),
  ),
  "rejects a session with no NextAuth session token",
);

assert(
  throws(() =>
    normaliseChatGptSession(
      JSON.stringify({
        cookies: [
          {
            name: "__Secure-next-auth.session-token.0",
            value: "part-0",
            domain: ".chatgpt.com",
            path: "/",
          },
          {
            name: "__Secure-next-auth.session-token.2",
            value: "part-2",
            domain: ".chatgpt.com",
            path: "/",
          },
        ],
      }),
    ),
  ),
  "rejects a chunked session with a missing chunk",
);

assert(
  throws(() =>
    normaliseChatGptSession(
      JSON.stringify({
        cookies: [
          {
            name: "__Secure-next-auth.session-token",
            value: "whole",
            domain: ".chatgpt.com",
            path: "/",
          },
          {
            name: "__Secure-next-auth.session-token.0",
            value: "part-0",
            domain: ".chatgpt.com",
            path: "/",
          },
          {
            name: "__Secure-next-auth.session-token.1",
            value: "part-1",
            domain: ".chatgpt.com",
            path: "/",
          },
        ],
      }),
    ),
  ),
  "rejects mixed unchunked and chunked token formats",
);

const unchunked = JSON.parse(
  normaliseChatGptSession(
    JSON.stringify({
      cookies: [
        {
          name: "__Secure-next-auth.session-token",
          value: "whole-session",
          domain: ".chatgpt.com",
          path: "/",
        },
      ],
    }),
  ),
);
assert(
  unchunked.cookies.length === 1 &&
    unchunked.cookies[0].name === "__Secure-next-auth.session-token",
  "accepts one valid unchunked session token",
);

assert(
  throws(() =>
    normaliseChatGptSession(
      JSON.stringify({
        cookies: [
          {
            name: "__Secure-next-auth.session-token.0",
            value: "part-0",
            domain: ".evil.example",
            path: "/",
          },
          {
            name: "__Secure-next-auth.session-token.1",
            value: "part-1",
            domain: ".chatgpt.com",
            path: "/",
          },
        ],
      }),
    ),
  ),
  "rejects a session-token chunk with the wrong domain",
);

assert(
  throws(() =>
    normaliseChatGptSession(
      JSON.stringify({
        cookies: [
          {
            name: "__Secure-next-auth.session-token.0",
            value: "part-0",
            domain: ".chatgpt.com",
            path: "/wrong",
          },
          {
            name: "__Secure-next-auth.session-token.1",
            value: "part-1",
            domain: ".chatgpt.com",
            path: "/",
          },
        ],
      }),
    ),
  ),
  "rejects a session-token chunk with the wrong path",
);

const keyA = "33".repeat(32);
const keyB = "44".repeat(32);
const encryptedA = encryptChatGptSession(normalised, keyA);
const encryptedB = encryptChatGptSession(normalised, keyA);

assert(encryptedA !== encryptedB, "uses a fresh AES-GCM IV for every save");
assert(
  !encryptedA.includes("opaque-session-part-0"),
  "does not leave session-token values visible in ciphertext",
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

console.log(`chatgpt-session-vault: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
