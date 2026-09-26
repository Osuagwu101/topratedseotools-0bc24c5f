/**
 * ChatGPT Phase 4 hardening validation.
 * Run: bun tests/chatgpt-phase4-validation.test.ts
 */
import {
  chatGptLaunchesPerMinute,
  isBlockedChatGptDocumentPath,
  isChatGptDocumentRequest,
  isValidChatGptDeviceFingerprint,
} from "../src/lib/chatgpt-controls.server";

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

assert(
  isValidChatGptDeviceFingerprint("a".repeat(32)),
  "accepts a 32-character lowercase hex device fingerprint",
);
assert(
  !isValidChatGptDeviceFingerprint("A".repeat(32)) &&
    !isValidChatGptDeviceFingerprint("a".repeat(31)) &&
    !isValidChatGptDeviceFingerprint("z".repeat(32)),
  "rejects malformed ChatGPT device fingerprints",
);

for (const path of [
  "/account",
  "/account/security",
  "/billing",
  "/settings",
  "/settings/data-controls",
  "/subscription",
  "/admin",
  "/login",
  "/logout",
]) {
  assert(
    isBlockedChatGptDocumentPath(path),
    `blocks restricted ChatGPT document path ${path}`,
  );
}
for (const path of ["/", "/c/abc123", "/g/gpt-id", "/search"]) {
  assert(
    !isBlockedChatGptDocumentPath(path),
    `allows normal ChatGPT app document path ${path}`,
  );
}

assert(
  isChatGptDocumentRequest(
    new Request("https://example.test/", {
      headers: { "sec-fetch-dest": "document" },
    }),
  ),
  "recognises browser document navigation from sec-fetch-dest",
);
assert(
  isChatGptDocumentRequest(
    new Request("https://example.test/", {
      headers: { accept: "text/html,application/xhtml+xml" },
    }),
  ),
  "recognises HTML document requests from Accept",
);
assert(
  !isChatGptDocumentRequest(
    new Request("https://example.test/api", {
      headers: { accept: "application/json", "sec-fetch-dest": "empty" },
    }),
  ),
  "does not treat normal JSON API requests as document navigation",
);

const previousRate = process.env.CHATGPT_LAUNCHES_PER_MINUTE;
delete process.env.CHATGPT_LAUNCHES_PER_MINUTE;
assert(chatGptLaunchesPerMinute() === 8, "defaults launch rate limit to 8 per minute");
process.env.CHATGPT_LAUNCHES_PER_MINUTE = "1";
assert(chatGptLaunchesPerMinute() === 2, "keeps a minimum rate-limit floor of 2");
process.env.CHATGPT_LAUNCHES_PER_MINUTE = "99";
assert(chatGptLaunchesPerMinute() === 30, "caps configured launch rate at 30 per minute");
if (previousRate === undefined) delete process.env.CHATGPT_LAUNCHES_PER_MINUTE;
else process.env.CHATGPT_LAUNCHES_PER_MINUTE = previousRate;

const proxy = await Bun.file("src/lib/chatgpt-proxy.server.ts").text();
assert(
  proxy.includes("ensureChatGptUserControls") &&
    proxy.includes("assertChatGptLaunchRateLimit") &&
    proxy.includes("registerOrTouchChatGptDevice"),
  "proxy enforces ChatGPT status, launch-rate and device registration",
);
assert(
  proxy.includes("CHATGPT_DEVICE_COOKIE") &&
    proxy.includes("device_fingerprint") &&
    proxy.includes("registeredDevice"),
  "active proxy sessions are bound to a registered device",
);
assert(
  proxy.includes("isBlockedChatGptDocumentPath") &&
    proxy.includes("isChatGptDocumentRequest"),
  "proxy enforces document-level account/settings/billing restrictions",
);

const launcher = await Bun.file("src/lib/tool-launcher.ts").text();
assert(
  launcher.includes('fetch("/api/chatgpt-device"') &&
    launcher.includes("startChatGPTProxyLaunch"),
  "client prepares a stable ChatGPT device before launching",
);

const server = await Bun.file("src/server.ts").text();
assert(
  server.includes('url.pathname === "/api/chatgpt-device"') &&
    server.includes("ensureChatGptAppDeviceResponse"),
  "server exposes the ChatGPT device preparation endpoint",
);

const sessionFns = await Bun.file("src/lib/chatgpt-session.functions.ts").text();
assert(
  sessionFns.includes('.from("chatgpt_proxy_sessions")') &&
    sessionFns.includes('.in("status", ["issued", "active"])') &&
    sessionFns.includes("existing ChatGPT proxy sessions were revoked"),
  "master-session replacement/revocation invalidates writer proxy sessions",
);

const adminFns = await Bun.file("src/lib/chatgpt-controls.functions.ts").text();
assert(
  adminFns.includes("adminGetChatGptControls") &&
    adminFns.includes("adminUpdateChatGptControls") &&
    adminFns.includes("adminResetChatGptDevices"),
  "Admin has ChatGPT status/device management server functions",
);

const adminRoute = await Bun.file("src/routes/admin.customers.$userId.tsx").text();
assert(
  adminRoute.includes("function ChatGptControlsCard") &&
    adminRoute.includes("Save ChatGPT controls") &&
    adminRoute.includes("Reset devices & reactivate"),
  "customer Admin page exposes ChatGPT hardening controls",
);

const migration = await Bun.file(
  "supabase/migrations/20260926082000_chatgpt_phase4_controls.sql",
).text();
assert(
  migration.includes("chatgpt_user_controls") &&
    migration.includes("chatgpt_devices") &&
    migration.includes("device_fingerprint") &&
    migration.includes("enable row level security") &&
    migration.includes("revoke all") &&
    migration.includes("service_role"),
  "Phase 4 migration keeps ChatGPT controls/devices server-only",
);

console.log(`chatgpt-phase4-validation: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
