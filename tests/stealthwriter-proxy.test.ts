/**
 * Phase 3 StealthWriter proxy regression tests.
 * Run: bun tests/stealthwriter-proxy.test.ts
 */
import {
  buildStealthWriterCookieHeader,
  hashStealthWriterProxyToken,
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
