/**
 * Phase 4 StealthWriter validation matrix.
 *
 * Source-of-truth behaviors:
 * - uploaded video: admin pastes/replaces exactly two Better Auth cookie values;
 * - AWS source: one-time 60-second handoff, independent access recheck,
 *   server-side master-cookie injection, rotated-cookie persistence and
 *   master-account path protection.
 *
 * Run: bun tests/stealthwriter-phase4-validation.test.ts
 */
import {
  decryptStealthWriterSession,
  encryptStealthWriterSession,
  normaliseStealthWriterSession,
} from "../src/lib/stealthwriter-session.server";
import {
  applyStealthWriterCookieRotations,
  buildStealthWriterCookieHeader,
  isActiveStealthWriterGrant,
  isActiveStealthWriterOrder,
  isBlockedStealthWriterPath,
  isStealthWriterUpstreamAuthRejected,
  proxySessionDays,
  STEALTHWRITER_HANDOFF_TTL_SECONDS,
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

function throws(fn: () => unknown) {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

const key = "33".repeat(32);
const oldSession = JSON.stringify({
  "__Secure-better-auth.session_token": "old-token",
  "__Secure-better-auth.session_data": "old-data",
});
const replacementSession = JSON.stringify({
  "__Secure-better-auth.session_token": "new-token",
  "__Secure-better-auth.session_data": "new-data",
});

// Video/admin replacement flow.
const oldEncrypted = encryptStealthWriterSession(
  normaliseStealthWriterSession(oldSession),
  key,
);
const replacementEncrypted = encryptStealthWriterSession(
  normaliseStealthWriterSession(replacementSession),
  key,
);
assert(
  oldEncrypted !== replacementEncrypted,
  "admin replacement produces a new encrypted vault value",
);
const replacementPlaintext = decryptStealthWriterSession(
  replacementEncrypted,
  key,
);
assert(
  replacementPlaintext.includes("new-token") &&
    replacementPlaintext.includes("new-data") &&
    !replacementPlaintext.includes("old-token"),
  "replacement vault state contains only the new authorised session",
);
assert(
  throws(() =>
    normaliseStealthWriterSession(
      JSON.stringify({
        "__Secure-better-auth.session_token": "token",
        "__Secure-better-auth.session_data": "data",
        "extra-cookie": "not-from-video",
      }),
    ),
  ),
  "admin paste remains restricted to the two video/AWS cookie names",
);

// AWS handoff/session lifetime split.
assert(
  STEALTHWRITER_HANDOFF_TTL_SECONDS === 60,
  "signed one-click handoff remains a 60-second entry link",
);
const previousDays = process.env.STEALTHWRITER_PROXY_SESSION_DAYS;
delete process.env.STEALTHWRITER_PROXY_SESSION_DAYS;
assert(
  proxySessionDays() === 30,
  "proxy session defaults to 30 days and does not inherit the 60-second handoff TTL",
);
process.env.STEALTHWRITER_PROXY_SESSION_DAYS = "7";
assert(proxySessionDays() === 7, "proxy session supports a 7-day window");
process.env.STEALTHWRITER_PROXY_SESSION_DAYS = "20";
assert(proxySessionDays() === 20, "proxy session supports a 20-day window");
if (previousDays === undefined) delete process.env.STEALTHWRITER_PROXY_SESSION_DAYS;
else process.env.STEALTHWRITER_PROXY_SESSION_DAYS = previousDays;

// Existing-site paid access equivalent to AWS gate.php access recheck.
const now = Date.parse("2026-09-24T12:00:00Z");
const tomorrow = "2026-09-25T12:00:00Z";
const yesterday = "2026-09-23T12:00:00Z";
assert(
  isActiveStealthWriterOrder(
    {
      status: "approved",
      payment_status: "successful",
      access_type: "shared",
      fulfilment_status: "active",
      expires_at: tomorrow,
    },
    now,
  ),
  "active paid StealthWriter order passes the server-side gate",
);
assert(
  !isActiveStealthWriterOrder(
    {
      status: "approved",
      payment_status: "successful",
      access_type: "shared",
      fulfilment_status: "active",
      expires_at: yesterday,
    },
    now,
  ),
  "expired StealthWriter order is rejected",
);
assert(
  !isActiveStealthWriterOrder(
    {
      status: "approved",
      payment_status: "pending",
      access_type: "shared",
      fulfilment_status: "active",
      expires_at: tomorrow,
    },
    now,
  ),
  "unpaid StealthWriter order is rejected",
);
assert(
  !isActiveStealthWriterOrder(
    {
      status: "pending",
      payment_status: "successful",
      access_type: "shared",
      fulfilment_status: "active",
      expires_at: tomorrow,
    },
    now,
  ),
  "unapproved StealthWriter order is rejected",
);
assert(
  !isActiveStealthWriterOrder(
    {
      status: "approved",
      payment_status: "successful",
      access_type: "private",
      fulfilment_status: "pending",
      expires_at: tomorrow,
    },
    now,
  ),
  "private order without active fulfilment is rejected",
);
assert(
  isActiveStealthWriterOrder(
    {
      status: "approved",
      payment_status: "successful",
      access_type: "private",
      fulfilment_status: "active",
      expires_at: tomorrow,
    },
    now,
  ),
  "active fulfilled private order passes",
);
assert(
  isActiveStealthWriterGrant(
    { status: "active", expires_at: tomorrow },
    now,
  ),
  "active admin grant passes",
);
assert(
  !isActiveStealthWriterGrant(
    { status: "active", expires_at: yesterday },
    now,
  ),
  "expired admin grant is rejected",
);
assert(
  !isActiveStealthWriterGrant(
    { status: "revoked", expires_at: tomorrow },
    now,
  ),
  "revoked admin grant is rejected",
);

// Invalid/stale upstream auth.
assert(
  isStealthWriterUpstreamAuthRejected(401),
  "upstream 401 is treated as invalid/expired StealthWriter authentication",
);
assert(
  isStealthWriterUpstreamAuthRejected(403),
  "upstream 403 is treated as invalid/expired StealthWriter authentication",
);
assert(
  !isStealthWriterUpstreamAuthRejected(200),
  "normal upstream response is not misclassified as auth failure",
);
assert(
  throws(() => decryptStealthWriterSession(replacementEncrypted, "44".repeat(32))),
  "vault decryption fails closed with the wrong encryption key",
);

// AWS proxy.php Better Auth rotation behavior.
const rotated = applyStealthWriterCookieRotations(replacementPlaintext, [
  "__Secure-better-auth.session_token=rotated-token; Path=/; HttpOnly; Secure",
  "__Secure-better-auth.session_data=rotated-data; Path=/; HttpOnly; Secure",
  "analytics_cookie=ignore-this; Path=/",
]);
const rotatedParsed = JSON.parse(rotated.plaintext);
assert(rotated.changed, "Better Auth cookie rotation is detected");
assert(
  rotatedParsed["__Secure-better-auth.session_token"] === "rotated-token",
  "rotated session-token replaces the prior master value",
);
assert(
  rotatedParsed["__Secure-better-auth.session_data"] === "rotated-data",
  "rotated session-data replaces the prior master value",
);
assert(
  !("analytics_cookie" in rotatedParsed),
  "unrelated Set-Cookie values never enter the master vault",
);
const noRotation = applyStealthWriterCookieRotations(rotated.plaintext, [
  "analytics_cookie=still-ignore; Path=/",
]);
assert(
  !noRotation.changed && noRotation.plaintext === rotated.plaintext,
  "unrelated cookies do not create a false master-session update",
);

// Master cookie stays server-side and contains only the two allowlisted values.
const upstreamCookie = buildStealthWriterCookieHeader(rotated.plaintext);
assert(
  upstreamCookie.includes("__Secure-better-auth.session_token=rotated-token") &&
    upstreamCookie.includes("__Secure-better-auth.session_data=rotated-data"),
  "server-side upstream Cookie header uses the renewed master session",
);
assert(
  !upstreamCookie.includes("analytics_cookie") &&
    !upstreamCookie.includes("HttpOnly") &&
    !upstreamCookie.includes("Secure"),
  "upstream Cookie header contains no unrelated cookie or browser attributes",
);

// AWS index.php protection against master-account actions.
for (const path of [
  "/logout",
  "/billing",
  "/billing/invoices",
  "/account",
  "/subscriptions",
  "/settings/account",
]) {
  assert(isBlockedStealthWriterPath(path), `blocks master-account path ${path}`);
}
assert(
  !isBlockedStealthWriterPath("/dashboard/humanizer"),
  "Humanizer workspace remains allowed",
);
assert(
  !isBlockedStealthWriterPath("/dashboard/ai-detector"),
  "AI Detector workspace remains allowed",
);

console.log(
  `stealthwriter-phase4-validation: ${passed} passed, ${failed} failed`,
);
if (failed > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
