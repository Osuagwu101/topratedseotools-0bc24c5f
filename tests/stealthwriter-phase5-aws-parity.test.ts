/**
 * Phase 5.1 — AWS parity validation.
 *
 * Protects the behaviors recovered from:
 * - top-rated AWS oneclick gate/limits/proxy/ui/widget source
 * - customer/admin StealthWriter reference video
 *
 * Run: bun tests/stealthwriter-phase5-aws-parity.test.ts
 */
import { readFileSync } from "node:fs";
import {
  featureForStealthWriterUsagePath,
  grantedStealthWriterFeatures,
  isAllowedStealthWriterDocumentPath,
  isFreeStealthWriterRehumanize,
  isValidStealthWriterDeviceFingerprint,
  pathMatchesStealthWriterRule,
  pickStealthWriterLandingPath,
  secondsUntilNextLagosMidnight,
  stealthWriterAllowedAssetHosts,
  stealthWriterFeatureDocumentPaths,
  STEALTHWRITER_DEFAULT_DAILY_LIMIT,
  STEALTHWRITER_DEFAULT_DEVICE_LIMIT,
  type StealthWriterUserControls,
} from "../src/lib/stealthwriter-controls.server";

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

const base: StealthWriterUserControls = {
  user_id: "00000000-0000-0000-0000-000000000001",
  status: "active",
  device_limit: 2,
  humanizer_enabled: true,
  humanizer_daily_limit: 20,
  ai_detector_enabled: true,
  ai_detector_daily_limit: 20,
  suspended_reason: null,
  suspended_at: null,
};

// Separate Humanizer / AI Detector access.
assert(
  grantedStealthWriterFeatures(base).join(",") === "humanizer,ai_detector",
  "one StealthWriter purchase enables both Humanizer and AI Detector by default",
);
const humanizerOnly = { ...base, ai_detector_enabled: false };
assert(
  grantedStealthWriterFeatures(humanizerOnly).join(",") === "humanizer",
  "Humanizer-only customer does not inherit AI Detector access",
);
const detectorOnly = { ...base, humanizer_enabled: false };
assert(
  grantedStealthWriterFeatures(detectorOnly).join(",") === "ai_detector",
  "AI-Detector-only customer does not inherit Humanizer access",
);
assert(
  grantedStealthWriterFeatures({ ...base, status: "suspended" }).length === 0,
  "suspended customer has no usable StealthWriter feature",
);

// AWS allowed-path semantics: trailing $ = exact, otherwise prefix.
assert(
  pathMatchesStealthWriterRule("/dashboard", "/dashboard$"),
  "exact common dashboard path is allowed",
);
assert(
  !pathMatchesStealthWriterRule("/dashboard/billing", "/dashboard$"),
  "exact common dashboard rule does not open nested account pages",
);
assert(
  pathMatchesStealthWriterRule(
    "/dashboard/humanizer/history",
    "/dashboard/humanizer",
  ),
  "feature path uses AWS prefix matching",
);
assert(
  isAllowedStealthWriterDocumentPath(
    "/dashboard/humanizer",
    ["humanizer"],
  ),
  "Humanizer customer can open Humanizer",
);
assert(
  !isAllowedStealthWriterDocumentPath(
    "/dashboard/ai-detector",
    ["humanizer"],
  ),
  "Humanizer-only customer cannot open AI Detector",
);
assert(
  isAllowedStealthWriterDocumentPath(
    "/dashboard/ai-detector",
    ["ai_detector"],
  ),
  "AI Detector customer can open AI Detector",
);
assert(
  pickStealthWriterLandingPath(["humanizer"]) === "/dashboard/humanizer",
  "Humanizer customer lands on Humanizer",
);
assert(
  pickStealthWriterLandingPath(["ai_detector"]) === "/dashboard/ai-detector",
  "AI-Detector-only customer lands on AI Detector",
);

// Separate usage endpoints / limits.
assert(
  STEALTHWRITER_DEFAULT_DAILY_LIMIT === 20,
  "AWS parity default is 20 uses per feature per day",
);
assert(
  STEALTHWRITER_DEFAULT_DEVICE_LIMIT === 2,
  "AWS signup policy default is two devices",
);
assert(
  featureForStealthWriterUsagePath("/api/humanize") === "humanizer",
  "Humanize API counts only against Humanizer",
);
assert(
  featureForStealthWriterUsagePath("/api/scan") === "ai_detector",
  "live StealthWriter scan API counts against AI Detector",
);
assert(
  featureForStealthWriterUsagePath("/api/detect") === "ai_detector",
  "legacy AWS detect API alias also counts against AI Detector",
);

// Rehumanize one-shot exemption.
const freeRequest = new Request("https://example.test/api/humanize", {
  method: "POST",
  headers: { "X-OC-Free-Rehumanize": "1" },
});
assert(
  isFreeStealthWriterRehumanize("humanizer", freeRequest),
  "Rehumanize marker makes the Humanizer repeat free",
);
assert(
  !isFreeStealthWriterRehumanize("ai_detector", freeRequest),
  "Rehumanize marker can never make an AI Detector scan free",
);

// Device identity format and Nigeria-midnight reset.
assert(
  isValidStealthWriterDeviceFingerprint("a".repeat(32)),
  "32-character hex browser device id is accepted",
);
assert(
  !isValidStealthWriterDeviceFingerprint("not-a-device"),
  "malformed device id is rejected",
);
const seconds = secondsUntilNextLagosMidnight(
  new Date("2026-09-24T22:00:00.000Z"), // 23:00 WAT
);
assert(
  seconds === 3600,
  "daily counters reset at midnight Africa/Lagos",
);

// Technical feature paths remain configurable without customer control.
const oldHumanizer = process.env.STEALTHWRITER_HUMANIZER_PATHS;
process.env.STEALTHWRITER_HUMANIZER_PATHS =
  "/dashboard/humanizer,/dashboard/humanizer-v2";
assert(
  stealthWriterFeatureDocumentPaths().humanizer.includes(
    "/dashboard/humanizer-v2",
  ),
  "technical Humanizer path allow-list can be extended server-side",
);
if (oldHumanizer === undefined) delete process.env.STEALTHWRITER_HUMANIZER_PATHS;
else process.env.STEALTHWRITER_HUMANIZER_PATHS = oldHumanizer;

// Secondary upstream hosts are first-party allow-listed only.
const oldAssetHosts = process.env.STEALTHWRITER_ASSET_HOSTS;
process.env.STEALTHWRITER_ASSET_HOSTS =
  "api.stealthwriter.ai,evil.example";
const hosts = stealthWriterAllowedAssetHosts();
assert(
  hosts.includes("api.stealthwriter.ai"),
  "first-party StealthWriter asset/API host can be allow-listed",
);
assert(
  !hosts.includes("evil.example"),
  "arbitrary external host cannot turn proxy into an open proxy",
);
if (oldAssetHosts === undefined) delete process.env.STEALTHWRITER_ASSET_HOSTS;
else process.env.STEALTHWRITER_ASSET_HOSTS = oldAssetHosts;

// Source conformance: migration + runtime + client widget + admin controls.
const migration = readFileSync(
  "supabase/migrations/20260925031018_stealthwriter_aws_parity.sql",
  "utf8",
);
const proxy = readFileSync(
  "src/lib/stealthwriter-proxy.server.ts",
  "utf8",
);
const bootstrap = readFileSync(
  "src/lib/stealthwriter-proxy-bootstrap.server.ts",
  "utf8",
);
const adminFns = readFileSync(
  "src/lib/stealthwriter-controls.functions.ts",
  "utf8",
);
const customerDashboard = readFileSync(
  "src/routes/_authenticated.dashboard.tsx",
  "utf8",
);
const proxyFunctions = readFileSync(
  "src/lib/stealthwriter-proxy.functions.ts",
  "utf8",
);
const launcher = readFileSync(
  "src/lib/tool-launcher.ts",
  "utf8",
);
const serverEntry = readFileSync(
  "src/server.ts",
  "utf8",
);
const authMiddleware = readFileSync(
  "src/integrations/supabase/auth-middleware.ts",
  "utf8",
);
const authenticatedRoute = readFileSync(
  "src/routes/_authenticated.tsx",
  "utf8",
);
const loginRoute = readFileSync(
  "src/routes/login.tsx",
  "utf8",
);
const customerAdmin = readFileSync(
  "src/routes/admin.customers.$userId.tsx",
  "utf8",
);

for (const table of [
  "stealthwriter_user_controls",
  "stealthwriter_devices",
  "stealthwriter_daily_usage",
]) {
  assert(
    migration.includes(`create table if not exists public.${table}`),
    `migration creates ${table}`,
  );
}
assert(
  migration.includes("timezone('Africa/Lagos', now())") &&
    migration.includes("consume_stealthwriter_usage"),
  "database atomically consumes per-feature usage in the WAT day bucket",
);
assert(
  migration.includes("humanizer_daily_limit integer not null default 20") &&
    migration.includes("ai_detector_daily_limit integer not null default 20"),
  "database stores independent 20/day defaults",
);
assert(
  migration.includes("device_limit integer not null default 2") &&
    migration.includes("device_fingerprint"),
  "database stores device policy and binds proxy sessions to a device",
);
assert(
  migration.includes("alter table public.profiles") &&
    migration.includes("account_status text not null default 'active'") &&
    migration.includes("suspension_reason"),
  "migration adds platform-wide customer account suspension state",
);
assert(
  migration.includes("revoke all on table public.stealthwriter_user_controls from anon, authenticated") &&
    migration.includes("revoke all on table public.stealthwriter_devices from anon, authenticated") &&
    migration.includes("revoke all on table public.stealthwriter_daily_usage from anon, authenticated"),
  "AWS parity control tables remain server-only",
);

assert(
  proxy.includes("registerOrTouchStealthWriterDevice") &&
    proxy.includes("device_fingerprint: deviceFingerprint"),
  "handoff enforces and binds the persistent device",
);
assert(
  proxy.includes('suffix === "/__trst/usage"') &&
    proxy.includes("getStealthWriterUsageSnapshot"),
  "proxy exposes only the customer's own usage snapshot to the injected widget",
);
assert(
  proxy.includes('request.headers.get("sec-fetch-dest") === "document"') &&
    proxy.includes("isAllowedStealthWriterDocumentPath"),
  "server performs AWS-style default-deny document navigation",
);
assert(
  proxy.includes("consumeStealthWriterUsage") &&
    proxy.includes("isFreeStealthWriterRehumanize"),
  "proxy enforces separate daily usage with Rehumanize exemption",
);
assert(
  proxy.includes('/__host/') &&
    proxy.includes("stealthWriterAllowedAssetHosts"),
  "proxy supports fixed allow-listed secondary StealthWriter hosts",
);

assert(
  bootstrap.includes("Rehumanize") &&
    bootstrap.includes("X-OC-Free-Rehumanize"),
  "client marks only the next Rehumanize API call as free",
);
assert(
  bootstrap.includes("trst-sw-usage") &&
    bootstrap.includes('setInterval(refreshPolicy, 30000)'),
  "AWS-style usage widget is injected and refreshed",
);
assert(
  proxy.includes('headers.set("X-TRST-Daily-Limit", "1")') &&
    proxy.includes("Daily limit reached. Please try again after reset."),
  "daily-limit responses are explicitly marked for the injected client",
);
assert(
  bootstrap.includes("Daily limit reached. Please try again after reset.") &&
    bootstrap.includes("hideGenericQuotaErrorToasts") &&
    bootstrap.includes('getResponseHeader("X-TRST-Daily-Limit")'),
  "daily-limit UI replaces generic StealthWriter connection errors with a clear message",
);
assert(
  bootstrap.includes("data-trst-sw-blocked") &&
    bootstrap.includes("isAllowedNavigation"),
  "SPA navigation is restricted to customer's granted feature paths",
);

assert(
  adminFns.includes("adminUpdateStealthWriterControls") &&
    adminFns.includes("adminResetStealthWriterDevices"),
  "admin can change feature limits/access and reset devices",
);
assert(
  adminFns.includes("reactivateTopRatedAccount") &&
    adminFns.includes("full TopRatedSEOTools account reactivated"),
  "device reset reactivates the full customer account",
);
assert(
  authMiddleware.includes("account_status") &&
    authMiddleware.includes("Unauthorized: Account suspended"),
  "shared authenticated middleware blocks suspended customers site-wide",
);
assert(
  authenticatedRoute.includes('account_status === "suspended"') &&
    authenticatedRoute.includes("supabase.auth.signOut()"),
  "already signed-in suspended customers are removed from authenticated routes",
);
assert(
  loginRoute.includes('account_status === "suspended"') &&
    loginRoute.includes("Account Banned for using multiple devices") &&
    loginRoute.includes("text-red-700") &&
    loginRoute.includes("setAccountBanned(true)"),
  "password login shows the device-ban message prominently above the login brand",
);
assert(
  readFileSync("src/lib/stealthwriter-controls.server.ts", "utf8").includes(
    "suspendTopRatedAccountForDeviceLimit",
  ) &&
    readFileSync("src/lib/stealthwriter-controls.server.ts", "utf8").includes(
      'ban_duration: "876000h"',
    ),
  "device overflow suspends the platform account and bans future auth sessions",
);
assert(
  customerAdmin.includes("StealthWriter AWS controls") &&
    customerAdmin.includes("Humanizer daily limit") &&
    customerAdmin.includes("AI Detector daily limit"),
  "customer admin page exposes the AWS parity controls",
);

// Customer-video parity: dashboard counters, direct launch and self-service devices.
assert(
  customerDashboard.includes("Access Stealth Writer") &&
    customerDashboard.includes("AI Detector:") &&
    customerDashboard.includes("Humanizer:"),
  "customer dashboard shows both daily counters and a direct Access Stealth Writer button",
);
assert(
  customerDashboard.includes("Devices (") &&
    customerDashboard.includes("Remove a device you no longer use to free up a slot.") &&
    customerDashboard.includes("removeMyStealthWriterDevice"),
  "customer dashboard shows device capacity and self-service removal like the AWS site",
);
assert(
  adminFns.includes("getMyStealthWriterExperience") &&
    adminFns.includes("removeMyStealthWriterDevice") &&
    adminFns.includes("device_fingerprint"),
  "customer dashboard APIs expose usage/devices without exposing fingerprints and revoke removed-device sessions",
);

// The video overlay has a close control and can be restored after collapse.
assert(
  bootstrap.includes('id = "trst-sw-usage-pill"') &&
    bootstrap.includes('localStorage.setItem("trst_sw_usage_collapsed", "1")') &&
    bootstrap.includes('close.textContent = "×"'),
  "StealthWriter usage overlay matches the AWS collapsible widget experience",
);

// Clean dedicated sw.* proxy origin, with same-origin fallback retained.
assert(
  proxy.includes("STEALTHWRITER_PROXY_PUBLIC_ORIGIN") &&
    proxy.includes("/__trst/enter?ticket=") &&
    proxy.includes("proxyBaseForRequest"),
  "proxy can launch on an AWS-style dedicated StealthWriter subdomain",
);
assert(
  serverEntry.includes("isDedicatedStealthWriterProxyRequest") &&
    serverEntry.includes("dedicatedStealthWriterHost"),
  "server routes every request on the configured dedicated StealthWriter origin through the proxy",
);
assert(
  proxyFunctions.includes("proxy_origin: launch.proxyPublicOrigin") &&
    launcher.includes("trustedProxyOrigin") &&
    launcher.includes('launchUrl.pathname === "/__trst/enter"'),
  "client accepts only the exact trusted dedicated proxy origin returned by the server",
);
assert(
  proxy.includes("STEALTHWRITER_APP_DEVICE_COOKIE") &&
    proxy.includes("ensureStealthWriterAppDeviceResponse") &&
    proxy.includes("device_fingerprint: isValidStealthWriterDeviceFingerprint(appDeviceFingerprint)"),
  "main-site device identity is persisted and embedded into the 60-second handoff row",
);
assert(
  proxyFunctions.includes("getRequest") &&
    proxyFunctions.includes("readStealthWriterAppDeviceFingerprint") &&
    launcher.includes('fetch("/api/stealthwriter-device"') &&
    serverEntry.includes('url.pathname === "/api/stealthwriter-device"'),
  "customer device is created on TopRatedSEOTools before the StealthWriter launch, matching AWS access.php",
);
assert(
  proxy.includes('"Device"') &&
    !proxy.includes('request.headers.get("user-agent") ?? "Device"'),
  "new customer devices use the same neutral Device label shown in the AWS dashboard/video",
);

console.log(
  `stealthwriter-phase5-aws-parity: ${passed} passed, ${failed} failed`,
);
if (failed > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
