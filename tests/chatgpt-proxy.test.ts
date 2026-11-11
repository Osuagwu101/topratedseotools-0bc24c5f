/**
 * Phase 3 ChatGPT proxy regression tests.
 * Run: bun tests/chatgpt-proxy.test.ts
 */
import { readFileSync } from "node:fs";
import {
  applyChatGPTCookieRotations,
  buildChatGPTCookieHeader,
  buildChatGPTUpstreamUrl,
  chatgptAllowedAssetHosts,
  chatgptProxySessionHours,
  hashChatGPTProxyToken,
  isActiveChatGPTGrant,
  isActiveChatGPTOrder,
  isForwardedChatGPTClientHeader,
  isChatGPTUserContentHost,
  isImmutableChatGPTAssetPath,
  mapChatGPTClientApiPath,
  upstreamHeaders,
  rewriteChatGPTBody,
  rewriteChatGPTLocation,
} from "../src/lib/chatgpt-proxy.server";

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
  version: 2,
  cookies: [
    {
      name: "__Secure-chat-session",
      value: "opaque-chat-session",
      domain: ".chatgpt.com",
      path: "/",
      httpOnly: true,
      secure: true,
    },
    {
      name: "app_state",
      value: "opaque-app-state",
      domain: ".chatgpt.com",
      path: "/",
    },
    {
      name: "session_state",
      value: "opaque-session-state",
      domain: ".chatgpt.com",
      path: "/",
    },
    {
      name: "_ga",
      value: "tracking-only",
      domain: ".chatgpt.com",
      path: "/",
    },
    {
      name: "cf_clearance",
      value: "challenge-only",
      domain: ".chatgpt.com",
      path: "/",
    },
  ],
  session_tokens: {
    storage: {
      localStorage: { opaque: "vault-only-storage" },
      sessionStorage: {},
    },
  },
});

const cookieHeader = buildChatGPTCookieHeader(sampleSession);
assert(
  cookieHeader.includes("__Secure-chat-session=opaque-chat-session") &&
    cookieHeader.includes("app_state=opaque-app-state") &&
    cookieHeader.includes("session_state=opaque-session-state"),
  "forwards all reusable first-party cookies from one multi-cookie bundle",
);
assert(
  !cookieHeader.includes("_ga") &&
    !cookieHeader.includes("cf_clearance") &&
    !cookieHeader.includes("vault-only-storage"),
  "never forwards analytics, challenge, or browser-storage values as cookies",
);

const legacySession = JSON.stringify({
  authenticated_cookies: [
    {
      name: "legacy_cookie",
      value: "legacy-value",
      domain: ".chatgpt.com",
      path: "/",
    },
  ],
});
assert(
  buildChatGPTCookieHeader(legacySession).includes(
    "legacy_cookie=legacy-value",
  ),
  "keeps backward compatibility with the legacy authenticated_cookies input",
);

const rotated = JSON.parse(
  applyChatGPTCookieRotations(sampleSession, [
    "__Secure-chat-session=rotated-session; Path=/; HttpOnly; Secure",
    "app_state=rotated-app-state; Path=/; Secure",
    "new_cookie=ignore-me; Path=/",
  ]).plaintext,
);
assert(
  rotated.cookies.find(
    (cookie: any) => cookie.name === "__Secure-chat-session",
  )?.value === "rotated-session" &&
    rotated.cookies.find(
      (cookie: any) => cookie.name === "app_state",
    )?.value === "rotated-app-state" &&
    !rotated.cookies.some(
      (cookie: any) => cookie.name === "new_cookie",
    ),
  "rotates only cookie names already approved in the encrypted vault",
);

const h1 = hashChatGPTProxyToken("ticket-a");
const h2 = hashChatGPTProxyToken("ticket-a");
const h3 = hashChatGPTProxyToken("ticket-b");
assert(h1 === h2, "proxy token hashing is deterministic");
assert(h1 !== h3, "different proxy tokens hash differently");
assert(/^[0-9a-f]{64}$/.test(h1), "proxy token hashes are SHA-256 hex");

const now = Date.now();
assert(
  isActiveChatGPTOrder(
    {
      status: "approved",
      payment_status: "successful",
      access_type: "shared",
      expires_at: new Date(now + 60_000).toISOString(),
    },
    now,
  ),
  "recognises an active shared ChatGPT order",
);
assert(
  !isActiveChatGPTOrder(
    {
      status: "approved",
      payment_status: "successful",
      access_type: "private",
      fulfilment_status: "pending",
      expires_at: new Date(now + 60_000).toISOString(),
    },
    now,
  ),
  "keeps unfulfilled private ChatGPT orders blocked",
);
assert(
  isActiveChatGPTGrant(
    {
      status: "active",
      expires_at: new Date(now + 60_000).toISOString(),
    },
    now,
  ),
  "recognises an active ChatGPT admin grant",
);

const previousHours = process.env.CHATGPT_PROXY_SESSION_HOURS;
delete process.env.CHATGPT_PROXY_SESSION_HOURS;
assert(
  chatgptProxySessionHours() === 12,
  "defaults ChatGPT proxy sessions to 12 hours",
);
process.env.CHATGPT_PROXY_SESSION_HOURS = "24";
assert(
  chatgptProxySessionHours() === 24,
  "allows a 24-hour configured maximum",
);
process.env.CHATGPT_PROXY_SESSION_HOURS = "99";
assert(
  chatgptProxySessionHours() === 24,
  "caps ChatGPT proxy sessions at 24 hours",
);
if (previousHours === undefined) delete process.env.CHATGPT_PROXY_SESSION_HOURS;
else process.env.CHATGPT_PROXY_SESSION_HOURS = previousHours;

const html = `<html><head><title>ChatGPT</title></head><body>
<a href="/">Home</a>
<script src="/assets/app.js"></script>
<img src="https://chatgpt.com/logo.png">
<img src="https://cdn.oaistatic.com/image.png">
<a href="https://example.com/help">External</a>
</body></html>`;
const rewrittenHtml = rewriteChatGPTBody(html, "text/html; charset=utf-8");
assert(
  rewrittenHtml.includes('<base href="/api/chatgpt-proxy/">'),
  "injects the ChatGPT proxy base into HTML",
);
assert(
  rewrittenHtml.includes('src="/api/chatgpt-proxy/assets/app.js"'),
  "rewrites root-relative ChatGPT assets through the proxy",
);
assert(
  rewrittenHtml.includes("/api/chatgpt-proxy/logo.png"),
  "rewrites absolute chatgpt.com URLs through the fixed proxy",
);
assert(
  rewrittenHtml.includes(
    "/api/chatgpt-proxy/__host/cdn.oaistatic.com/image.png",
  ),
  "routes approved oaistatic assets through the fixed-host asset route",
);
assert(
  rewrittenHtml.includes('href="https://example.com/help"'),
  "does not rewrite unrelated external origins",
);
assert(
  rewrittenHtml.includes("/api/chatgpt-proxy-bootstrap"),
  "injects the ChatGPT browser network-rewrite bootstrap",
);

assert(
  rewriteChatGPTLocation("/") === "/api/chatgpt-proxy/",
  "rewrites same-origin relative redirects",
);
assert(
  rewriteChatGPTLocation("https://chatgpt.com/?x=1") ===
    "/api/chatgpt-proxy/?x=1",
  "rewrites absolute chatgpt.com redirects",
);
assert(
  rewriteChatGPTLocation("https://cdn.oaistatic.com/a.js") ===
    "/api/chatgpt-proxy/__host/cdn.oaistatic.com/a.js",
  "rewrites approved static-host redirects",
);
assert(
  rewriteChatGPTLocation("https://example.com/login") === null,
  "blocks redirects to unrelated origins",
);

const previousAssetHosts = process.env.CHATGPT_ASSET_HOSTS;
process.env.CHATGPT_ASSET_HOSTS =
  "cdn.oaistatic.com,persistent.oaistatic.com,assets.chatgpt.com,evil.example";
const hosts = chatgptAllowedAssetHosts();
assert(
  hosts.includes("cdn.oaistatic.com") &&
    hosts.includes("persistent.oaistatic.com") &&
    hosts.includes("assets.chatgpt.com") &&
    !hosts.includes("evil.example"),
  "allows only ChatGPT/oaistatic fixed asset hosts",
);
if (previousAssetHosts === undefined) delete process.env.CHATGPT_ASSET_HOSTS;
else process.env.CHATGPT_ASSET_HOSTS = previousAssetHosts;

const pinned = buildChatGPTUpstreamUrl(
  "https://topratedseotools.com/api/chatgpt-proxy//evil.example/path?x=1&ticket=secret",
  "//evil.example/path",
);
assert(
  pinned.origin === "https://chatgpt.com",
  "pins malformed double-slash paths to chatgpt.com rather than treating them as hosts",
);
assert(
  pinned.pathname === "//evil.example/path" &&
    pinned.searchParams.get("x") === "1" &&
    !pinned.searchParams.has("ticket"),
  "preserves normal query data but never forwards the launch ticket upstream",
);

const server = readFileSync("src/server.ts", "utf8");
assert(
  server.includes('url.pathname === "/api/chatgpt-proxy"') &&
    server.includes('url.pathname.startsWith("/api/chatgpt-proxy/")') &&
    server.includes('url.pathname === "/api/chatgpt-proxy-bootstrap"'),
  "server intercepts ChatGPT proxy and bootstrap routes before TanStack routing",
);
assert(
  server.includes("isDedicatedChatGPTProxyRequest") &&
    server.includes("dedicatedChatGPTHost"),
  "server supports an optional dedicated ChatGPT proxy origin",
);

const launcher = readFileSync("src/lib/tool-launcher.ts", "utf8");
assert(
  launcher.includes("startChatGPTProxyLaunch") &&
    launcher.includes('tool.slug === "chatgpt"'),
  "client launcher routes ChatGPT through the dedicated Phase 3 proxy",
);
assert(
  launcher.includes('launchUrl.pathname === "/api/chatgpt-proxy"') &&
    launcher.includes('launchUrl.pathname === "/__trst/enter"'),
  "client validates both local and trusted dedicated ChatGPT launch URLs",
);

const proxySource = readFileSync("src/lib/chatgpt-proxy.server.ts", "utf8");
assert(
  proxySource.includes('"upstream_401"') &&
    proxySource.includes('"upstream_403"') &&
    proxySource.includes('"upstream_403_edge_challenge"') &&
    proxySource.includes('"upstream_network_error"') &&
    proxySource.includes('"session_decrypt_failed"'),
  "records safe upstream diagnostic codes",
);
assert(
  proxySource.includes('contentType.includes("text/event-stream")') &&
    proxySource.includes("new Response(upstream.body"),
  "passes ChatGPT streaming/event-stream responses through without buffering",
);

const diagnosticStart = proxySource.indexOf(
  "async function recordChatGPTProxyDiagnostic",
);
const diagnosticEnd = proxySource.indexOf(
  "export async function createChatGPTProxyLaunch",
  diagnosticStart,
);
const diagnosticSource = proxySource.slice(diagnosticStart, diagnosticEnd);
assert(
  diagnosticStart >= 0 &&
    diagnosticEnd > diagnosticStart &&
    !diagnosticSource.includes("response_body") &&
    !diagnosticSource.includes("cookie_value") &&
    !diagnosticSource.includes("encrypted_payload"),
  "ChatGPT diagnostics never persist response bodies or secret values",
);

assert(
  proxySource.includes("persistRotatedChatGPTCookies") &&
    proxySource.includes('"sec-fetch-dest"') &&
    proxySource.includes('"sec-fetch-mode"') &&
    proxySource.includes('"sec-fetch-site"'),
  "uses the established AWS/StealthWriter request and cookie-rotation model",
);

const migration = readFileSync(
  "supabase/migrations/20260926062000_chatgpt_proxy_sessions.sql",
  "utf8",
);
assert(
  migration.includes("chatgpt_proxy_sessions") &&
    migration.includes("last_error_code") &&
    migration.includes("last_upstream_status") &&
    migration.includes("diagnostic_updated_at") &&
    migration.includes("revoke all") &&
    migration.includes("service_role"),
  "adds a server-only ChatGPT proxy-session table with safe diagnostics",
);

{
  const req = new Request("https://topratedseotools.com/api/chatgpt-proxy/backend-api/conversations", {
    headers: {
      authorization: "Bearer test-access-token",
      "oai-device-id": "dev-1",
      "oai-client-version": "prod-abc",
      "openai-sentinel-chat-requirements-token": "req-1",
      "openai-sentinel-proof-token": "proof-1",
      cookie: "trst_cg_proxy=browser-cookie",
      "x-forwarded-for": "1.2.3.4",
    },
  });
  const up = upstreamHeaders(req, "__Secure-next-auth.session-token=abc");
  assert(up.get("authorization") === "Bearer test-access-token", "forwards ChatGPT bearer token to chatgpt.com");
  assert(up.get("oai-device-id") === "dev-1" && up.get("oai-client-version") === "prod-abc", "forwards oai-* client headers");
  assert(up.get("openai-sentinel-chat-requirements-token") === "req-1" && up.get("openai-sentinel-proof-token") === "proof-1", "forwards sentinel headers");
  assert(up.get("cookie") === "__Secure-next-auth.session-token=abc", "never forwards the browser's own cookies");
  assert(up.get("x-forwarded-for") === null, "does not forward unrelated headers");
  const asset = upstreamHeaders(req, "", "https://cdn.oaistatic.com", false);
  assert(asset.get("authorization") === null && asset.get("oai-device-id") === null, "never sends bearer/client headers to asset hosts");
  assert(isForwardedChatGPTClientHeader("Authorization") && !isForwardedChatGPTClientHeader("cookie"), "header allow-list is case-insensitive and excludes cookies");
}

{
  const js = 'const a=new URL("https://chatgpt.com/backend-api");const b="https:\\/\\/chatgpt.com\\/x";const c="https://cdn.oaistatic.com/y.png";';
  const ded = rewriteChatGPTBody(js, "application/javascript", "", "https://chatgpt.topratedseotools.com");
  assert(ded.includes('new URL("https://chatgpt.topratedseotools.com/backend-api")'), "dedicated host keeps chatgpt.com URLs absolute (valid for new URL)");
  assert(ded.includes("https:\\/\\/chatgpt.topratedseotools.com\\/x"), "rewrites JSON-escaped chatgpt.com URLs to the absolute proxy origin");
  assert(ded.includes("https://chatgpt.topratedseotools.com/__host/cdn.oaistatic.com/y.png"), "routes asset hosts through the absolute proxy origin");
  const path = rewriteChatGPTBody(js, "application/javascript", "/api/chatgpt-proxy", "https://topratedseotools.com");
  assert(path.includes('new URL("https://topratedseotools.com/api/chatgpt-proxy/backend-api")'), "path mode also keeps URLs absolute");
}

assert(mapChatGPTClientApiPath("/__codex-api/me") === "/backend-api/me", "maps codex API base to /backend-api");
assert(mapChatGPTClientApiPath("/__codex-api/sentinel/chat-requirements/prepare") === "/backend-api/sentinel/chat-requirements/prepare", "maps sentinel calls");
assert(mapChatGPTClientApiPath("/__codex-anon-api/models") === "/backend-anon/models", "maps anon codex API base");
assert(mapChatGPTClientApiPath("/__codex-apix/me") === "/__codex-apix/me", "does not map lookalike prefixes");
assert(mapChatGPTClientApiPath("/c/123") === "/c/123" && mapChatGPTClientApiPath("/") === "/", "leaves page routes alone");

assert(isImmutableChatGPTAssetPath("https://chatgpt.com", "/cdn/assets/123.abc.js"), "hashed ChatGPT assets are cacheable");
assert(!isImmutableChatGPTAssetPath("https://chatgpt.com", "/backend-api/me"), "API calls are never cached");
assert(!isImmutableChatGPTAssetPath("https://chatgpt.com", "/"), "pages are never cached");
{
  const src = readFileSync("src/lib/chatgpt-proxy.server.ts", "utf8");
  assert(src.includes("CHATGPT_SESSION_CACHE_MS = 30_000"), "writer-session validation cache is short-lived (30s)");
  assert(src.indexOf("request.arrayBuffer()") < src.indexOf("proxySession = await requireProxySession(request)"), "request body is read before slow session checks");
}

{
  const json = '{"upload_url":"https://sdmntprcentralus.oaiusercontent.com/files/abc/raw?se=1&sig=x","esc":"https:\\/\\/sdmntprwestus.oaiusercontent.com\\/f"}';
  const out = rewriteChatGPTBody(json, "application/json", "", "https://chatgpt.topratedseotools.com");
  assert(out.includes('"https://chatgpt.topratedseotools.com/__host/sdmntprcentralus.oaiusercontent.com/files/abc/raw?se=1&sig=x"'), "routes OpenAI file-storage upload URLs through the proxy");
  assert(out.includes("https:\\/\\/chatgpt.topratedseotools.com\\/__host\\/sdmntprwestus.oaiusercontent.com\\/f"), "routes JSON-escaped file-storage URLs");
  assert(isChatGPTUserContentHost("sdmntprcentralus.oaiusercontent.com") && !isChatGPTUserContentHost("evil.com") && !isChatGPTUserContentHost("oaiusercontent.com.evil.com"), "file-storage host check is strict");
  const req = new Request("https://chatgpt.topratedseotools.com/__host/sdmntprcentralus.oaiusercontent.com/files/abc/raw", { method: "PUT", headers: { "x-ms-blob-type": "BlockBlob", authorization: "Bearer t" } });
  const up = upstreamHeaders(req, "", "https://sdmntprcentralus.oaiusercontent.com", false);
  assert(up.get("x-ms-blob-type") === "BlockBlob" && up.get("authorization") === null, "forwards x-ms-* (not the bearer) to file storage");
}

{
  const { isBlockedChatGptApiRequest: b } = await import("../src/lib/chatgpt-controls.server");
  assert(b("POST", "/api/auth/signout") && b("GET", "/auth/logout") && b("POST", "/backend-api/accounts/logout_all"), "logout/sign-out is always blocked");
  assert(b("POST", "/backend-api/settings/account_user_setting") && b("PATCH", "/backend-api/me") && b("POST", "/backend-api/user_system_messages") && b("DELETE", "/backend-api/memories"), "shared-profile/account changes are blocked");
  assert(b("POST", "/backend-api/payments/checkout") && b("POST", "/backend-api/subscriptions") && b("POST", "/backend-api/accounts/deactivate"), "billing and account removal are blocked");
  assert(!b("GET", "/backend-api/me") && !b("GET", "/backend-api/settings/user") && !b("GET", "/backend-api/memories"), "reads still work");
  assert(!b("POST", "/backend-api/f/conversation") && !b("POST", "/backend-api/files") && !b("POST", "/backend-api/sentinel/chat-requirements/prepare") && !b("POST", "/backend-api/conversation/init"), "chatting and uploads are not blocked");
}

console.log(`chatgpt-proxy: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
