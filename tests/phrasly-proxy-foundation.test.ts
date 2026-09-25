/**
 * Phase 1 Phrasly architecture boundary.
 * Run: bun tests/phrasly-proxy-foundation.test.ts
 */
import {
  blockLegacyPhraslyBrowserFlow,
  isPhraslyToolSlug,
  PHRASLY_PROXY_SETUP_MESSAGE,
} from "../src/lib/phrasly-proxy-policy.ts";

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string) {
  if (condition) passed++;
  else {
    failed++;
    console.error("  ✗", message);
  }
}

console.log("phrasly-proxy-foundation");

assert(isPhraslyToolSlug("phrasly"), "Phrasly slug is recognized");
assert(isPhraslyToolSlug(" PHRASLY "), "Phrasly slug matching is normalized");
assert(!isPhraslyToolSlug("stealthwriter"), "other tools are not classified as Phrasly");

let blockedMessage = "";
try {
  blockLegacyPhraslyBrowserFlow("phrasly");
} catch (error) {
  blockedMessage = error instanceof Error ? error.message : "";
}
assert(
  blockedMessage === PHRASLY_PROXY_SETUP_MESSAGE,
  "legacy Phrasly browser flows fail closed with the proxy setup message",
);

const launcher = await Bun.file("src/lib/tool-launcher.ts").text();
assert(
  launcher.includes("isPhraslyToolSlug(tool.slug)") &&
    !launcher.includes("PhraslyBrowserViewer") &&
    !launcher.includes("viewerStorageKey"),
  "customer launcher blocks Phrasly before the shared browser/viewer path",
);

const sessionOnly = await Bun.file("src/lib/session-only-access.functions.ts").text();
const sessionGuard = sessionOnly.indexOf("blockLegacyPhraslyBrowserFlow(data.tool_slug)");
const providerRead = sessionOnly.indexOf('from("browser_auth_settings")');
assert(
  sessionGuard >= 0 && providerRead >= 0 && sessionGuard < providerRead,
  "direct session-only calls block Phrasly before browser-provider resolution",
);

const adminAuth = await Bun.file("src/lib/admin-account-auth.functions.ts").text();
assert(
  (adminAuth.match(/blockLegacyPhraslyBrowserFlow\(/g) ?? []).length >= 4,
  "admin automatic, manual-start, and manual-complete browser paths all guard Phrasly",
);

const adminPage = await Bun.file("src/routes/admin.tools.$slug.tsx").text();
assert(
  adminPage.includes('auth_provider: slug === "phrasly" ? null') &&
    adminPage.includes("Phrasly no longer uses Browser Use or Cloudflare"),
  "Phrasly admin settings no longer expose or persist a browser provider",
);
assert(
  adminPage.includes('tabs[i].id === "accounts" || tabs[i].id === "credentials"'),
  "legacy Phrasly account-pool and credential tabs are removed from its admin surface",
);

const toolPage = await Bun.file("src/routes/tools.$slug.tsx").text();
assert(
  !toolPage.includes("PhraslyBrowserViewer") &&
    !toolPage.includes("parsePhraslyViewerLaunch") &&
    !toolPage.includes("viewerStorageKey"),
  "customer tool page no longer restores a Phrasly browser live-view session",
);

const viewer = await Bun.file("src/lib/browser-viewer.ts").text();
assert(
  !viewer.toLowerCase().includes("phrasly"),
  "shared browser-viewer utilities contain no Phrasly-specific state",
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
