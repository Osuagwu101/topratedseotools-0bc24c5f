import {
  isAllowedBrowserUseLiveUrl,
  isAllowedSelfHostedViewerUrl,
  parsePhraslyViewerLaunch,
  resolveBrowserViewport,
} from "../src/lib/browser-viewer.ts";

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string) {
  if (condition) passed++;
  else {
    failed++;
    console.error("  ✗", message);
  }
}

console.log("browser-viewer");

const phone = resolveBrowserViewport(393, 873);
assert(
  phone.width === 393 && phone.height === 809,
  "phone viewport stays readable and uses available height",
);
assert(
  isAllowedSelfHostedViewerUrl(
    "https://runtime.example.com/viewer/session-1#signed-viewer-token",
  ),
  "Self Hosted signed viewer URL is accepted",
);
assert(
  !isAllowedSelfHostedViewerUrl("https://runtime.example.com/not-viewer#token") &&
    !isAllowedSelfHostedViewerUrl("http://runtime.example.com/viewer/session#token"),
  "Self Hosted viewer requires HTTPS, viewer path, and fragment grant",
);

const smallPhone = resolveBrowserViewport(280, 500);
assert(
  smallPhone.width === 320 && smallPhone.height === 568,
  "provider minimums bound small phone dimensions",
);

const desktop = resolveBrowserViewport(1920, 1080);
assert(
  desktop.width === 1600 && desktop.height === 1000,
  "desktop viewport is bounded to supported UX limits",
);

assert(
  isAllowedBrowserUseLiveUrl(
    "https://live.browser-use.com/?wss=https%3A%2F%2Fsession.cdp.browser-use.com",
  ),
  "official Browser Use live viewer URL is accepted",
);
assert(
  !isAllowedBrowserUseLiveUrl("http://live.browser-use.com/?wss=x"),
  "insecure viewer URL is rejected",
);
assert(
  !isAllowedBrowserUseLiveUrl("https://live.browser-use.com.attacker.example/?wss=x"),
  "lookalike viewer host is rejected",
);

const now = Date.now();
const valid = JSON.stringify({
  toolSlug: "phrasly",
  provider: "browser_use",
  liveUrl: "https://live.browser-use.com/?wss=https%3A%2F%2Fsession.cdp.browser-use.com",
  expiresAt: new Date(now + 60_000).toISOString(),
});
assert(
  parsePhraslyViewerLaunch(valid, now)?.toolSlug === "phrasly",
  "valid active Phrasly launch is restored",
);
assert(
  parsePhraslyViewerLaunch(valid, now + 60_001) === null,
  "expired Phrasly launch is rejected",
);
assert(parsePhraslyViewerLaunch("not-json", now) === null, "malformed viewer state is rejected");

const selfHosted = JSON.stringify({
  toolSlug: "phrasly",
  provider: "self_hosted",
  liveUrl: "https://runtime.example.com/viewer/session-1#signed-viewer-token",
  expiresAt: new Date(now + 60_000).toISOString(),
  auditSessionId: "00000000-0000-4000-8000-000000000015",
});
assert(
  parsePhraslyViewerLaunch(selfHosted, now)?.provider === "self_hosted",
  "valid Self Hosted launch is restored without changing Browser Use parsing",
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
