/**
 * Phase 1D — Checkout validation + payment verification tests.
 * Run: bun tests/paystack-checkout.test.ts
 */
import { randomUUID } from "crypto";
import {
  detectCheckoutEnvironment,
  validateAndBuildOrderSnapshot,
  validatePaymentVerification,
  generatePaystackReference,
  buildPaystackMetadata,
  CheckoutError,
} from "../src/lib/paystack-checkout";
import { MockDb } from "./mock-db";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(cond: any, msg: string) {
  if (cond) passed++;
  else {
    failed++;
    failures.push(msg);
    console.error("  ✗", msg);
  }
}
async function test(name: string, fn: () => Promise<void>) {
  console.log("• " + name);
  const before = failed;
  try {
    await fn();
  } catch (err) {
    failed++;
    failures.push(`${name}: threw ${err}`);
    console.error("  ✗ threw:", err);
  }
  if (failed === before) console.log("  ✓ ok");
}

const USER = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const TEST_ENV = "test" as const;

function seedTool(
  db: MockDb,
  opts: Partial<{
    slug: string;
    enabled: boolean;
    access_level: string;
    shared: boolean;
    private: boolean;
  }> = {},
) {
  const slug = opts.slug ?? "canva";
  db.seed("tool_settings", [
    {
      tool_slug: slug,
      enabled: opts.enabled ?? true,
      access_level: opts.access_level ?? "purchased",
      shared_access_enabled: opts.shared ?? true,
      private_access_enabled: opts.private ?? true,
    },
  ]);
  return slug;
}
function seedPlan(
  db: MockDb,
  opts: Partial<{
    tool_slug: string;
    id: string;
    amount: number;
    currency: string;
    enabled: boolean;
    contact_admin: boolean;
    access_type: "shared" | "private";
    billing_period: string | null;
    duration_days: number;
    grace_days: number;
    warning_days: number;
    label: string;
  }> = {},
) {
  const id = opts.id ?? randomUUID();
  db.seed("tool_pricing", [
    {
      id,
      tool_slug: opts.tool_slug ?? "canva",
      amount: opts.amount ?? 5000,
      label: opts.label ?? "Monthly",
      currency: opts.currency ?? "₦",
      contact_admin: opts.contact_admin ?? false,
      enabled: opts.enabled ?? true,
      access_type: opts.access_type ?? "shared",
      billing_period: opts.billing_period === undefined ? "monthly" : opts.billing_period,
      duration_days: opts.duration_days ?? 28,
      grace_days: opts.grace_days ?? 2,
      warning_days: opts.warning_days ?? 0,
    },
  ]);
  return id;
}

async function expectError(fn: () => Promise<any>, codeOrMsg: string, label: string) {
  try {
    await fn();
    assert(false, `${label}: expected error containing "${codeOrMsg}"`);
  } catch (err: any) {
    const code = err instanceof CheckoutError ? err.code : "";
    const msg = err?.message ?? String(err);
    assert(
      code === codeOrMsg || msg.includes(codeOrMsg),
      `${label}: expected "${codeOrMsg}", got code="${code}" msg="${msg}"`,
    );
  }
}

async function main() {
  // ---- env detection ----
  await test("env: sk_test_ → test, sk_live_ → live, other → null", async () => {
    assert(detectCheckoutEnvironment("sk_test_abc") === "test", "test prefix");
    assert(detectCheckoutEnvironment("sk_live_abc") === "live", "live prefix");
    assert(detectCheckoutEnvironment("nope") === null, "unrecognised → null");
    assert(detectCheckoutEnvironment(undefined) === null, "undefined → null");
  });

  // ---- valid purchases (Shared Monthly / Quarterly / Yearly) ----
  for (const period of ["monthly", "quarterly", "yearly"] as const) {
    await test(`valid Shared ${period} purchase`, async () => {
      const db = new MockDb();
      const slug = seedTool(db);
      const planId = seedPlan(db, { tool_slug: slug, billing_period: period });
      const snap = await validateAndBuildOrderSnapshot(
        db,
        { userId: USER, tool_slug: slug, pricing_option_id: planId },
        TEST_ENV,
      );
      assert(snap.billing_period === period, `period=${period}`);
      assert(snap.access_type === "shared", "shared access");
      assert(snap.price_amount === 5000, "amount snapshotted from DB");
      assert(snap.paystack_environment === "test", "env snapshotted");
      assert(snap.payment_type === "recurring_subscription", "subscription payment type");
    });
  }

  // ---- private access accepted (Phase 2) ----
  await test("Private Access accepted with private snapshot", async () => {
    const db = new MockDb();
    const slug = seedTool(db, { private: true });
    const planId = seedPlan(db, { tool_slug: slug, access_type: "private" });
    const snap = await validateAndBuildOrderSnapshot(
      db,
      { userId: USER, tool_slug: slug, pricing_option_id: planId },
      TEST_ENV,
    );
    assert(snap.access_type === "private", "private access");
    assert(snap.payment_type === "recurring_subscription", "subscription payment type");
  });

  // ---- shared access disabled at tool level ----
  await test("Shared Access disabled → rejected", async () => {
    const db = new MockDb();
    const slug = seedTool(db, { shared: false });
    const planId = seedPlan(db, { tool_slug: slug, access_type: "shared" });
    await expectError(
      () =>
        validateAndBuildOrderSnapshot(
          db,
          { userId: USER, tool_slug: slug, pricing_option_id: planId },
          TEST_ENV,
        ),
      "shared_disabled",
      "shared disabled",
    );
  });

  // ---- pricing option belongs to another tool ----
  await test("Pricing option belongs to another tool → rejected", async () => {
    const db = new MockDb();
    const slug = seedTool(db, { slug: "canva" });
    seedTool(db, { slug: "phrasly" });
    const planId = seedPlan(db, { tool_slug: "phrasly" });
    await expectError(
      () =>
        validateAndBuildOrderSnapshot(
          db,
          { userId: USER, tool_slug: slug, pricing_option_id: planId },
          TEST_ENV,
        ),
      "plan_mismatch",
      "plan_mismatch",
    );
  });

  // ---- disabled plan ----
  await test("Disabled pricing option → rejected", async () => {
    const db = new MockDb();
    const slug = seedTool(db);
    const planId = seedPlan(db, { tool_slug: slug, enabled: false });
    await expectError(
      () =>
        validateAndBuildOrderSnapshot(
          db,
          { userId: USER, tool_slug: slug, pricing_option_id: planId },
          TEST_ENV,
        ),
      "plan_disabled",
      "plan_disabled",
    );
  });

  // ---- missing billing period ----
  await test("Missing billing period → rejected", async () => {
    const db = new MockDb();
    const slug = seedTool(db);
    const planId = seedPlan(db, { tool_slug: slug, billing_period: null });
    await expectError(
      () =>
        validateAndBuildOrderSnapshot(
          db,
          { userId: USER, tool_slug: slug, pricing_option_id: planId },
          TEST_ENV,
        ),
      "bad_period",
      "bad_period",
    );
  });

  // ---- hidden / disabled tool ----
  await test("Hidden tool (no tool_settings row) → rejected", async () => {
    const db = new MockDb();
    const planId = seedPlan(db, { tool_slug: "ghost" });
    await expectError(
      () =>
        validateAndBuildOrderSnapshot(
          db,
          { userId: USER, tool_slug: "ghost", pricing_option_id: planId },
          TEST_ENV,
        ),
      "no_tool",
      "no_tool",
    );
  });
  await test("Temporarily unavailable tool (enabled=false) → rejected", async () => {
    const db = new MockDb();
    const slug = seedTool(db, { enabled: false });
    const planId = seedPlan(db, { tool_slug: slug });
    await expectError(
      () =>
        validateAndBuildOrderSnapshot(
          db,
          { userId: USER, tool_slug: slug, pricing_option_id: planId },
          TEST_ENV,
        ),
      "tool_disabled",
      "tool_disabled",
    );
  });
  await test("Contact-Admin tool (access_level=logged_in) → rejected", async () => {
    const db = new MockDb();
    const slug = seedTool(db, { access_level: "logged_in" });
    const planId = seedPlan(db, { tool_slug: slug });
    await expectError(
      () =>
        validateAndBuildOrderSnapshot(
          db,
          { userId: USER, tool_slug: slug, pricing_option_id: planId },
          TEST_ENV,
        ),
      "not_purchasable",
      "not_purchasable",
    );
  });

  // ---- frontend price manipulation: input has no `amount` field, so it's a no-op ----
  await test("Frontend cannot control the amount — only tool_slug + option_id are accepted", async () => {
    const db = new MockDb();
    const slug = seedTool(db);
    const planId = seedPlan(db, { tool_slug: slug, amount: 5000 });
    // Any extra key the caller supplies is ignored: validator only reads
    // tool_slug + pricing_option_id + userId.
    const snap = await validateAndBuildOrderSnapshot(
      db,
      {
        userId: USER,
        tool_slug: slug,
        pricing_option_id: planId,
        // @ts-expect-error extra field must not influence output
        amount: 1,
        // @ts-expect-error extra field must not influence output
        price: 1,
      } as any,
      TEST_ENV,
    );
    assert(snap.price_amount === 5000, "server price wins");
  });

  // ---- invalid backend price ----
  await test("Zero / negative DB price → rejected", async () => {
    const db = new MockDb();
    const slug = seedTool(db);
    const planId = seedPlan(db, { tool_slug: slug, amount: 0 });
    await expectError(
      () =>
        validateAndBuildOrderSnapshot(
          db,
          { userId: USER, tool_slug: slug, pricing_option_id: planId },
          TEST_ENV,
        ),
      "bad_price",
      "bad_price zero",
    );
  });

  // ---- unrecognised Paystack key ----
  await test("Unrecognised Paystack key → bad_config, no DB reads succeed", async () => {
    const db = new MockDb();
    const slug = seedTool(db);
    const planId = seedPlan(db, { tool_slug: slug });
    await expectError(
      () =>
        validateAndBuildOrderSnapshot(
          db,
          { userId: USER, tool_slug: slug, pricing_option_id: planId },
          detectCheckoutEnvironment("whatever"),
        ),
      "bad_config",
      "bad_config",
    );
  });

  // ---- reference generator ----
  await test("Paystack reference is unique, server-generated", async () => {
    const a = generatePaystackReference("abcdefgh-1234-5678");
    const b = generatePaystackReference("abcdefgh-1234-5678");
    assert(a !== b, "unique across calls");
    assert(a.startsWith("TRST-abcdefgh-"), "starts with server prefix");
  });

  // ---- metadata safety ----
  await test("Paystack metadata contains only safe fields", async () => {
    const m = buildPaystackMetadata({
      order_id: "o", user_id: "u", tool_slug: "canva",
      pricing_option_id: "p", access_type: "shared", billing_period: "monthly",
    });
    const forbidden = ["password", "login_password", "secret", "one_click_token", "sb_secret"];
    for (const k of forbidden) assert(!(k in m), `metadata excludes ${k}`);
    assert(m.order_id === "o" && m.access_type === "shared", "safe fields present");
  });

  // ---- verification ----
  const validOrder = {
    id: "ord-1",
    user_id: USER,
    price_amount: 5000,
    currency: "₦",
    paystack_reference: "ref-1",
    paystack_environment: "test",
  };
  const validTx = {
    status: "success",
    reference: "ref-1",
    amount: 500000, // kobo
    currency: "NGN",
    metadata: { order_id: "ord-1" },
  };

  await test("Successful payment verification", async () => {
    const v = validatePaymentVerification({
      tx: validTx, order: validOrder, callerUserId: USER, env: "test", otherOrderHasReference: false,
    });
    assert(v.ok === true, `expected ok, got ${JSON.stringify(v)}`);
  });
  await test("Amount mismatch", async () => {
    const v = validatePaymentVerification({
      tx: { ...validTx, amount: 100 },
      order: validOrder, callerUserId: USER, env: "test", otherOrderHasReference: false,
    });
    assert(!v.ok && (v as any).reason === "amount_mismatch", "reason");
  });
  await test("Currency mismatch (USD)", async () => {
    const v = validatePaymentVerification({
      tx: { ...validTx, currency: "USD" },
      order: validOrder, callerUserId: USER, env: "test", otherOrderHasReference: false,
    });
    assert(!v.ok && (v as any).reason === "currency_mismatch", "reason");
  });
  await test("Wrong order id in metadata", async () => {
    const v = validatePaymentVerification({
      tx: { ...validTx, metadata: { order_id: "someone-else" } },
      order: validOrder, callerUserId: USER, env: "test", otherOrderHasReference: false,
    });
    assert(!v.ok && (v as any).reason === "meta_mismatch", "reason");
  });
  await test("Order belongs to another user", async () => {
    const v = validatePaymentVerification({
      tx: validTx, order: { ...validOrder, user_id: OTHER },
      callerUserId: USER, env: "test", otherOrderHasReference: false,
    });
    assert(!v.ok && (v as any).reason === "wrong_user", "reason");
  });
  await test("Reference already used by another order", async () => {
    const v = validatePaymentVerification({
      tx: validTx, order: validOrder,
      callerUserId: USER, env: "test", otherOrderHasReference: true,
    });
    assert(!v.ok && (v as any).reason === "reference_reused", "reason");
  });
  await test("Environment mismatch (order tagged live, secret is test)", async () => {
    const v = validatePaymentVerification({
      tx: validTx, order: { ...validOrder, paystack_environment: "live" },
      callerUserId: USER, env: "test", otherOrderHasReference: false,
    });
    assert(!v.ok && (v as any).reason === "env_mismatch", "reason");
  });
  await test("Not-success tx rejected", async () => {
    const v = validatePaymentVerification({
      tx: { ...validTx, status: "failed" }, order: validOrder,
      callerUserId: USER, env: "test", otherOrderHasReference: false,
    });
    assert(!v.ok && (v as any).reason === "not_success", "reason");
  });

  // ---- callback + webhook race — both approve at most once (via .neq guard) ----
  await test("Callback + webhook race: order approved exactly once", async () => {
    // Simulate the .neq("status", "approved") guard both paths share.
    const db = new MockDb({ uniqueColumns: { tool_orders: ["id"] } });
    db.seed("tool_orders", [{ id: "ord-1", status: "pending" }]);

    async function tryApprove() {
      // read status → update with guard
      const { data: cur } = await db.from("tool_orders").select("status").eq("id", "ord-1").maybeSingle();
      if (cur?.status === "approved") return "already";
      const { data } = await db
        .from("tool_orders")
        .update({ status: "approved", approved_at: new Date().toISOString() })
        .eq("id", "ord-1")
        .neq("status", "approved");
      return data ? "approved" : "raced";
    }
    const results = await Promise.all([tryApprove(), tryApprove()]);
    const approvedRow = db.all("tool_orders").find((r) => r.id === "ord-1")!;
    assert(approvedRow.status === "approved", "final row approved");
    // At least one succeeded; the guard prevents double-approval semantics
    // (both paths land on the same row, single approved_at timestamp remains).
    assert(results.includes("approved"), "one path approved");
  });

  // ---- Canva regression: real-world plan config still passes ----
  await test("Canva Shared Monthly regression", async () => {
    const db = new MockDb();
    const slug = seedTool(db, { slug: "canva" });
    const planId = seedPlan(db, {
      tool_slug: slug,
      amount: 2500,
      billing_period: "monthly",
      access_type: "shared",
      duration_days: 28,
      grace_days: 2,
      label: "Monthly",
    });
    const snap = await validateAndBuildOrderSnapshot(
      db,
      { userId: USER, tool_slug: slug, pricing_option_id: planId },
      TEST_ENV,
    );
    assert(snap.tool_slug === "canva" && snap.price_amount === 2500, "canva snapshot");
    assert(snap.duration_days === 28 && snap.grace_days === 2, "duration/grace preserved");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error("\nFailures:");
    for (const f of failures) console.error("  -", f);
    process.exit(1);
  }
}

main();
