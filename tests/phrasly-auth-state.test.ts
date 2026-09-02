/**
 * Phrasly shared-auth state-machine regression tests.
 * Run: bun tests/phrasly-auth-state.test.ts
 */
import { waitForAuthOrOtp, waitForAuthenticatedPage } from "../src/lib/browser-auth-session.server";
import type { CdpClient } from "../src/lib/browser-auth.server";

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
  readonly calls: string[] = [];
  constructor(private readonly responses: Array<unknown | Error>) {}

  async send(method: string): Promise<unknown> {
    this.calls.push(method);
    const next = this.responses.shift();
    if (next instanceof Error) throw next;
    return next ?? {};
  }
}

console.log("phrasly-auth-state");

// 1. OTP must win even if the page could otherwise look authenticated.
{
  const mock = new MockCdp([
    { result: { value: { detected: true, type: "email", fieldSelector: "name:code" } } },
    { result: { value: { authenticated: true, url: "https://phrasly.ai/dashboard" } } },
  ]);
  const result = await waitForAuthOrOtp(mock as unknown as CdpClient, undefined, 1_000);
  assert(result.status === "otp", "OTP challenge takes priority over authenticated-looking UI");
  assert(mock.calls.length === 1, "auth heuristic is not evaluated after OTP is detected");
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
  const result = await waitForAuthOrOtp(mock as unknown as CdpClient, undefined, 1_000);
  assert(result.status === "authenticated", "authenticated page is accepted when no OTP challenge exists");
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
  const result = await waitForAuthOrOtp(mock as unknown as CdpClient, undefined, 1);
  assert(
    result.status === "timeout" && result.observedPage,
    "responsive unauthenticated page is classified as observed auth rejection",
  );
}

// 4. A transport failure must not look like rejected saved credentials.
{
  const mock = new MockCdp([new Error("CDP unavailable")]);
  const result = await waitForAuthOrOtp(mock as unknown as CdpClient, undefined, 1);
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
