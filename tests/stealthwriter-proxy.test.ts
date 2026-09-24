/**
 * Phase 3 StealthWriter proxy regression tests.
 * Run: bun tests/stealthwriter-proxy.test.ts
 */
import {
  buildStealthWriterCookieHeader,
  hashStealthWriterProxyToken,
  isBlockedStealthWriterPath,
  proxySessionDays,
  rewriteStealthWriterBody,
  rewriteStealthWriterLocation,
} from "../src/lib/stealthwriter-proxy.server";

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

const sampleSession = JSON.stringify({
  "__Secure-better-auth.session_token": "opaque-token-value",
  "__Secure-better-auth.session_data": "opaque-data-value",
});

const cookieHeader = buildStealthWriterCookieHeader(sampleSession);
assert(
  cookieHeader.includes("__Secure-better-auth.session_token=opaque-token-value"),
  "builds the upstream session-token cookie",
);
assert(
  cookieHeader.includes("__Secure-better-auth.session_data=opaque-data-value"),
  "builds the upstream session-data cookie",
);
assert(
  !cookieHeader.includes("Path=") && !cookieHeader.includes("HttpOnly"),
  "forwards cookie values only, not browser cookie attributes",
);

const h1 = hashStealthWriterProxyToken("ticket-a");
const h2 = hashStealthWriterProxyToken("ticket-a");
const h3 = hashStealthWriterProxyToken("ticket-b");
assert(h1 === h2, "proxy-token hashing is deterministic");
assert(h1 !== h3, "different proxy tokens hash differently");
assert(/^[0-9a-f]{64}$/.test(h1), "proxy-token hashes are SHA-256 hex");


const previousDays = process.env.STEALTHWRITER_PROXY_SESSION_DAYS;
delete process.env.STEALTHWRITER_PROXY_SESSION_DAYS;
assert(proxySessionDays() === 30, "defaults the customer proxy session to 30 days");
process.env.STEALTHWRITER_PROXY_SESSION_DAYS = "7";
assert(proxySessionDays() === 7, "supports the observed 7-day minimum window");
process.env.STEALTHWRITER_PROXY_SESSION_DAYS = "20";
assert(proxySessionDays() === 20, "supports a 20-day configured proxy session");
process.env.STEALTHWRITER_PROXY_SESSION_DAYS = "99";
assert(proxySessionDays() === 30, "caps proxy sessions at 30 days");
if (previousDays === undefined) delete process.env.STEALTHWRITER_PROXY_SESSION_DAYS;
else process.env.STEALTHWRITER_PROXY_SESSION_DAYS = previousDays;

assert(isBlockedStealthWriterPath("/logout"), "blocks upstream logout");
assert(isBlockedStealthWriterPath("/billing/invoices"), "blocks upstream billing");
assert(isBlockedStealthWriterPath("/settings/account"), "blocks upstream account settings");
assert(!isBlockedStealthWriterPath("/dashboard/humanizer"), "allows the Humanizer workspace");
assert(!isBlockedStealthWriterPath("/dashboard/ai-detector"), "allows the AI Detector workspace");

const html = `<html><head><title>x</title></head><body>
<a href="/dashboard/humanizer">go</a>
<script src="/_next/app.js"></script>
<img src="https://stealthwriter.ai/logo.png">
<a href="https://example.com/help">external</a>
</body></html>`;
const rewrittenHtml = rewriteStealthWriterBody(html, "text/html; charset=utf-8");
assert(
  rewrittenHtml.includes('<base href="/api/stealthwriter-proxy/">'),
  "injects the proxy base into HTML",
);
assert(
  rewrittenHtml.includes('src="/api/stealthwriter-proxy/_next/app.js"'),
  "rewrites root-relative application assets through the proxy",
);
assert(
  rewrittenHtml.includes('href="/api/stealthwriter-proxy/dashboard/humanizer"'),
  "rewrites root-relative navigation through the proxy",
);
assert(
  rewrittenHtml.includes('/api/stealthwriter-proxy/logo.png'),
  "rewrites absolute StealthWriter URLs through the proxy",
);
assert(
  rewrittenHtml.includes('href="https://example.com/help"'),
  "does not rewrite unrelated external hosts",
);
assert(
  rewrittenHtml.includes('/api/stealthwriter-proxy-bootstrap'),
  "injects the customer-side network rewrite bootstrap",
);

const css = 'body{background:url("/assets/bg.png")}';
const rewrittenCss = rewriteStealthWriterBody(css, "text/css");
assert(
  rewrittenCss.includes('url("/api/stealthwriter-proxy/assets/bg.png")'),
  "rewrites root-relative CSS assets through the proxy",
);

assert(
  rewriteStealthWriterLocation("/dashboard/humanizer") ===
    "/api/stealthwriter-proxy/dashboard/humanizer",
  "rewrites same-site relative redirects",
);
assert(
  rewriteStealthWriterLocation("https://stealthwriter.ai/dashboard/humanizer?x=1") ===
    "/api/stealthwriter-proxy/dashboard/humanizer?x=1",
  "rewrites same-site absolute redirects",
);
assert(
  rewriteStealthWriterLocation("https://evil.example/login") === null,
  "blocks redirects to unrelated hosts",
);

console.log(`stealthwriter-proxy: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
