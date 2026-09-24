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
  "active default customer owns Humanizer and AI Detector independently",
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
  "AWS scan API counts only against AI Detector",
);
assert(
  featureForStealthWriterUsagePath("/api/detect") === "ai_detector",
  "AWS detect API alias also counts against AI Detector",
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
  "supabase/migrations/20260924223000_stealthwriter_aws_parity.sql",
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
  customerAdmin.includes("StealthWriter AWS controls") &&
    customerAdmin.includes("Humanizer daily limit") &&
    customerAdmin.includes("AI Detector daily limit"),
  "customer admin page exposes the AWS parity controls",
);

console.log(
  `stealthwriter-phase5-aws-parity: ${passed} passed, ${failed} failed`,
);
if (failed > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
