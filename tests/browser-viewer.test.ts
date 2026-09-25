import {
  isAllowedBrowserUseLiveUrl,
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
  "official Browser Use live viewer URL is accepted for tools that still use it",
);
assert(
  !isAllowedBrowserUseLiveUrl("http://live.browser-use.com/?wss=x"),
  "insecure viewer URL is rejected",
);
assert(
  !isAllowedBrowserUseLiveUrl("https://live.browser-use.com.attacker.example/?wss=x"),
  "lookalike viewer host is rejected",
);

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
