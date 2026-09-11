import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  launchSelfHostedSession,
  SelfHostedRuntimeError,
} from "../src/lib/self-hosted-runtime.server.ts";

let passed = 0;
let failed = 0;
function assert(condition: unknown, message: string) {
  if (condition) passed++;
  else {
    failed++;
    console.error("  ✗", message);
  }
}

console.log("phase15-provider-coexistence");
const root = new URL("../", import.meta.url);
const auth = readFileSync(new URL("src/lib/browser-auth.server.ts", root), "utf8");
const launch = readFileSync(new URL("src/lib/session-only-access.functions.ts", root), "utf8");
const runtime = readFileSync(new URL("src/lib/self-hosted-runtime.server.ts", root), "utf8");
const migration = readFileSync(
  new URL("supabase/migrations/20260910090000_add_self_hosted_browser_provider.sql", root),
  "utf8",
);

assert(
  auth.includes('"browser_use" | "cloudflare" | "self_hosted"'),
  "provider union includes all three providers",
);
assert(
  migration.includes("default_provider in ('browser_use', 'cloudflare', 'self_hosted')"),
  "database accepts Self Hosted while retaining Browser Use",
);
assert(
  !migration.includes("default 'self_hosted'"),
  "migration does not change the Browser Use default",
);
assert(
  launch.includes('if (provider !== "self_hosted")') &&
    launch.includes("launchSelfHostedSession"),
  "Self Hosted bypasses main-app saved-state mutation and uses its adapter",
);
assert(
  runtime.includes('createHmac("sha256"') &&
    runtime.includes('bodyHash = createHash("sha256")'),
  "runtime requests use the required HMAC-SHA256 contract",
);
assert(
  runtime.includes('body: JSON.stringify({') === false,
  "signing and transport reuse the exact same serialized body",
);
assert(
  runtime.includes('"SELF_HOSTED_RUNTIME_SERVICE_AUTH_SECRET"') &&
    !runtime.includes("178.238.232.63"),
  "runtime secret is configuration-only and infrastructure is not hardcoded",
);

const oldBase = process.env.SELF_HOSTED_RUNTIME_BASE_URL;
const oldSecret = process.env.SELF_HOSTED_RUNTIME_SERVICE_AUTH_SECRET;
const oldFetch = globalThis.fetch;
process.env.SELF_HOSTED_RUNTIME_BASE_URL = "https://runtime.example.test";
process.env.SELF_HOSTED_RUNTIME_SERVICE_AUTH_SECRET = "s".repeat(48);

let signedRequestVerified = false;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const headers = new Headers(init?.headers);
  const body = String(init?.body ?? "");
  const path = new URL(String(input)).pathname;
  const canonical = [
    String(init?.method),
    path,
    headers.get("X-Toprated-Timestamp"),
    headers.get("X-Toprated-Nonce"),
    headers.get("X-Toprated-Writer-Id"),
    createHash("sha256").update(body).digest("hex"),
  ].join("\n");
  signedRequestVerified =
    headers.get("X-Toprated-Signature") ===
    createHmac("sha256", "s".repeat(48)).update(canonical).digest("hex") &&
    body === JSON.stringify({ writer_id: "writer-15", tool_slug: "phrasly" });
  return new Response(
    JSON.stringify({
      status: "active",
      sessionId: "runtime-session-15",
      leaseExpiresAt: "2026-09-10T02:00:00Z",
      viewerGrant: { url: "https://runtime.example.test/viewer/worker#signed" },
    }),
    { status: 201, headers: { "content-type": "application/json" } },
  );
}) as typeof fetch;

const launched = await launchSelfHostedSession({}, {
  writerId: "writer-15",
  toolSlug: "phrasly",
});
assert(signedRequestVerified, "the exact transmitted launch body is covered by the HMAC");
assert(
  launched.provider === "self_hosted" && launched.providerSessionId === "runtime-session-15",
  "a valid runtime response becomes a Self Hosted launch",
);

globalThis.fetch = (async () =>
  new Response(
    JSON.stringify({ status: "error", code: "TOOL_REAUTH_REQUIRED" }),
    { status: 423, headers: { "content-type": "application/json" } },
  )) as typeof fetch;
let safeReauth = false;
try {
  await launchSelfHostedSession({}, { writerId: "writer-15", toolSlug: "phrasly" });
} catch (error) {
  safeReauth =
    error instanceof SelfHostedRuntimeError && error.requiresAdminReauthentication;
}
assert(safeReauth, "runtime reauthentication failures map to the admin-only state path");

globalThis.fetch = oldFetch;
if (oldBase === undefined) delete process.env.SELF_HOSTED_RUNTIME_BASE_URL;
else process.env.SELF_HOSTED_RUNTIME_BASE_URL = oldBase;
if (oldSecret === undefined) delete process.env.SELF_HOSTED_RUNTIME_SERVICE_AUTH_SECRET;
else process.env.SELF_HOSTED_RUNTIME_SERVICE_AUTH_SECRET = oldSecret;

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
