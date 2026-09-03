/**
 * Phrasly shared-auth state-machine regression tests.
 * Run: bun tests/phrasly-auth-state.test.ts
 */
import {
  attachBrowserUsePage,
  waitForAuthenticatedPage,
  waitForAuthOrOtp,
} from "../src/lib/browser-auth-session.server";
import { resolveCdpWebSocketUrl, type CdpClient } from "../src/lib/browser-auth.server";
import { cookieBelongsToPageHost } from "../src/lib/browser-auth-otp.server";
import {
  requiresAdminManagedSharedAuth,
  resolveSharedAuthLandingUrl,
} from "../src/lib/shared-auth-policy";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: unknown, message: string) {
  if (condition) {
    passed++;
  } else {
    failed++;
    failures.push(message);
    console.error("  ✗", message);
  }
}

class MockCdp {
  readonly calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
  constructor(private readonly responses: Array<unknown | Error>) {}

  async send(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<unknown> {
    this.calls.push({ method, params });
    const next = this.responses.shift();
    if (next instanceof Error) throw next;
    return next ?? {};
  }
}

console.log("phrasly-auth-state");

// Browser Use v3 currently returns an HTTPS CDP discovery URL. Raw WebSocket
// clients must resolve /json/version and then connect to webSocketDebuggerUrl.
{
  let requestedUrl = "";
  const resolved = await resolveCdpWebSocketUrl(
    "https://session.cdp.browser-use.com",
    (async (input: RequestInfo | URL) => {
      requestedUrl = String(input);
      return new Response(
        JSON.stringify({
          webSocketDebuggerUrl:
            "wss://session.cdp.browser-use.com/devtools/browser/abc123",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch,
  );
  assert(
    requestedUrl === "https://session.cdp.browser-use.com/json/version",
    "HTTP CDP endpoints are resolved through /json/version",
  );
  assert(
    resolved === "wss://session.cdp.browser-use.com/devtools/browser/abc123",
    "HTTP CDP discovery returns the actual WebSocket debugger URL",
  );
}

{
  const resolved = await resolveCdpWebSocketUrl(
    "wss://session.cdp.browser-use.com/devtools/browser/abc123",
    (async () => {
      throw new Error("fetch should not be called for direct WebSocket URLs");
    }) as typeof fetch,
  );
  assert(
    resolved === "wss://session.cdp.browser-use.com/devtools/browser/abc123",
    "direct ws/wss CDP endpoints remain unchanged",
  );
}

// Browser Use reconnects can expose multiple page targets. Prefer the page
// whose hostname matches the configured Phrasly login URL.
{
  const mock = new MockCdp([
    {
      targetInfos: [
        {
          type: "page",
          targetId: "provider-page",
          url: "https://example.com/internal",
        },
        {
          type: "page",
          targetId: "phrasly-page",
          url: "https://phrasly.ai/dashboard",
        },
      ],
    },
    { sessionId: "page-session" },
  ]);
  const sessionId = await attachBrowserUsePage(
    mock as unknown as CdpClient,
    "https://phrasly.ai/login",
  );
  assert(sessionId === "page-session", "Phrasly target attach returns a session id");
  assert(
    mock.calls[1]?.params?.targetId === "phrasly-page",
    "Browser Use reconnect prefers the Phrasly page target",
  );
}

// 0. Phrasly must never use the legacy writer credential-login path.
assert(
  requiresAdminManagedSharedAuth("phrasly") &&
    requiresAdminManagedSharedAuth(" PHRASLY ") &&
    !requiresAdminManagedSharedAuth("sneakwrite"),
  "Phrasly is classified as admin-managed shared authentication only",
);

assert(
  resolveSharedAuthLandingUrl("phrasly", "https://phrasly.ai/login") ===
    "https://phrasly.ai/dashboard",
  "Phrasly saved sessions are verified on the protected dashboard route",
);

assert(
  cookieBelongsToPageHost(".phrasly.ai", "phrasly.ai") &&
    cookieBelongsToPageHost(".phrasly.ai", "app.phrasly.ai") &&
    !cookieBelongsToPageHost(".google.com", "phrasly.ai"),
  "captured reusable state excludes cookies from unrelated identity-provider domains",
);

// 1. OTP must win even if the page could otherwise look authenticated.
{
  const mock = new MockCdp([
    {
      result: {
        value: {
          detected: true,
          type: "email",
          fieldSelector: "name:code",
        },
      },
    },
    {
      result: {
        value: {
          authenticated: true,
          url: "https://phrasly.ai/dashboard",
        },
      },
    },
  ]);
  const result = await waitForAuthOrOtp(
    mock as unknown as CdpClient,
    undefined,
    1_000,
  );
  assert(
    result.status === "otp",
    "OTP challenge takes priority over authenticated-looking UI",
  );
  assert(
    mock.calls.length === 1,
    "auth heuristic is not evaluated after OTP is detected",
  );
}

// 2. A clean protected page is accepted only after OTP detection is negative.
{
  const mock = new MockCdp([
    { result: { value: { detected: false } } },
    {
      result: {
        value: {
          authenticated: true,
          url: "https://phrasly.ai/dashboard",
          title: "Phrasly",
        },
      },
    },
  ]);
  const result = await waitForAuthOrOtp(
    mock as unknown as CdpClient,
    undefined,
    1_000,
  );
  assert(
    result.status === "authenticated",
    "authenticated page is accepted when no OTP challenge exists",
  );
  assert(mock.calls.length === 2, "OTP check runs before authentication check");
}

// 3. A responsive but unauthenticated page is distinguished from provider/CDP failure.
{
  const mock = new MockCdp([
    { result: { value: { detected: false } } },
    {
      result: {
        value: {
          authenticated: false,
          url: "https://phrasly.ai/login",
          title: "Login",
        },
      },
    },
  ]);
  const result = await waitForAuthOrOtp(
    mock as unknown as CdpClient,
    undefined,
    1,
  );
  assert(
    result.status === "timeout" && result.observedPage,
    "responsive unauthenticated page is classified as observed auth rejection",
  );
}

// A responsive human-verification screen must remain distinguishable from
// a normal login page so the admin receives the correct next action.
{
  const mock = new MockCdp([
    { result: { value: { detected: false } } },
    {
      result: {
        value: {
          authenticated: false,
          url: "https://phrasly.ai/login",
          title: "Phrasly",
          onLoginPage: true,
          hasError: false,
          humanVerification: true,
        },
      },
    },
  ]);
  const result = await waitForAuthOrOtp(
    mock as unknown as CdpClient,
    undefined,
    1,
  );
  assert(
    result.status === "timeout" &&
      result.onLoginPage &&
      result.humanVerification,
    "human-verification login state is preserved for admin diagnostics",
  );
}

// 4. A transport failure must not look like rejected saved credentials.
{
  const mock = new MockCdp([new Error("CDP unavailable")]);
  const result = await waitForAuthOrOtp(
    mock as unknown as CdpClient,
    undefined,
    1,
  );
  assert(
    result.status === "timeout" && !result.observedPage,
    "provider/CDP failure is distinguishable from an upstream auth rejection",
  );
}

// 5. A correct OTP may leave the challenge visible briefly before redirecting.
{
  const mock = new MockCdp([
    { result: { value: { detected: true, type: "email" } } },
    { result: { value: { detected: false } } },
    {
      result: {
        value: {
          authenticated: true,
          url: "https://phrasly.ai/dashboard",
          title: "Phrasly",
        },
      },
    },
  ]);
  const result = await waitForAuthenticatedPage(
    mock as unknown as CdpClient,
    undefined,
    1_500,
  );
  assert(
    result.authenticated,
    "post-OTP verification waits through a transient challenge before accepting redirect",
  );
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  for (const failure of failures) console.error("  •", failure);
  process.exit(1);
}
