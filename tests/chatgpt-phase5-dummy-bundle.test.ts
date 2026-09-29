import { normaliseChatGptSession } from "../src/lib/chatgpt-session.server";
import { buildChatGPTCookieHeader } from "../src/lib/chatgpt-proxy.server";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, message: string) {
  if (condition) passed++;
  else {
    failed++;
    failures.push(message);
    console.error("✗ " + message);
  }
}

const raw = JSON.stringify({
  version: 2,
  cookies: [
    {
      name: "__Secure-next-auth.session-token.0",
      value: "dummy_session_token_value_phase5_test",
      domain: ".chatgpt.com",
      path: "/",
    },
    {
      name: "_Host-next-auth.csrf-token",
      value: "dummy_csrf_token_value_phase5_test",
      domain: ".chatgpt.com",
      path: "/",
    },
    {
      name: "__Secure-oai-is",
      value: "dummy_oai_is_value_phase5_test",
      domain: ".chatgpt.com",
      path: "/",
    },
  ],
});

const normalised = JSON.parse(normaliseChatGptSession(raw));
assert(normalised.version === 2, "preserves v2 session format");
assert(normalised.cookies.length === 3, "keeps all three cookie objects");
assert(
  normalised.cookies.map((c: any) => c.name).join("|") ===
    "__Secure-next-auth.session-token.0|_Host-next-auth.csrf-token|__Secure-oai-is",
  "preserves all three cookie names in order",
);

const header = buildChatGPTCookieHeader(raw, "https://chatgpt.com/");
const parts = header.split("; ").filter(Boolean);
assert(parts.length === 3, "builds one outgoing Cookie header containing three cookies");
assert(
  parts.includes("__Secure-next-auth.session-token.0=dummy_session_token_value_phase5_test"),
  "includes dummy session token cookie",
);
assert(
  parts.includes("_Host-next-auth.csrf-token=dummy_csrf_token_value_phase5_test"),
  "includes dummy CSRF cookie",
);
assert(
  parts.includes("__Secure-oai-is=dummy_oai_is_value_phase5_test"),
  "includes dummy session-state cookie",
);

console.log(`phase5-dummy-bundle: ${passed} passed, ${failed} failed`);
if (failed) {
  console.error(failures.join("\n"));
  process.exit(1);
}
