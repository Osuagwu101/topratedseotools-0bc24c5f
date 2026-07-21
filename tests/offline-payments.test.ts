/**
 * Unit tests for offline / admin-entered payment helpers.
 * Covers access-window math, period-day mapping, and duplicate detection.
 */
import {
  PERIOD_DAYS,
  computeAccessWindow,
  findOfflineDuplicates,
} from "../src/lib/customer-admin.functions";

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) passed++;
  else { failed++; console.error("  ✗", msg); }
}
function test(name: string, fn: () => void) {
  console.log("• " + name);
  const before = failed;
  try { fn(); } catch (err) { failed++; console.error("  ✗ threw:", err); }
  if (failed === before) console.log("  ✓ ok");
}

test("period days: monthly=28, quarterly=90, yearly=365", () => {
  assert(PERIOD_DAYS.monthly === 28, "monthly");
  assert(PERIOD_DAYS.quarterly === 90, "quarterly");
  assert(PERIOD_DAYS.yearly === 365, "yearly");
});

test("access window computes end = start + duration", () => {
  const start = "2026-01-01T00:00:00.000Z";
  const m = computeAccessWindow({ startDate: start, period: "monthly" });
  assert(m.durationDays === 28, "duration");
  assert(m.end.toISOString() === "2026-01-29T00:00:00.000Z", "monthly end");
  const y = computeAccessWindow({ startDate: start, period: "yearly" });
  assert(y.end.toISOString() === "2027-01-01T00:00:00.000Z", "yearly end");
});

test("duplicate detection matches same user+tool+amount ±1 day", () => {
  const existing = [
    { id: "a", user_id: "u1", tool_slug: "quillbot", amount: 200, paid_at: "2026-01-05T10:00:00Z", reference_note: null },
  ];
  const d = findOfflineDuplicates(existing, {
    user_id: "u1", tool_slug: "quillbot", amount: 200, paid_at: "2026-01-05T15:00:00Z",
  });
  assert(d.length === 1, "same-day dup");
  const d2 = findOfflineDuplicates(existing, {
    user_id: "u1", tool_slug: "quillbot", amount: 200, paid_at: "2026-01-10T10:00:00Z",
  });
  assert(d2.length === 0, "different day, no dup");
  const d3 = findOfflineDuplicates(existing, {
    user_id: "u2", tool_slug: "quillbot", amount: 200, paid_at: "2026-01-05T15:00:00Z",
  });
  assert(d3.length === 0, "different user, no dup");
});

test("duplicate detection matches on same non-empty reference", () => {
  const existing = [
    { id: "a", user_id: "u1", tool_slug: "quillbot", amount: 200, paid_at: "2026-01-01T00:00:00Z", reference_note: "TXN-77" },
  ];
  const dup = findOfflineDuplicates(existing, {
    user_id: "u1", tool_slug: "quillbot", amount: 200, paid_at: "2026-06-01T00:00:00Z", reference_note: "TXN-77",
  });
  assert(dup.length === 1, "ref match");
  const notDup = findOfflineDuplicates(existing, {
    user_id: "u1", tool_slug: "quillbot", amount: 200, paid_at: "2026-06-01T00:00:00Z", reference_note: "",
  });
  assert(notDup.length === 0, "empty ref does not match");
});

test("amount mismatch is not a duplicate", () => {
  const existing = [
    { id: "a", user_id: "u1", tool_slug: "quillbot", amount: 200, paid_at: "2026-01-01T00:00:00Z", reference_note: null },
  ];
  const d = findOfflineDuplicates(existing, {
    user_id: "u1", tool_slug: "quillbot", amount: 500, paid_at: "2026-01-01T00:00:00Z",
  });
  assert(d.length === 0, "different amount, no dup");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
