/**
 * SneakWrite direct-SSO URL trust-boundary regression tests.
 * Run: bun tests/direct-sso-url.test.ts
 */
import { validateSneakWriteLaunchUrl } from "../src/lib/direct-sso-url";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, message: string) {
  if (condition) {
    passed++;
  } else {
    failed++;
    failures.push(message);
    console.error("  ✗", message);
  }
}

function accepts(url: string) {
  try {
    validateSneakWriteLaunchUrl(url);
    return true;
  } catch {
    return false;
  }
}

const good =
  "https://rsnxhzlqxivpnpryzesu.supabase.co/auth/v1/verify?token=opaque&type=magiclink&redirect_to=https%3A%2F%2Fsneakwrite.net%2Fapp";

assert(accepts(good), "accepts the expected Supabase magic-link handoff to SneakWrite /app");
assert(!accepts("not-a-url"), "rejects malformed URLs");
assert(
  !accepts("https://evil.example/auth/v1/verify?type=magiclink&redirect_to=https%3A%2F%2Fsneakwrite.net%2Fapp"),
  "rejects an untrusted launch host",
);
assert(
  !accepts("https://rsnxhzlqxivpnpryzesu.supabase.co/auth/v1/token?type=magiclink&redirect_to=https%3A%2F%2Fsneakwrite.net%2Fapp"),
  "rejects an unexpected Supabase auth path",
);
assert(
  !accepts("https://rsnxhzlqxivpnpryzesu.supabase.co/auth/v1/verify?type=recovery&redirect_to=https%3A%2F%2Fsneakwrite.net%2Fapp"),
  "rejects non-magic-link handoffs",
);
assert(
  !accepts("https://rsnxhzlqxivpnpryzesu.supabase.co/auth/v1/verify?type=magiclink&redirect_to=https%3A%2F%2Fevil.example%2Fapp"),
  "rejects redirects away from SneakWrite",
);
assert(
  !accepts("https://rsnxhzlqxivpnpryzesu.supabase.co/auth/v1/verify?type=magiclink&redirect_to=https%3A%2F%2Fsneakwrite.net%2Flogin"),
  "rejects redirects to the wrong SneakWrite path",
);

console.log(`direct-sso-url: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
