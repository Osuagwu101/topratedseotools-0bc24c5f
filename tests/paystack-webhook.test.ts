/**
 * Executable Paystack webhook tests. No live Paystack calls, no real DB.
 * Run: bun tests/paystack-webhook.test.ts
 */
import { createHmac } from "crypto";
import { handlePaystackWebhook, detectEnvironmentStrict } from "../src/lib/paystack-webhook";
import { MockDb } from "./mock-db";

const TEST_SECRET = "sk_test_0123456789abcdef";
const LIVE_SECRET = "sk_live_0123456789abcdef";
const BAD_SECRET = "whatever_not_a_paystack_key";

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

function sign(secret: string, body: string): string {
  return createHmac("sha512", secret).update(body).digest("hex");
}

function makeRequest(body: string, secret: string, opts: { badSig?: boolean } = {}) {
  const sig = opts.badSig ? "deadbeef" : sign(secret, body);
  return new Request("http://localhost/api/public/webhooks/paystack", {
    method: "POST",
    headers: { "x-paystack-signature": sig, "content-type": "application/json" },
    body,
  });
}

function chargeSuccessBody(orderId: string, reference = "ref_" + orderId.slice(0, 8)) {
  return JSON.stringify({
    event: "charge.success",
    data: {
      reference,
      status: "success",
      amount: 500000,
      metadata: { order_id: orderId },
    },
  });
}

function freshDb() {
  return new MockDb({
    uniqueColumns: {
      paystack_webhook_events: ["idempotency_key"],
      tool_orders: ["id"],
    },
  });
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

async function main() {
  // 0. Environment detection unit
  await test("env detection: sk_test_ / sk_live_ / other", async () => {
    assert(detectEnvironmentStrict(TEST_SECRET) === "test", "test prefix → 'test'");
    assert(detectEnvironmentStrict(LIVE_SECRET) === "live", "live prefix → 'live'");
    assert(detectEnvironmentStrict(BAD_SECRET) === null, "bad prefix → null (no legacy)");
  });

  // 1. Valid signed charge.success
  await test("valid signed charge.success approves order + records processed", async () => {
    const db = freshDb();
    const orderId = "order-1";
    db.seed("tool_orders", [{ id: orderId, status: "pending", duration_days: 28, grace_days: 2 }]);
    const body = chargeSuccessBody(orderId);
    const res = await handlePaystackWebhook(makeRequest(body, TEST_SECRET), {
      secret: TEST_SECRET,
      supabaseAdmin: db,
    });
    assert(res.status === 200, `status 200 (got ${res.status})`);
    const order = db.all("tool_orders")[0];
    assert(order.status === "approved", "order.status = approved");
    assert(!!order.paid_at, "order.paid_at set");
    assert(!!order.expires_at, "order.expires_at set");
    const evt = db.all("paystack_webhook_events")[0];
    assert(evt.processing_status === "processed", "event processed");
    assert(evt.paystack_environment === "test", "env tagged 'test'");
  });

  // 2. Invalid signature
  await test("invalid signature → 401, no DB writes", async () => {
    const db = freshDb();
    db.seed("tool_orders", [{ id: "o", status: "pending", duration_days: 28, grace_days: 0 }]);
    const body = chargeSuccessBody("o");
    const res = await handlePaystackWebhook(makeRequest(body, TEST_SECRET, { badSig: true }), {
      secret: TEST_SECRET,
      supabaseAdmin: db,
    });
    assert(res.status === 401, `status 401 (got ${res.status})`);
    assert(db.all("paystack_webhook_events").length === 0, "no event recorded");
    assert(db.all("tool_orders")[0].status === "pending", "order unchanged");
  });

  // 3. Sequential duplicate
  await test("sequential duplicate → 200, order not re-approved, single event row", async () => {
    const db = freshDb();
    db.seed("tool_orders", [{ id: "o3", status: "pending", duration_days: 28, grace_days: 0 }]);
    const body = chargeSuccessBody("o3");
    const r1 = await handlePaystackWebhook(makeRequest(body, TEST_SECRET), {
      secret: TEST_SECRET,
      supabaseAdmin: db,
    });
    const firstApprovedAt = db.all("tool_orders")[0].approved_at;
    const r2 = await handlePaystackWebhook(makeRequest(body, TEST_SECRET), {
      secret: TEST_SECRET,
      supabaseAdmin: db,
    });
    assert(r1.status === 200 && r2.status === 200, "both 200");
    assert(db.all("paystack_webhook_events").length === 1, "one event row (idempotent)");
    assert(
      db.all("tool_orders")[0].approved_at === firstApprovedAt,
      "approved_at unchanged on duplicate",
    );
  });

  // 4. Concurrent duplicate (simulated: mark existing as 'processing' before 2nd call)
  await test("concurrent duplicate → 200, no double-approval", async () => {
    const db = freshDb();
    db.seed("tool_orders", [{ id: "o4", status: "pending", duration_days: 28, grace_days: 0 }]);
    const body = chargeSuccessBody("o4");
    // Pre-seed an event row already in 'processing' with matching key
    const { buildIdempotencyKey } = await import("../src/lib/paystack-webhook");
    const key = buildIdempotencyKey({
      event: "charge.success",
      env: "test",
      reference: "ref_o4",
      status: "success",
    });
    db.seed("paystack_webhook_events", [
      {
        id: "evt-existing",
        idempotency_key: key,
        processing_status: "processing",
        processing_attempts: 1,
      },
    ]);
    const res = await handlePaystackWebhook(makeRequest(body, TEST_SECRET), {
      secret: TEST_SECRET,
      supabaseAdmin: db,
    });
    assert(res.status === 200, `status 200 (got ${res.status})`);
    assert(db.all("tool_orders")[0].status === "pending", "order not approved by concurrent dup");
    assert(db.all("paystack_webhook_events").length === 1, "no duplicate event row");
  });

  // 5. Failed processing followed by retry
  await test("failed → retry approves order and marks processed", async () => {
    const db = freshDb();
    db.seed("tool_orders", [{ id: "o5", status: "pending", duration_days: 28, grace_days: 0 }]);
    const body = chargeSuccessBody("o5");
    const { buildIdempotencyKey } = await import("../src/lib/paystack-webhook");
    const key = buildIdempotencyKey({
      event: "charge.success",
      env: "test",
      reference: "ref_o5",
      status: "success",
    });
    db.seed("paystack_webhook_events", [
      {
        id: "evt-failed",
        idempotency_key: key,
        processing_status: "failed",
        processing_attempts: 1,
        last_error: "prior error",
      },
    ]);
    const res = await handlePaystackWebhook(makeRequest(body, TEST_SECRET), {
      secret: TEST_SECRET,
      supabaseAdmin: db,
    });
    assert(res.status === 200, "status 200");
    const evt = db.all("paystack_webhook_events")[0];
    assert(evt.processing_status === "processed", "retry marked processed");
    assert(
      evt.processing_attempts === 2,
      `attempts incremented to 2 (got ${evt.processing_attempts})`,
    );
    assert(evt.last_error === null, "last_error cleared");
    assert(db.all("tool_orders")[0].status === "approved", "order now approved");
  });

  // 6. Unknown order → 200, event recorded failed with reconciliation message
  await test("unknown order → 200 + event failed for reconciliation", async () => {
    const db = freshDb();
    const body = chargeSuccessBody("does-not-exist");
    const res = await handlePaystackWebhook(makeRequest(body, TEST_SECRET), {
      secret: TEST_SECRET,
      supabaseAdmin: db,
    });
    assert(res.status === 200, `status 200 (got ${res.status}) — not 404`);
    const evt = db.all("paystack_webhook_events")[0];
    assert(!!evt, "event row recorded");
    assert(evt.processing_status === "failed", "event marked failed");
    assert(
      evt.last_error === "No matching tool order found",
      `last_error surfaces reconciliation (got: ${evt.last_error})`,
    );
    assert(db.all("tool_orders").length === 0, "no phantom order created");
  });

  // 7. Already-approved order → not re-approved
  await test("already-approved order → not mutated", async () => {
    const db = freshDb();
    const approvedAt = "2026-01-01T00:00:00.000Z";
    db.seed("tool_orders", [
      {
        id: "o7",
        status: "approved",
        approved_at: approvedAt,
        paid_at: approvedAt,
        duration_days: 28,
        grace_days: 0,
      },
    ]);
    const body = chargeSuccessBody("o7");
    const res = await handlePaystackWebhook(makeRequest(body, TEST_SECRET), {
      secret: TEST_SECRET,
      supabaseAdmin: db,
    });
    assert(res.status === 200, "status 200");
    const order = db.all("tool_orders")[0];
    assert(order.approved_at === approvedAt, "approved_at unchanged");
    const evt = db.all("paystack_webhook_events")[0];
    assert(evt.processing_status === "processed", "event still marked processed");
  });

  // 8. Callback / webhook race — simulated by pre-approving the order
  //    between signature verify and business logic. The .neq guard means we
  //    do not mutate an already-approved order.
  await test("callback+webhook race → single approval, webhook stays 200", async () => {
    const db = freshDb();
    const approvedAt = "2026-02-02T00:00:00.000Z";
    db.seed("tool_orders", [
      {
        id: "o8",
        status: "approved", // callback already approved it
        approved_at: approvedAt,
        paid_at: approvedAt,
        duration_days: 28,
        grace_days: 0,
      },
    ]);
    const body = chargeSuccessBody("o8");
    const res = await handlePaystackWebhook(makeRequest(body, TEST_SECRET), {
      secret: TEST_SECRET,
      supabaseAdmin: db,
    });
    assert(res.status === 200, "status 200");
    assert(db.all("tool_orders")[0].approved_at === approvedAt, "no double approval");
  });

  // 9. Unrecognised secret-key prefix
  await test("unrecognised secret prefix → 503, no event, no order mutation", async () => {
    const db = freshDb();
    db.seed("tool_orders", [{ id: "o9", status: "pending", duration_days: 28, grace_days: 0 }]);
    // Body signed with BAD secret so signature check would pass IF we got that far.
    const body = chargeSuccessBody("o9");
    const res = await handlePaystackWebhook(makeRequest(body, BAD_SECRET), {
      secret: BAD_SECRET,
      supabaseAdmin: db,
    });
    assert(res.status === 503, `status 503 (got ${res.status})`);
    assert(db.all("paystack_webhook_events").length === 0, "no event row created");
    assert(db.all("tool_orders")[0].status === "pending", "order not modified");
  });

  console.log("");
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log("Failures:");
    for (const f of failures) console.log("  -", f);
    process.exit(1);
  }
}

main();
