/**
 * ChatGPT Phase 1 -> Phase 4 end-to-end source conformance audit.
 * Run: bun tests/chatgpt-phase1-4-conformance.test.ts
 */
import { readFileSync } from "node:fs";

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

const phase1 = readFileSync("docs/audits/phase1-chatgpt-blueprint.md", "utf8");
const vaultServer = readFileSync("src/lib/chatgpt-session.server.ts", "utf8");
const vaultFns = readFileSync("src/lib/chatgpt-session.functions.ts", "utf8");
const proxy = readFileSync("src/lib/chatgpt-proxy.server.ts", "utf8");
const proxyFns = readFileSync("src/lib/chatgpt-proxy.functions.ts", "utf8");
const controls = readFileSync("src/lib/chatgpt-controls.server.ts", "utf8");
const controlsFns = readFileSync("src/lib/chatgpt-controls.functions.ts", "utf8");
const launcher = readFileSync("src/lib/tool-launcher.ts", "utf8");
const server = readFileSync("src/server.ts", "utf8");
const adminTool = readFileSync("src/routes/admin.tools.$slug.tsx", "utf8");
const adminCustomer = readFileSync("src/routes/admin.customers.$userId.tsx", "utf8");
const phase2Migration = readFileSync(
  "supabase/migrations/20260926045500_chatgpt_session_vault.sql",
  "utf8",
);
const phase3Migration = readFileSync(
  "supabase/migrations/20260926062000_chatgpt_proxy_sessions.sql",
  "utf8",
);
const phase4Migration = readFileSync(
  "supabase/migrations/20260926082000_chatgpt_phase4_controls.sql",
  "utf8",
);

assert(
  phase1.includes("Recovered AWS blueprint") &&
    phase1.includes("short-lived") &&
    phase1.includes("server-side"),
  "Phase 1 records the recovered AWS access/handoff blueprint",
);

assert(
  vaultServer.includes("aes-256-gcm") &&
    vaultServer.includes("chatgpt.com") &&
    vaultServer.includes("openai.com") &&
    vaultServer.includes("cf_clearance"),
  "Phase 2 validates first-party state, encrypts with AES-256-GCM and excludes challenge cookies",
);
assert(
  vaultFns.includes("adminSaveChatGptSession") &&
    vaultFns.includes("adminRevokeChatGptSession") &&
    !vaultFns.includes("decryptChatGptSession"),
  "Phase 2 Admin API is metadata/write-only and never returns decrypted state",
);
assert(
  adminTool.includes("ChatGPT authorised session") &&
    adminTool.includes("admin-chatgpt-authorized-session"),
  "Phase 2 Admin UI exposes the dedicated authorised-session vault",
);
assert(
  phase2Migration.includes("'chatgpt'"),
  "Phase 2 vault constraint explicitly supports ChatGPT",
);

assert(
  proxyFns.includes("startChatGPTProxyLaunch") &&
    proxy.includes("CHATGPT_HANDOFF_TTL_SECONDS = 60") &&
    proxy.includes("hashChatGPTProxyToken") &&
    proxy.includes('status: "issued"') &&
    proxy.includes('status: "active"'),
  "Phase 3 implements a hashed 60-second handoff and separate active proxy session",
);
assert(
  proxy.includes('CHATGPT_UPSTREAM_ORIGIN = "https://chatgpt.com"') &&
    proxy.includes("chatgptAllowedAssetHosts") &&
    proxy.includes("upstream_external_redirect"),
  "Phase 3 pins the upstream and rejects unrelated redirects",
);
assert(
  proxy.includes("text/event-stream") &&
    proxy.includes("new Response(upstream.body"),
  "Phase 3 preserves ChatGPT streaming responses",
);
assert(
  proxy.includes('"upstream_403_edge_challenge"') &&
    !proxy.includes("cf_clearance="),
  "Phase 3 classifies edge challenges without challenge-cookie bypass logic",
);
assert(
  phase3Migration.includes("chatgpt_proxy_sessions") &&
    phase3Migration.includes("revoke all") &&
    phase3Migration.includes("service_role"),
  "Phase 3 proxy sessions are server-only",
);
assert(
  launcher.includes('tool.slug === "chatgpt"') &&
    launcher.includes("startChatGPTProxyLaunch") &&
    !launcher.includes("ChatGPT secure launch is not enabled yet"),
  "Phase 3 client uses the dedicated ChatGPT proxy instead of legacy Browser Use",
);
assert(
  server.includes('url.pathname === "/api/chatgpt-proxy"') &&
    server.includes("handleChatGPTProxyRequest"),
  "Phase 3 proxy is intercepted at the server entrypoint",
);

assert(
  controls.includes("CHATGPT_DEFAULT_DEVICE_LIMIT") &&
    controls.includes("assertChatGptLaunchRateLimit") &&
    controls.includes("isBlockedChatGptDocumentPath"),
  "Phase 4 adds device, rate-limit and navigation policy",
);
assert(
  proxy.includes("CHATGPT_DEVICE_COOKIE") &&
    proxy.includes("registeredDevice") &&
    proxy.includes("isBlockedChatGptDocumentPath"),
  "Phase 4 is enforced inside the live proxy request path",
);
assert(
  vaultFns.includes("existing ChatGPT proxy sessions were revoked"),
  "Phase 4 invalidates proxy sessions when Admin rotates/revokes the upstream session",
);
assert(
  controlsFns.includes("adminResetChatGptDevices") &&
    adminCustomer.includes("ChatGptControlsCard"),
  "Phase 4 exposes Admin controls for device reset and ChatGPT-only suspension",
);
assert(
  phase4Migration.includes("chatgpt_user_controls") &&
    phase4Migration.includes("chatgpt_devices") &&
    phase4Migration.includes("device_fingerprint"),
  "Phase 4 persists isolated ChatGPT controls and device bindings",
);

assert(
  !proxy.includes("browser_use") &&
    !proxy.includes("cloudflare-browser") &&
    !proxy.includes("self-hosted"),
  "ChatGPT proxy path contains no Browser Use, Cloudflare Browser Run, or retired runtime fallback",
);

console.log(`chatgpt-phase1-4-conformance: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
