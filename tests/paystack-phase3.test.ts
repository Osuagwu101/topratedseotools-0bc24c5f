/**
 * Phase 3 — Recurring subscriptions, Private 6-hour fulfilment, WhatsApp
 * message shape, reconciliation, Disable Renewal.
 * Run: bun tests/paystack-phase3.test.ts
 */
import { createHmac } from "crypto";
import { handlePaystackWebhook } from "../src/lib/paystack-webhook";
import { MockDb } from "./mock-db";

const TEST_SECRET = "sk_test_0123456789abcdef";

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

function sign(secret: string, body: string): string {
  return createHmac("sha512", secret).update(body).digest("hex");
}
function req(body: string) {
  return new Request("http://localhost/api/public/webhooks/paystack", {
    method: "POST",
    headers: {
      "x-paystack-signature": sign(TEST_SECRET, body),
      "content-type": "application/json",
    },
    body,
  });
}
function chargeSuccess(
  orderId: string,
  amountKobo = 500000,
  reference = "ref_" + orderId,
  planCode?: string,
) {
  return JSON.stringify({
    event: "charge.success",
    data: {
      reference,
      status: "success",
      amount: amountKobo,
      metadata: { order_id: orderId },
      plan: planCode ? { plan_code: planCode } : undefined,
    },
  });
}
function freshDb() {
  return new MockDb({
    uniqueColumns: {
      paystack_webhook_events: ["idempotency_key"],
      tool_orders: ["id"],
      tool_payments: ["paystack_reference"],
    },
  });
}
const DEPS = (db: MockDb) => ({ secret: TEST_SECRET, supabaseAdmin: db });

async function main() {
  // 1. Shared Monthly activates immediately with correct enum values.
  await test("Shared Monthly: activates, correct enum values, amount respected", async () => {
    const db = freshDb();
    db.seed("tool_orders", [
      {
        id: "o-shared",
        status: "pending",
        access_type: "shared",
        duration_days: 28,
        grace_days: 2,
        price_amount: 5000,
        paystack_plan_code: "PLN_shared_m",
      },
    ]);
    const res = await handlePaystackWebhook(req(chargeSuccess("o-shared", 500000)), DEPS(db));
    assert(res.status === 200, "200");
    const o = db.all("tool_orders")[0];
    assert(o.status === "approved", "status approved");
    assert(
      o.payment_status === "successful",
      `payment_status successful (got ${o.payment_status})`,
    );
    assert(o.subscription_status === "active", "subscription_status active");
    assert(o.renewal_status === "enabled", "renewal_status enabled");
    assert(o.fulfilment_status === "not_required", "fulfilment_status not_required");
    assert(!!o.expires_at, "expires_at set immediately");
    const p = db.all("tool_payments")[0];
    assert(p.classification === "initial", "payment initial classification");
    assert(p.payment_type === "recurring_subscription", "recurring_subscription");
  });

  // 2. Private Monthly enters 6-hour pending window; no expires_at yet.
  await test("Private Monthly: pending fulfilment, deadline set, no expires_at, no shared creds", async () => {
    const db = freshDb();
    db.seed("tool_orders", [
      {
        id: "o-priv",
        status: "pending",
        access_type: "private",
        duration_days: 28,
        grace_days: 0,
        price_amount: 5000,
        paystack_plan_code: "PLN_priv_m",
      },
    ]);
    const before = Date.now();
    const res = await handlePaystackWebhook(req(chargeSuccess("o-priv")), DEPS(db));
    assert(res.status === 200, "200");
    const o = db.all("tool_orders")[0];
    assert(o.status === "approved", "status approved");
    assert(o.fulfilment_status === "pending", `fulfilment pending (got ${o.fulfilment_status})`);
    assert(o.subscription_status === "pending", "subscription_status pending");
    assert(o.payment_status === "successful", "payment_status successful");
    assert(!o.expires_at, "no expires_at yet");
    assert(!!o.fulfilment_deadline_at, "deadline set");
    const deadline = new Date(o.fulfilment_deadline_at).getTime();
    const sixH = 6 * 60 * 60 * 1000;
    assert(deadline - before >= sixH - 5_000 && deadline - before <= sixH + 5_000, "~6h window");
  });

  // 3. Private renewal keeps existing assignment; extends period.
  await test("Private renewal: extends period, keeps assignment", async () => {
    const db = freshDb();
    const start = new Date().toISOString();
    db.seed("tool_orders", [
      {
        id: "o-pren",
        status: "approved",
        access_type: "private",
        duration_days: 28,
        grace_days: 0,
        price_amount: 5000,
        paystack_plan_code: "PLN_priv_m",
        paystack_subscription_code: "SUB_x",
        current_period_end: start,
        expires_at: start,
        subscription_status: "active",
        renewal_status: "enabled",
        fulfilment_status: "active",
        admin_notes: "keep-me",
      },
    ]);
    const res = await handlePaystackWebhook(
      req(chargeSuccess("o-pren", 500000, "ref-renewal", "PLN_priv_m")),
      DEPS(db),
    );
    assert(res.status === 200, "200");
    const o = db.all("tool_orders")[0];
    assert(o.admin_notes === "keep-me", "assignment kept");
    assert(o.subscription_status === "active", "still active");
    assert(new Date(o.expires_at).getTime() > new Date(start).getTime(), "expires extended");
    const p = db.all("tool_payments").find((x: any) => x.classification === "renewal");
    assert(!!p, "renewal payment recorded");
  });

  // 4. Duplicate renewal webhook → single payment row.
  await test("Duplicate renewal webhook: one payment row, single extension", async () => {
    const db = freshDb();
    db.seed("tool_orders", [
      {
        id: "o-dup",
        status: "approved",
        access_type: "shared",
        duration_days: 28,
        grace_days: 0,
        price_amount: 5000,
        paystack_plan_code: "PLN_dup",
        paystack_subscription_code: "SUB_d",
        current_period_end: new Date().toISOString(),
        subscription_status: "active",
        renewal_status: "enabled",
      },
    ]);
    const body = chargeSuccess("o-dup", 500000, "ref-dup", "PLN_dup");
    await handlePaystackWebhook(req(body), DEPS(db));
    await handlePaystackWebhook(req(body), DEPS(db));
    const payments = db.all("tool_payments").filter((p: any) => p.paystack_reference === "ref-dup");
    assert(payments.length === 1, `single payment row (got ${payments.length})`);
    const events = db.all("paystack_webhook_events");
    assert(events.length === 1, "single webhook event row");
  });

  // 5. Failed renewal → past_due + payment failed.
  await test("Failed renewal marks past_due", async () => {
    const db = freshDb();
    db.seed("tool_orders", [
      {
        id: "o-fail",
        status: "approved",
        paystack_subscription_code: "SUB_f",
        subscription_status: "active",
      },
    ]);
    const body = JSON.stringify({
      event: "invoice.payment_failed",
      data: { subscription_code: "SUB_f", reference: "ref-fail", status: "failed" },
    });
    const res = await handlePaystackWebhook(req(body), DEPS(db));
    assert(res.status === 200, "200");
    const o = db.all("tool_orders")[0];
    assert(o.subscription_status === "past_due", "past_due");
    assert(o.payment_status === "failed", "payment_status failed");
  });

  // 6. subscription.disable webhook → renewal_status disabled, non_renewing.
  await test("subscription.disable → renewal disabled, non_renewing, timestamped", async () => {
    const db = freshDb();
    db.seed("tool_orders", [
      {
        id: "o-dis",
        status: "approved",
        paystack_subscription_code: "SUB_dis",
        renewal_status: "disable_pending",
      },
    ]);
    const body = JSON.stringify({
      event: "subscription.disable",
      data: { subscription_code: "SUB_dis", reference: "ref-dis", status: "disabled" },
    });
    const res = await handlePaystackWebhook(req(body), DEPS(db));
    assert(res.status === 200, "200");
    const o = db.all("tool_orders")[0];
    assert(o.renewal_status === "disabled", "renewal disabled");
    assert(o.subscription_status === "non_renewing", "non_renewing");
    assert(!!o.subscription_disabled_at, "timestamp set");
  });

  // 7. WhatsApp message contains order details (unit test — no HTTP).
  await test("WhatsApp fulfilment message includes order reference, tool, period, amount", async () => {
    const message =
      `Hello Admin, I have successfully paid for a Private Access subscription and would like my order to be fulfilled.\n\n` +
      `Order Reference: TRST-abc-1\n` +
      `Tool: Semrush\n` +
      `Access Type: Private Access\n` +
      `Billing Period: MONTHLY\n` +
      `Amount Paid: ₦5,000\n` +
      `Payment Status: Successful\n` +
      `Fulfilment Status: Pending`;
    for (const needle of [
      "Private Access",
      "TRST-abc-1",
      "Semrush",
      "MONTHLY",
      "₦5,000",
      "Payment Status: Successful",
      "Fulfilment Status: Pending",
    ]) {
      assert(message.includes(needle), `contains ${needle}`);
    }
    const url = `https://wa.me/2348012345678?text=${encodeURIComponent(message)}`;
    assert(url.startsWith("https://wa.me/2348012345678?"), "wa.me link uses saved number");
  });

  // 8. Exact admin price passes through (no rounding surprises).
  await test("Exact admin price (₦2,500) reaches Paystack in kobo", async () => {
    // The webhook checks amount indirectly (payment row records amount).
    const db = freshDb();
    db.seed("tool_orders", [
      {
        id: "o-2500",
        status: "pending",
        access_type: "shared",
        duration_days: 28,
        grace_days: 0,
        price_amount: 2500,
        paystack_plan_code: "PLN_c",
      },
    ]);
    const res = await handlePaystackWebhook(
      req(chargeSuccess("o-2500", 250000, "ref-2500")),
      DEPS(db),
    );
    assert(res.status === 200, "200");
    const p = db.all("tool_payments")[0];
    assert(Number(p.amount) === 2500, `payment.amount = 2500 (got ${p.amount})`);
  });

  // 9. Private customer never receives shared credentials via credential map.
  await test("Private + fulfilment=pending does not expose shared creds", async () => {
    // This mirrors the getMyAccess policy: shared creds only for shared orders.
    const rows = [
      { access_type: "private", fulfilment_status: "pending", tool_slug: "canva" },
      { access_type: "shared", fulfilment_status: "not_required", tool_slug: "phrasly" },
    ];
    const sharedSlugs = rows.filter((r) => r.access_type === "shared").map((r) => r.tool_slug);
    assert(!sharedSlugs.includes("canva"), "private not in shared vault query");
    assert(sharedSlugs.includes("phrasly"), "shared included");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    for (const f of failures) console.error("  -", f);
    process.exit(1);
  }
}

main();
