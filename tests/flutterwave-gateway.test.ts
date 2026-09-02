/**
 * Flutterwave gateway — end-to-end simulation (vitest).
 *
 * Covers the Ghana Mobile Money journey with no live Flutterwave calls:
 * checkout initialization (GHS charged natively + mobile-money channel),
 * webhook hash verification, duplicate-event safety, order approval,
 * and payment-record stamping (gateway, transaction id, currency, metadata).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { flutterwaveAdapter } from "../src/lib/gateways/flutterwave";
import { handlePaystackWebhook } from "../src/lib/paystack-webhook";
import { buildPricingBreakdown, resolveChargePlan } from "../src/lib/currency-convert";
import { MockDb } from "./mock-db";

const SECRET = "FLWSECK_TEST-0123456789abcdef-X";
const HASH = "flw-webhook-hash-abc123";

function freshDb() {
  return new MockDb({
    uniqueColumns: {
      paystack_webhook_events: ["idempotency_key"],
      tool_orders: ["id"],
    },
  });
}

function webhookRequest(body: string, hash: string | null) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (hash) headers["verif-hash"] = hash;
  return new Request("http://localhost/api/public/webhooks/flutterwave", {
    method: "POST",
    headers,
    body,
  });
}

function successBody(orderId: string, reference: string, amountMajor = 120.5, currency = "GHS") {
  return JSON.stringify({
    event: "charge.completed",
    data: {
      id: 998877,
      tx_ref: reference,
      status: "successful",
      amount: amountMajor,
      currency,
      payment_type: "mobilemoneygh",
      meta: { order_id: orderId, user_id: "user-1", payment_currency: currency },
    },
  });
}

describe("Flutterwave gateway", () => {
  beforeEach(() => {
    process.env.FLUTTERWAVE_SECRET_KEY = SECRET;
    process.env.FLUTTERWAVE_WEBHOOK_HASH = HASH;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports configuration and environment from the secret key", () => {
    expect(flutterwaveAdapter.isConfigured()).toBe(true);
    expect(flutterwaveAdapter.environment()).toBe("test");
    expect(flutterwaveAdapter.supportsRecurring).toBe(false);
  });

  it("charges GHS natively (no NGN fallback) with the coupon + surcharge pipeline intact", () => {
    const breakdown = buildPricingBreakdown({
      ngn: 20000,
      currency: "GHS",
      rate: 0.0095,
      surchargePercent: 3,
      surchargeEnabled: true,
      discount: { type: "percent", value: 10, code: "SAVE10" },
    });
    const charge = resolveChargePlan(breakdown, flutterwaveAdapter.chargeCurrencies);
    expect(breakdown.discount_amount_ngn).toBe(2000);
    expect(charge.fallback_applied).toBe(false);
    expect(charge.payment_currency).toBe("GHS");
    expect(charge.payment_amount).toBe(breakdown.final_amount);
    expect(charge.payment_minor_units).toBe(breakdown.minor_units_amount);
  });

  it("offers Ghana Mobile Money first when initializing a GHS payment", async () => {
    const calls: { url: string; body: any }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init.body)) });
      return new Response(
        JSON.stringify({
          status: "success",
          message: "ok",
          data: { link: "https://checkout.flutterwave.com/pay/abc" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });

    const res = await flutterwaveAdapter.initialize({
      reference: "TRST-order1-1",
      amountMinor: 12050,
      currency: "GHS",
      email: "smartmove1914@gmail.com",
      callbackUrl: "https://topratedseotools.com/order/seo-tool?reference=TRST-order1-1",
      customerName: "Test Customer",
      description: "seo-tool · shared monthly",
      metadata: { order_id: "order1", user_id: "user-1" },
    });

    expect(res.authorization_url).toContain("checkout.flutterwave.com");
    expect(res.reference).toBe("TRST-order1-1");
    const sent = calls[0]!.body;
    expect(calls[0]!.url).toBe("https://api.flutterwave.com/v3/payments");
    expect(sent.currency).toBe("GHS");
    expect(sent.amount).toBe(120.5);
    expect(String(sent.payment_options).split(",")[0]).toBe("mobilemoneyghana");
    expect(sent.meta.order_id).toBe("order1");
  });

  it("verifies a transaction and normalises amounts to minor units", async () => {
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response(
          JSON.stringify({
            status: "success",
            data: {
              id: 998877,
              tx_ref: "TRST-order1-1",
              status: "successful",
              amount: 120.5,
              currency: "GHS",
              payment_type: "mobilemoneygh",
              meta: { order_id: "order1" },
              customer: { email: "smartmove1914@gmail.com" },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    const tx = await flutterwaveAdapter.verify("TRST-order1-1");
    expect(tx.status).toBe("success");
    expect(tx.amount).toBe(12050);
    expect(tx.currency).toBe("GHS");
    expect(tx.id).toBe(998877);
    expect(tx.channel).toBe("mobilemoneygh");
  });

  it("rejects webhooks with a missing or wrong verif-hash", async () => {
    const db = freshDb();
    db.seed("tool_orders", [{ id: "o1", status: "pending", duration_days: 28, grace_days: 0 }]);
    for (const hash of [null, "wrong-hash-value-xxxxx"]) {
      const res = await handlePaystackWebhook(webhookRequest(successBody("o1", "ref-o1"), hash), {
        secret: undefined,
        supabaseAdmin: db,
        adapter: flutterwaveAdapter,
      });
      expect(res.status).toBe(401);
    }
    expect(db.all("paystack_webhook_events").length).toBe(0);
    expect(db.all("tool_orders")[0].status).toBe("pending");
  });

  it("approves the order and stamps Flutterwave on the payment record", async () => {
    const db = freshDb();
    db.seed("tool_orders", [
      {
        id: "o2",
        user_id: "user-1",
        tool_slug: "seo-tool",
        access_type: "shared",
        status: "pending",
        duration_days: 28,
        grace_days: 0,
        payment_currency: "GHS",
      },
    ]);
    const body = successBody("o2", "TRST-o2-1");
    const res = await handlePaystackWebhook(webhookRequest(body, HASH), {
      secret: undefined,
      supabaseAdmin: db,
      adapter: flutterwaveAdapter,
    });
    expect(res.status).toBe(200);

    const order = db.all("tool_orders")[0];
    expect(order.status).toBe("approved");
    expect(order.paid_at).toBeTruthy();

    const evt = db.all("paystack_webhook_events")[0];
    expect(evt.gateway).toBe("flutterwave");
    expect(evt.processing_status).toBe("processed");

    const payment = db.all("tool_payments")[0];
    expect(payment).toBeTruthy();
    expect(payment.payment_gateway).toBe("flutterwave");
    expect(payment.source).toBe("flutterwave");
    expect(payment.gateway_transaction_reference).toBe("998877");
    expect(payment.paystack_reference).toBe("TRST-o2-1");
    expect(payment.payment_status).toBe("successful");
  });

  it("handles duplicate webhook deliveries safely", async () => {
    const db = freshDb();
    db.seed("tool_orders", [
      {
        id: "o3",
        user_id: "user-1",
        tool_slug: "seo-tool",
        status: "pending",
        duration_days: 28,
        grace_days: 0,
      },
    ]);
    const body = successBody("o3", "TRST-o3-1");
    const first = await handlePaystackWebhook(webhookRequest(body, HASH), {
      secret: undefined,
      supabaseAdmin: db,
      adapter: flutterwaveAdapter,
    });
    const approvedAt = db.all("tool_orders")[0].approved_at;
    const second = await handlePaystackWebhook(webhookRequest(body, HASH), {
      secret: undefined,
      supabaseAdmin: db,
      adapter: flutterwaveAdapter,
    });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(db.all("paystack_webhook_events").length).toBe(1);
    expect(db.all("tool_payments").length).toBe(1);
    expect(db.all("tool_orders")[0].approved_at).toBe(approvedAt);
  });

  it("ignores pending/failed events without approving access", async () => {
    const db = freshDb();
    db.seed("tool_orders", [{ id: "o4", status: "pending", duration_days: 28, grace_days: 0 }]);
    const pending = JSON.stringify({
      event: "charge.completed",
      data: {
        tx_ref: "TRST-o4-1",
        status: "pending",
        amount: 10,
        currency: "GHS",
        meta: { order_id: "o4" },
      },
    });
    const res = await handlePaystackWebhook(webhookRequest(pending, HASH), {
      secret: undefined,
      supabaseAdmin: db,
      adapter: flutterwaveAdapter,
    });
    expect(res.status).toBe(200);
    expect(db.all("tool_orders")[0].status).toBe("pending");
  });
});
