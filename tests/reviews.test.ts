/**
 * Unit tests for the review eligibility gate and content safety.
 * Uses pure helpers so we don't need to mock the DB layer.
 */
import { deriveReviewGate, isQualifyingOrder, reviewSourceFor, filterRefundedOrders, isRefundPayment } from "../src/lib/reviews.functions";
import { checkReviewSafety } from "../src/lib/reviews-safety";

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) { passed++; }
  else { failed++; console.error("  ✗", msg); }
}
function test(name: string, fn: () => void) {
  console.log("• " + name);
  const before = failed;
  try { fn(); } catch (err) { failed++; console.error("  ✗ threw:", err); }
  if (failed === before) console.log("  ✓ ok");
}

// ---------- Eligibility ----------

test("no qualifying purchase → cannot review", () => {
  const g = deriveReviewGate({ qualifyingCount: 0, currentVersion: null });
  assert(!g.canReview && !g.canEdit, "blocked");
});

test("one qualifying purchase, no review → canReview", () => {
  const g = deriveReviewGate({ qualifyingCount: 1, currentVersion: null });
  assert(g.canReview && !g.canEdit, "canReview");
});

test("one qualifying purchase, review submitted → locked", () => {
  const g = deriveReviewGate({ qualifyingCount: 1, currentVersion: 1 });
  assert(!g.canReview && !g.canEdit, "locked after submit");
});

test("second qualifying purchase unlocks one update", () => {
  const g = deriveReviewGate({ qualifyingCount: 2, currentVersion: 1 });
  assert(!g.canReview && g.canEdit, "canEdit unlocked");
});

test("update resubmitted → locked again", () => {
  const g = deriveReviewGate({ qualifyingCount: 2, currentVersion: 2 });
  assert(!g.canReview && !g.canEdit, "locked after update");
});

test("third qualifying purchase unlocks another update", () => {
  const g = deriveReviewGate({ qualifyingCount: 3, currentVersion: 2 });
  assert(!g.canReview && g.canEdit, "another update unlocked");
});

// ---------- isQualifyingOrder ----------

test("paystack shared approved → qualifies", () => {
  assert(isQualifyingOrder({ status: "approved", cancelled_at: null, access_type: "shared", fulfilment_status: "not_required" }), "qualifies");
});
test("offline shared approved → qualifies", () => {
  assert(isQualifyingOrder({ status: "approved", cancelled_at: null, access_type: "shared", fulfilment_status: null }), "qualifies");
});
test("pending order → does not qualify", () => {
  assert(!isQualifyingOrder({ status: "pending", cancelled_at: null, access_type: "shared", fulfilment_status: null }), "no");
});
test("cancelled order → does not qualify", () => {
  assert(!isQualifyingOrder({ status: "approved", cancelled_at: "2026-01-01", access_type: "shared", fulfilment_status: null }), "no");
});
test("private pending fulfilment → does not qualify", () => {
  assert(!isQualifyingOrder({ status: "approved", cancelled_at: null, access_type: "private", fulfilment_status: "pending" }), "no");
});
test("private fulfilled → qualifies", () => {
  assert(isQualifyingOrder({ status: "approved", cancelled_at: null, access_type: "private", fulfilment_status: "active" }), "qualifies");
});

test("verified source: paystack default, offline when origin=offline", () => {
  assert(reviewSourceFor(null) === "paystack", "default");
  assert(reviewSourceFor("paystack") === "paystack", "paystack");
  assert(reviewSourceFor("offline") === "offline", "offline");
});

// ---------- Refund exclusion ----------

test("refunded payment_status marks refund", () => {
  assert(isRefundPayment({ payment_status: "refunded" }), "refunded");
  assert(isRefundPayment({ payment_status: "reversed" }), "reversed");
  assert(isRefundPayment({ payment_status: "successful", reconciliation_status: "refunded" }), "reconciliation");
  assert(!isRefundPayment({ payment_status: "successful", reconciliation_status: "resolved" }), "clean");
});

test("refunded order removed from qualifying set", () => {
  const orders = [{ id: "o1" }, { id: "o2" }, { id: "o3" }];
  const kept = filterRefundedOrders(orders, new Set(["o2"]));
  assert(kept.length === 2 && kept.every((o) => o.id !== "o2"), "excluded");
});

test("refunded first purchase → no eligibility", () => {
  // Simulated: one qualifying order, but it's refunded → filter drops it → count 0.
  const qualifying = filterRefundedOrders([{ id: "o1" }], new Set(["o1"]));
  const g = deriveReviewGate({ qualifyingCount: qualifying.length, currentVersion: null });
  assert(!g.canReview && !g.canEdit, "not eligible");
});

test("refunded repurchase does not unlock update", () => {
  // Original purchase o1 valid (submitted review). Repurchase o2 refunded → still locked.
  const kept = filterRefundedOrders([{ id: "o1" }, { id: "o2" }], new Set(["o2"]));
  const g = deriveReviewGate({ qualifyingCount: kept.length, currentVersion: 1 });
  assert(!g.canEdit, "still locked");
});

// ---------- Safety ----------

test("blocks emails", () => {
  const r = checkReviewSafety({ title: "Great tool", body: "Contact me at a@b.com please" });
  assert(!r.ok, "blocked");
});
test("blocks phone numbers", () => {
  const r = checkReviewSafety({ title: "Great tool", body: "Call me on +2348012345678 anytime" });
  assert(!r.ok, "blocked");
});
test("blocks URLs", () => {
  const r = checkReviewSafety({ title: "Great tool", body: "See https://spam.example for more" });
  assert(!r.ok, "blocked");
});
test("blocks credential leaks", () => {
  const r = checkReviewSafety({ title: "Nice", body: "The password was included so I could log in" });
  assert(!r.ok, "blocked");
});
test("blocks payment info", () => {
  const r = checkReviewSafety({ title: "Nice", body: "My card 4111111111111111 worked" });
  assert(!r.ok, "blocked");
});
test("blocks abusive language", () => {
  const r = checkReviewSafety({ title: "Awful", body: "This is total shit" });
  assert(!r.ok, "blocked");
});
test("accepts a normal review", () => {
  const r = checkReviewSafety({ title: "Good value", body: "Worked well for my writing tasks, delivery was quick." });
  assert(r.ok, "accepted");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
