import {
  CUSTOMER_EMAIL_ADMIN_REJECTION,
  assertEmailCanBecomeNewAdmin,
  normalizeAdminEmail,
} from "../src/lib/admin-management.functions";

let passed = 0;
let failed = 0;

function assert(cond: unknown, msg: string) {
  if (cond) passed++;
  else {
    failed++;
    console.error("  ✗", msg);
  }
}

function test(name: string, fn: () => void) {
  console.log("• " + name);
  const before = failed;
  try {
    fn();
  } catch (err) {
    failed++;
    console.error("  ✗ threw:", err);
  }
  if (failed === before) console.log("  ✓ ok");
}

test("admin emails are normalized before lookup", () => {
  assert(normalizeAdminEmail(" New.Admin@Example.COM ") === "new.admin@example.com", "normalizes case and whitespace");
});

test("existing customer email is rejected for admin creation", () => {
  try {
    assertEmailCanBecomeNewAdmin({ id: "customer-id" });
    assert(false, "customer email should be rejected");
  } catch (err) {
    assert(err instanceof Error, "throws an Error");
    assert(err instanceof Error && err.message === CUSTOMER_EMAIL_ADMIN_REJECTION, "uses required rejection message");
  }
});

test("unused email can proceed to admin invitation", () => {
  assertEmailCanBecomeNewAdmin(null);
  assert(true, "unused email accepted");
});

if (failed) {
  console.error(`\n${passed} passed, ${failed} failed`);
  process.exit(1);
}

console.log(`\n${passed} passed, ${failed} failed`);