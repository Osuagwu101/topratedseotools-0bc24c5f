/**
 * Phase 3 Phrasly proxy regression tests.
 * Run: bun tests/phrasly-proxy.test.ts
 */
import {
  applyPhraslyCookieRotations,
  buildPhraslyCookieHeader,
  buildPhraslyUpstreamUrl,
  extractPhraslyCookieRotations,
  phraslyAllowedAssetHosts,
  hashPhraslyProxyToken,
  isActivePhraslyGrant,
  isActivePhraslyOrder,
  phraslyProxySessionHours,
  rewritePhraslyBody,
  rewritePhraslyLocation,
} from "../src/lib/phrasly-proxy.server";

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
  authenticated_cookies: [
    {
      name: "session",
      value: "opaque-cookie",
      domain: ".phrasly.ai",
      path: "/",
      httpOnly: true,
      secure: true,
    },
    {
      name: "app_state",
      value: "opaque-app-state",
      domain: ".phrasly.ai",
      path: "/",
    },
    {
      name: "_fbp",
      value: "tracking-only",
      domain: ".phrasly.ai",
      path: "/",
    },
  ],
  session_tokens: {
    storage: {
      localStorage: { token: "vault-only-token" },
      sessionStorage: {},
    },
  },
});

const cookieHeader = buildPhraslyCookieHeader(sampleSession);
assert(
  cookieHeader === "session=opaque-cookie; app_state=opaque-app-state",
  "forwards reusable first-party Phrasly cookies with the session cookie first",
);
assert(
  !cookieHeader.includes("_fbp"),
  "does not forward unrelated first-party tracking cookies",
);
assert(
  !cookieHeader.includes("vault-only-token"),
  "does not copy browser-storage secrets into the Cookie header",
);

const rotations = extractPhraslyCookieRotations(
  [
    "session=rotated-session; Path=/; HttpOnly; Secure",
    "app_state=rotated-app-state; Path=/; Secure",
    "new_untrusted_cookie=ignore-me; Path=/",
  ],
  ["session", "app_state"],
);
assert(
  rotations.session === "rotated-session" &&
    rotations.app_state === "rotated-app-state" &&
    !("new_untrusted_cookie" in rotations),
  "captures rotations only for cookie names already approved in the encrypted vault",
);
const rotated = JSON.parse(
  applyPhraslyCookieRotations(sampleSession, [
    "session=rotated-session; Path=/; HttpOnly; Secure",
    "app_state=rotated-app-state; Path=/; Secure",
  ]).plaintext,
);
assert(
  rotated.authenticated_cookies.find((cookie: any) => cookie.name === "session")?.value ===
    "rotated-session" &&
    rotated.authenticated_cookies.find((cookie: any) => cookie.name === "app_state")?.value ===
      "rotated-app-state",
  "persists allowlisted Phrasly cookie rotation exactly like the StealthWriter vault",
);

const h1 = hashPhraslyProxyToken("ticket-a");
const h2 = hashPhraslyProxyToken("ticket-a");
const h3 = hashPhraslyProxyToken("ticket-b");
assert(h1 === h2, "proxy-token hashing is deterministic");
assert(h1 !== h3, "different proxy tokens hash differently");
assert(/^[0-9a-f]{64}$/.test(h1), "proxy-token hashes are SHA-256 hex");

const now = Date.now();
assert(
  isActivePhraslyOrder({
    status: "approved",
    payment_status: "successful",
    access_type: "shared",
    expires_at: new Date(now + 60_000).toISOString(),
  }, now),
  "recognises an active shared Phrasly order",
);
assert(
  !isActivePhraslyOrder({
    status: "approved",
    payment_status: "successful",
    access_type: "private",
    fulfilment_status: "pending",
    expires_at: new Date(now + 60_000).toISOString(),
  }, now),
  "keeps unfulfilled private Phrasly orders blocked",
);
assert(
  isActivePhraslyGrant({
    status: "active",
    expires_at: new Date(now + 60_000).toISOString(),
  }, now),
  "recognises an active admin grant",
);

const previousHours = process.env.PHRASLY_PROXY_SESSION_HOURS;
delete process.env.PHRASLY_PROXY_SESSION_HOURS;
assert(phraslyProxySessionHours() === 12, "defaults writer proxy sessions to 12 hours");
process.env.PHRASLY_PROXY_SESSION_HOURS = "24";
assert(phraslyProxySessionHours() === 24, "allows a 24-hour configured maximum");
process.env.PHRASLY_PROXY_SESSION_HOURS = "99";
assert(phraslyProxySessionHours() === 24, "caps proxy sessions at 24 hours");
if (previousHours === undefined) delete process.env.PHRASLY_PROXY_SESSION_HOURS;
else process.env.PHRASLY_PROXY_SESSION_HOURS = previousHours;

const html = `<html><head><title>Phrasly</title></head><body>
<a href="/dashboard">Dashboard</a>
<script src="/_next/app.js"></script>
<img src="https://phrasly.ai/logo.png">
<a href="https://example.com/help">External</a>
</body></html>`;
const rewrittenHtml = rewritePhraslyBody(html, "text/html; charset=utf-8");
assert(
  rewrittenHtml.includes('<base href="/api/phrasly-proxy/">'),
  "injects the Phrasly proxy base into HTML",
);
assert(
  rewrittenHtml.includes('src="/api/phrasly-proxy/_next/app.js"'),
  "rewrites root-relative app assets through the proxy",
);
assert(
  rewrittenHtml.includes('href="/api/phrasly-proxy/dashboard"'),
  "rewrites root-relative Phrasly navigation",
);
assert(
  rewrittenHtml.includes('/api/phrasly-proxy/logo.png'),
  "rewrites absolute phrasly.ai URLs",
);
assert(
  rewrittenHtml.includes('href="https://example.com/help"'),
  "does not rewrite unrelated external URLs",
);
assert(
  rewrittenHtml.includes('/api/phrasly-proxy-bootstrap'),
  "injects the browser network-rewrite bootstrap",
);

const css = 'body{background:url("/assets/bg.png")}';
assert(
  rewritePhraslyBody(css, "text/css")
    .includes('url("/api/phrasly-proxy/assets/bg.png")'),
  "rewrites root-relative CSS assets",
);

assert(
  rewritePhraslyLocation("/dashboard") === "/api/phrasly-proxy/dashboard",
  "rewrites same-site relative redirects",
);
assert(
  rewritePhraslyLocation("https://phrasly.ai/dashboard?x=1") ===
    "/api/phrasly-proxy/dashboard?x=1",
  "rewrites same-site absolute redirects",
);
assert(
  rewritePhraslyLocation("https://example.com/login") === null,
  "blocks proxy redirects to unrelated origins",
);

const previousAssetHosts = process.env.PHRASLY_ASSET_HOSTS;
process.env.PHRASLY_ASSET_HOSTS = "api.phrasly.ai,cdn.phrasly.ai,evil.example";
assert(
  phraslyAllowedAssetHosts().includes("api.phrasly.ai") &&
    phraslyAllowedAssetHosts().includes("cdn.phrasly.ai") &&
    !phraslyAllowedAssetHosts().includes("evil.example"),
  "allows only configured first-party Phrasly subdomains",
);
assert(
  rewritePhraslyLocation(
    "https://api.phrasly.ai/v1/status",
    "https://phrasly.ai",
  ) === "/api/phrasly-proxy/__host/api.phrasly.ai/v1/status",
  "routes configured first-party Phrasly subdomains through the fixed proxy",
);
if (previousAssetHosts === undefined) delete process.env.PHRASLY_ASSET_HOSTS;
else process.env.PHRASLY_ASSET_HOSTS = previousAssetHosts;

const pinned = buildPhraslyUpstreamUrl(
  "https://topratedseotools.com/api/phrasly-proxy//evil.example/path?x=1&ticket=secret",
  "//evil.example/path",
);
assert(
  pinned.origin === "https://phrasly.ai",
  "pins malformed double-slash paths to the phrasly.ai upstream origin",
);
assert(
  pinned.pathname === "//evil.example/path",
  "treats a double-slash target as a path rather than a new host",
);
assert(
  pinned.searchParams.get("x") === "1" && !pinned.searchParams.has("ticket"),
  "preserves normal query data but never forwards the launch ticket upstream",
);

const server = await Bun.file("src/server.ts").text();
assert(
  server.includes('url.pathname === "/api/phrasly-proxy"') &&
    server.includes('url.pathname.startsWith("/api/phrasly-proxy/")'),
  "server entry intercepts the Phrasly proxy path before TanStack routing",
);
assert(
  server.includes('url.pathname === "/api/phrasly-proxy-bootstrap"'),
  "server entry exposes the Phrasly proxy bootstrap",
);
assert(
  server.includes("isDedicatedPhraslyProxyRequest") &&
    server.includes("dedicatedPhraslyHost"),
  "server supports the same dedicated proxy-origin pattern as StealthWriter",
);

const launcher = await Bun.file("src/lib/tool-launcher.ts").text();
assert(
  launcher.includes("startPhraslyProxyLaunch") &&
    !launcher.includes("PHRASLY_PROXY_SETUP_MESSAGE"),
  "customer launcher uses the new Phrasly proxy instead of the Phase 1 setup block",
);

const proxySource = await Bun.file("src/lib/phrasly-proxy.server.ts").text();
assert(
  proxySource.includes('"upstream_401"') &&
    proxySource.includes('"upstream_403"') &&
    proxySource.includes('"upstream_403_edge_challenge"') &&
    proxySource.includes('"upstream_network_error"') &&
    proxySource.includes('"session_decrypt_failed"'),
  "records safe Phase 3 live diagnostic codes without exposing upstream secrets",
);
assert(
  !proxySource.includes("response_body") &&
    !proxySource.includes("cookie_value") &&
    !proxySource.includes("encrypted_payload:"),
  "Phrasly live diagnostics do not persist response bodies or secret values",
);
assert(
  proxySource.includes('"sec-fetch-dest"') &&
    proxySource.includes('"sec-fetch-mode"') &&
    proxySource.includes('"sec-fetch-site"') &&
    proxySource.includes('"upgrade-insecure-requests"') &&
    proxySource.includes("persistRotatedPhraslyCookies"),
  "Phrasly upstream requests mirror the working StealthWriter/AWS request shape and rotation model",
);
assert(
  launcher.includes('tool.slug === "phrasly"') &&
    launcher.includes('launchUrl.pathname === "/__trst/enter"'),
  "Phrasly client validates an optional trusted dedicated proxy origin",
);

const diagMigration = await Bun.file(
  "supabase/migrations/20260926023050_phrasly_proxy_diagnostics.sql",
).text();
assert(
  diagMigration.includes("last_error_code") &&
    diagMigration.includes("last_upstream_status") &&
    diagMigration.includes("diagnostic_updated_at"),
  "adds server-only safe diagnostic fields to Phrasly proxy sessions",
);

console.log(`phrasly-proxy: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
