/**
 * Paystack webhook handler — recurring-billing aware (Phase 3).
 *
 * Enum values here MUST match the DB CHECK constraints:
 *   payment_type       : recurring_subscription
 *   payment_status     : pending | processing | successful | failed
 *   subscription_status: pending | active | past_due | non_renewing | cancelled | expired | suspended
 *   renewal_status     : not_applicable | enabled | disable_pending | disabled
 *   fulfilment_status  : not_required | pending | active | failed | expired
 *   classification     : initial | renewal | one_time | refund | reversal
 *
 * Handled events (each has its own idempotency key so replays are safe):
 *  - charge.success         — first payment OR renewal payment
 *  - subscription.create    — Paystack created a subscription for this order
 *  - subscription.disable   — auto-renewal was disabled
 *  - subscription.not_renew — subscription will not renew at period end
 *  - invoice.payment_failed — a renewal attempt failed
 *  - invoice.update / invoice.create — informational
 *
 * Private Access: first successful charge does NOT immediately grant access.
 * The order enters a 6-hour fulfilment window (`fulfilment_status='pending'`,
 * `fulfilment_deadline_at = paid_at + 6h`). Subscription-period timers only
 * start once the admin marks fulfilled OR the cron auto-fulfils after 6h.
 */
import { createHash, createHmac, timingSafeEqual } from "crypto";

export type Env = "test" | "live";

export interface WebhookDeps {
  secret: string | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseAdmin: any;
  /**
   * Non-Paystack gateway (Flutterwave, Monnify). When supplied, the adapter
   * verifies the signature and maps its payload onto the Paystack event
   * vocabulary, so order completion, access assignment, emails and
   * idempotency stay identical across gateways.
   */
  adapter?: {
    slug: string;
    environment(): Env | null;
    verifyWebhook(raw: string, headers: Headers): boolean;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    normalizeWebhook(payload: unknown): { event: string; data: any } | null;
  };
}


export function detectEnvironmentStrict(secret: string): Env | null {
  if (secret.startsWith("sk_test_")) return "test";
  if (secret.startsWith("sk_live_")) return "live";
  return null;
}

export function buildIdempotencyKey(input: {
  event: string;
  env: Env;
  reference: string;
  status: string;
}): string {
  const raw = `${input.event}:${input.env}:${input.reference}:${input.status}`;
  return createHash("sha256").update(raw).digest("hex");
}

function safeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.slice(0, 500);
}

const HANDLED_EVENTS = new Set([
  "charge.success",
  "charge.failed",
  "subscription.create",
  "subscription.disable",
  "subscription.not_renew",
  "invoice.payment_failed",
  "invoice.update",
  "invoice.create",
]);

const PRIVATE_FULFILMENT_WINDOW_MS = 6 * 60 * 60 * 1000;

export async function handlePaystackWebhook(
  request: Request,
  deps: WebhookDeps,
): Promise<Response> {
  const { secret, supabaseAdmin } = deps;

  if (!secret) return new Response("not configured", { status: 503 });

  const env = detectEnvironmentStrict(secret);
  if (!env) return new Response("server configuration error", { status: 503 });

  const { secret, supabaseAdmin, adapter } = deps;
  const gatewaySlug = adapter?.slug ?? "paystack";

  const raw = await request.text();
  let env: Env;

  if (adapter) {
    const detected = adapter.environment();
    if (!detected) return new Response("not configured", { status: 503 });
    if (!adapter.verifyWebhook(raw, request.headers)) {
      return new Response("invalid signature", { status: 401 });
    }
    env = detected;
  } else {
    if (!secret) return new Response("not configured", { status: 503 });
    const detected = detectEnvironmentStrict(secret);
    if (!detected) return new Response("server configuration error", { status: 503 });
    env = detected;
    const signature = request.headers.get("x-paystack-signature") ?? "";
    const expected = createHmac("sha512", secret).update(raw).digest("hex");
    const sig = Buffer.from(signature);
    const exp = Buffer.from(expected);
    if (sig.length !== exp.length || !timingSafeEqual(sig, exp)) {
      return new Response("invalid signature", { status: 401 });
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return new Response("bad json", { status: 400 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payload: any = adapter ? adapter.normalizeWebhook(parsed) : parsed;
  if (!payload) return new Response("ignored", { status: 200 });

  const eventType: string = payload?.event ?? "";
  if (!HANDLED_EVENTS.has(eventType)) {
    return new Response("ignored", { status: 200 });
  }

  const data = payload?.data ?? {};
  const reference: string | undefined = data.reference;
  const txStatus: string = data.status ?? "unknown";
  const orderId: string | undefined = data?.metadata?.order_id;
  const subscriptionCode: string | undefined =
    data.subscription_code ?? data?.subscription?.subscription_code;
  const customerCode: string | undefined = data?.customer?.customer_code;
  const planCode: string | undefined = data?.plan?.plan_code ?? data.plan_code;
  const invoiceCode: string | undefined = data.invoice_code;

  const naturalId =
    reference ?? invoiceCode ?? subscriptionCode ?? (orderId ? `order:${orderId}` : "");
  if (!naturalId) return new Response("no identifier", { status: 400 });


  const idempotencyKey = buildIdempotencyKey({
    event: eventType,
    env,
    reference: naturalId,
    status: txStatus,
  });
  const payloadHash = createHash("sha256").update(raw).digest("hex");

  const insertRes = await supabaseAdmin
    .from("paystack_webhook_events")
    .insert({
      idempotency_key: idempotencyKey,
      event_type: eventType,
      transaction_reference: reference ?? null,
      subscription_code: subscriptionCode ?? null,
      invoice_code: invoiceCode ?? null,
      paystack_environment: env,
      processing_status: "pending",
      payload_hash: payloadHash,
    })
    .select("id, processing_status")
    .maybeSingle();

  let eventId: string | null = insertRes.data?.id ?? null;

  if (insertRes.error) {
    const { data: existing } = await supabaseAdmin
      .from("paystack_webhook_events")
      .select("id, processing_status, processing_attempts")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (!existing) return new Response("db error", { status: 500 });
    if (existing.processing_status === "processed" || existing.processing_status === "skipped") {
      return new Response("ok", { status: 200 });
    }
    if (existing.processing_status === "processing") return new Response("ok", { status: 200 });
    eventId = existing.id;
  }
  if (!eventId) return new Response("db error", { status: 500 });

  const { data: current } = await supabaseAdmin
    .from("paystack_webhook_events")
    .select("processing_attempts")
    .eq("id", eventId)
    .maybeSingle();
  const nextAttempts = ((current?.processing_attempts as number) ?? 0) + 1;

  const { data: claimed, error: claimError } = await supabaseAdmin
    .from("paystack_webhook_events")
    .update({ processing_status: "processing", processing_attempts: nextAttempts })
    .eq("id", eventId)
    .in("processing_status", ["pending", "failed"])
    .select("id")
    .maybeSingle();
  if (claimError || !claimed) return new Response("ok", { status: 200 });

  try {
    const result = await dispatchEvent({
      supabaseAdmin,
      env,
      eventType,
      eventId,
      orderId,
      reference,
      planCode,
      subscriptionCode,
      customerCode,
      invoiceCode,
      data,
    });


    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (result && (result as any).alreadyFailed) {
      return new Response("ok", { status: 200 });
    }

    await supabaseAdmin
      .from("paystack_webhook_events")
      .update({
        processing_status: "processed",
        processed_at: new Date().toISOString(),
        last_error: null,
      })
      .eq("id", eventId);

    return new Response("ok", { status: 200 });
  } catch (err) {
    await supabaseAdmin
      .from("paystack_webhook_events")
      .update({ processing_status: "failed", last_error: safeError(err) })
      .eq("id", eventId);
    return new Response("processing failed", { status: 500 });
  }
}

interface DispatchInput {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseAdmin: any;
  env: Env;
  eventType: string;
  eventId: string;
  orderId?: string;
  reference?: string;
  planCode?: string;
  subscriptionCode?: string;
  customerCode?: string;
  invoiceCode?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
}


async function dispatchEvent(i: DispatchInput) {
  switch (i.eventType) {
    case "charge.success":
      return handleChargeSuccess(i);
    case "charge.failed":
      return handleChargeFailed(i);
    case "subscription.create":
      return handleSubscriptionCreate(i);
    case "subscription.disable":
    case "subscription.not_renew":
      return handleSubscriptionDisabled(i);
    case "invoice.payment_failed":
      return handleInvoiceFailed(i);
    case "invoice.update":
    case "invoice.create":
      return;
  }
}

/**
 * Payment vs. display money.
 * `charged*` = what Paystack actually took (merchant/settlement currency).
 * `display*` = what the customer selected and sees in receipts/emails.
 * Both fall back to the legacy NGN order price for pre-multi-currency rows.
 */
type CurrencyBearingOrder = {
  price_amount?: number | null;
  currency?: string | null;
  payment_currency?: string | null;
  final_amount_charged?: number | null;
  display_currency?: string | null;
  display_amount?: number | null;
};
function chargedAmount(order: CurrencyBearingOrder): number {
  return Number(order.final_amount_charged ?? order.price_amount) || 0;
}
function chargedCurrency(order: CurrencyBearingOrder): string {
  return (order.payment_currency ?? order.currency ?? "NGN").toUpperCase();
}
function displayAmountOf(order: CurrencyBearingOrder): number {
  return Number(order.display_amount ?? chargedAmount(order)) || 0;
}
function displayCurrencyOf(order: CurrencyBearingOrder): string {
  return (order.display_currency ?? chargedCurrency(order)).toUpperCase();
}

async function findOrder(i: DispatchInput) {
  const q = i.supabaseAdmin
    .from("tool_orders")
    .select(
      "id, user_id, tool_slug, status, duration_days, grace_days, warning_days, access_type, paystack_plan_code, paystack_subscription_code, paystack_reference, current_period_end, next_payment_at, expires_at, subscription_status, renewal_status, fulfilment_status, fulfilment_deadline_at, subscription_started_at, price_amount, currency, paystack_environment, payment_type, payment_currency, exchange_rate_snapshot, international_fee_amount, final_amount_charged, display_currency, display_amount, coupon_code, discount_amount_ngn, discounted_amount_ngn",
    );
  const { data } = i.orderId
    ? await q.eq("id", i.orderId).maybeSingle()
    : i.reference
      ? await q.eq("paystack_reference", i.reference).maybeSingle()
      : i.subscriptionCode
        ? await q.eq("paystack_subscription_code", i.subscriptionCode).maybeSingle()
        : { data: null };
  return data;
}

async function handleChargeSuccess(i: DispatchInput) {
  const order = await findOrder(i);
  if (!order) {
    await i.supabaseAdmin
      .from("paystack_webhook_events")
      .update({ processing_status: "failed", last_error: "No matching tool order found" })
      .eq("id", i.eventId);
    return { alreadyFailed: true } as const;
  }

  const paidAt = new Date();
  const dur = (order.duration_days as number) ?? 28;
  const grace = (order.grace_days as number) ?? 0;
  const access = ((order.access_type as string) ?? "shared") as "shared" | "private";
  const isOneTime = (order.payment_type as string) === "one_time";
  const isRenewal =
    !isOneTime &&
    order.status === "approved" &&
    !!order.paystack_plan_code &&
    (order.paystack_plan_code === i.planCode || !!order.paystack_subscription_code);

  // Record every successful charge in tool_payments — UPSERT by reference so
  // an "initiated" row from checkout advances to "successful" in place.
  if (i.reference) {
    const paystackChannel = (i.data as { channel?: string })?.channel ?? null;
    const paystackId = (i.data as { id?: string | number })?.id;
    const { data: dup } = await i.supabaseAdmin
      .from("tool_payments")
      .select("id, payment_status")
      .eq("paystack_reference", i.reference)
      .maybeSingle();
    if (dup) {
      if (dup.payment_status !== "successful") {
        await i.supabaseAdmin
          .from("tool_payments")
          .update({
            payment_status: "successful",
            paid_at: paidAt.toISOString(),
            paystack_status: "success",
            paystack_last_checked_at: paidAt.toISOString(),
            paystack_transaction_id: paystackId ? String(paystackId) : null,
            payment_channel: paystackChannel,
            classification: isOneTime ? "one_time" : isRenewal ? "renewal" : "initial",
            last_status_change_at: paidAt.toISOString(),
            payment_currency: chargedCurrency(order as CurrencyBearingOrder),
            currency: chargedCurrency(order as CurrencyBearingOrder),
            final_amount: chargedAmount(order as CurrencyBearingOrder),
            display_currency: displayCurrencyOf(order as CurrencyBearingOrder),
            display_amount: displayAmountOf(order as CurrencyBearingOrder),
            base_amount_ngn: order.discounted_amount_ngn ?? order.price_amount ?? null,
            coupon_code: order.coupon_code ?? null,
            discount_amount_ngn: Number(order.discount_amount_ngn ?? 0) || 0,
            exchange_rate: order.exchange_rate_snapshot ?? null,
            international_fee_amount: order.international_fee_amount ?? 0,
          })
          .eq("id", dup.id);
        await i.supabaseAdmin.from("tool_payment_status_history").insert({
          payment_id: dup.id,
          from_status: dup.payment_status,
          to_status: "successful",
          source: "webhook",
          paystack_status: "success",
          note: "charge.success webhook",
        });
      }
    } else {
      const { data: inserted } = await i.supabaseAdmin
        .from("tool_payments")
        .insert({
          order_id: order.id,
          user_id: order.user_id,
          tool_slug: order.tool_slug,
          amount: chargedAmount(order as CurrencyBearingOrder),
          currency: chargedCurrency(order as CurrencyBearingOrder),
          base_amount_ngn: order.discounted_amount_ngn ?? order.price_amount ?? null,
          coupon_code: order.coupon_code ?? null,
          discount_amount_ngn: Number(order.discount_amount_ngn ?? 0) || 0,
          payment_currency: chargedCurrency(order as CurrencyBearingOrder),
          exchange_rate: order.exchange_rate_snapshot ?? null,
          converted_amount:
            displayCurrencyOf(order as CurrencyBearingOrder) === "NGN"
              ? (order.discounted_amount_ngn ?? order.price_amount ?? null)
              : Number(displayAmountOf(order as CurrencyBearingOrder)) - Number(order.international_fee_amount ?? 0),
          international_fee_amount: order.international_fee_amount ?? 0,
          final_amount: chargedAmount(order as CurrencyBearingOrder),
          display_currency: displayCurrencyOf(order as CurrencyBearingOrder),
          display_amount: displayAmountOf(order as CurrencyBearingOrder),
          payment_status: "successful",
          payment_type: isOneTime ? "one_time" : "recurring_subscription",
          classification: isOneTime ? "one_time" : isRenewal ? "renewal" : "initial",
          paystack_reference: i.reference,
          paystack_environment: i.env,
          paystack_status: "success",
          paystack_transaction_id: paystackId ? String(paystackId) : null,
          paystack_last_checked_at: paidAt.toISOString(),
          payment_channel: paystackChannel,
          access_type: order.access_type ?? null,
          billing_period: order.billing_period ?? null,
          paid_at: paidAt.toISOString(),
          last_status_change_at: paidAt.toISOString(),
        })
        .select("id")
        .maybeSingle();
      if (inserted?.id) {
        await i.supabaseAdmin.from("tool_payment_status_history").insert({
          payment_id: inserted.id,
          from_status: null,
          to_status: "successful",
          source: "webhook",
          paystack_status: "success",
          note: "charge.success webhook (no prior record)",
        });
      }
    }
  }

  // Coupon usage counted once per order (DB-enforced), so verify + webhook
  // can both call this without double-counting.
  if (order.coupon_code) {
    const { recordCouponRedemption } = await import("@/lib/coupons.server");
    await recordCouponRedemption(i.supabaseAdmin, order.id as string, i.reference ?? null);
  }



  if (isRenewal) {
    const base = Math.max(
      order.expires_at ? new Date(order.expires_at).getTime() : 0,
      order.current_period_end ? new Date(order.current_period_end).getTime() : 0,
      paidAt.getTime(),
    );
    const newExpires = new Date(base + (dur + grace) * 86400_000);
    const newNext = new Date(base + dur * 86400_000);
    await i.supabaseAdmin
      .from("tool_orders")
      .update({
        expires_at: newExpires.toISOString(),
        current_period_start: paidAt.toISOString(),
        current_period_end: newNext.toISOString(),
        next_payment_at: newNext.toISOString(),
        paid_through_at: newNext.toISOString(),
        subscription_status:
          order.renewal_status === "disabled" ? "non_renewing" : "active",
        payment_status: "successful",
      })
      .eq("id", order.id);
    const { queueOrderEmail } = await import("@/lib/email/order-emails");
    // Renewals need a per-cycle key so each renewal sends its own email.
    const renewalKey =
      i.reference ?? i.invoiceCode ?? `${order.id}:${paidAt.getTime()}`;
    await queueOrderEmail(i.supabaseAdmin, {
      kind: "renewal_success",
      orderId: order.id as string,
      reference: i.reference ?? null,
      eventKey: `renewal_success:${renewalKey}`,
      extraPayload: {
        renewed_at: paidAt.toISOString(),
        next_payment_at: newNext.toISOString(),
        expiry_date: newExpires.toISOString(),
      },
    });
    await fireWebhookConversion(i, order, {
      kind: "renewal_success",
      eventKey: renewalKey,
      amount: chargedAmount(order as CurrencyBearingOrder),
      currency: chargedCurrency(order as CurrencyBearingOrder),
    });
    return;
  }


  // First payment
  if (order.status !== "approved") {
    const renewalStatus = isOneTime ? "not_applicable" : "enabled";
    if (access === "private") {
      // Private: enter 6-hour fulfilment window. Do NOT set expires_at yet.
      const deadline = new Date(paidAt.getTime() + PRIVATE_FULFILMENT_WINDOW_MS);
      await i.supabaseAdmin
        .from("tool_orders")
        .update({
          status: "approved",
          approved_at: paidAt.toISOString(),
          paid_at: paidAt.toISOString(),
          paystack_reference: i.reference ?? null,
          paystack_customer_code: i.customerCode ?? undefined,
          subscription_status: "pending",
          renewal_status: renewalStatus,
          payment_status: "successful",
          fulfilment_status: "pending",
          fulfilment_deadline_at: deadline.toISOString(),
        })
        .eq("id", order.id)
        .neq("status", "approved");
      try {
        const { tryAutoAssignAccount } = await import("@/lib/account-pool.functions");
        await tryAutoAssignAccount(i.supabaseAdmin, order.id as string);
      } catch (e) { console.warn("[account-pool] private auto-assign failed", e); }
      const { queueOrderEmail } = await import("@/lib/email/order-emails");
      await queueOrderEmail(i.supabaseAdmin, {
        kind: "private_pending",
        orderId: order.id as string,
        reference: i.reference ?? null,
        extraPayload: { fulfil_by: deadline.toISOString() },
      });
      await fireWebhookConversion(i, order, {
        kind: "subscription_start",
        eventKey: order.id as string,
        amount: chargedAmount(order as CurrencyBearingOrder),
        currency: chargedCurrency(order as CurrencyBearingOrder),
      });
      return;
    }
    // Shared: activate immediately.
    const newExpires = new Date(paidAt.getTime() + (dur + grace) * 86400_000);
    const newNext = new Date(paidAt.getTime() + dur * 86400_000);
    await i.supabaseAdmin
      .from("tool_orders")
      .update({
        status: "approved",
        approved_at: paidAt.toISOString(),
        paid_at: paidAt.toISOString(),
        subscription_started_at: paidAt.toISOString(),
        paid_through_at: isOneTime ? null : newNext.toISOString(),
        current_period_start: paidAt.toISOString(),
        current_period_end: isOneTime ? null : newNext.toISOString(),
        next_payment_at: isOneTime ? null : newNext.toISOString(),
        expires_at: newExpires.toISOString(),
        paystack_reference: i.reference ?? null,
        paystack_customer_code: i.customerCode ?? undefined,
        subscription_status: isOneTime ? "non_renewing" : "active",
        renewal_status: renewalStatus,
        payment_status: "successful",
        fulfilment_status: "not_required",
      })
      .eq("id", order.id)
      .neq("status", "approved");
    try {
      const { tryAutoAssignAccount } = await import("@/lib/account-pool.functions");
      await tryAutoAssignAccount(i.supabaseAdmin, order.id as string);
    } catch (e) { console.warn("[account-pool] shared auto-assign failed", e); }
    const { queueOrderEmail } = await import("@/lib/email/order-emails");
    await queueOrderEmail(i.supabaseAdmin, {
      kind: "payment_success",
      orderId: order.id as string,
      reference: i.reference ?? null,
      extraPayload: {
        start_date: paidAt.toISOString(),
        expiry_date: newExpires.toISOString(),
      },
    });
    await fireWebhookConversion(i, order, {
      kind: isOneTime ? "purchase" : "subscription_start",
      eventKey: order.id as string,
      amount: chargedAmount(order as CurrencyBearingOrder),
      currency: chargedCurrency(order as CurrencyBearingOrder),
    });
    // Ask for a review after the customer has had time to use the tool.
    // Idempotent per order — repeat webhooks / retries cannot duplicate.
    try {
      const { queueReviewRequest } = await import("@/lib/email/review-request");
      await queueReviewRequest(i.supabaseAdmin, { orderId: order.id as string });
    } catch (err) {
      console.warn("[email] queueReviewRequest failed", err);
    }
  }
}


/** Fire Meta CAPI event via the marketing pipeline (idempotent by event_id). */
async function fireWebhookConversion(
  i: DispatchInput,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  order: any,
  args: {
    kind:
      | "purchase"
      | "subscription_start"
      | "renewal_success"
      | "renewal_failed"
      | "renewal_disabled"
      | "private_fulfilment"
      | "refund";
    eventKey: string;
    amount: number;
    currency: string;
  },
) {
  try {
    const { trackServerConversion, buildEventId } = await import(
      "@/lib/marketing/server-events"
    );
    const { data: prof } = await i.supabaseAdmin
      .from("profiles")
      .select("email")
      .eq("id", order.user_id)
      .maybeSingle();
    await trackServerConversion(i.supabaseAdmin, {
      kind: args.kind,
      event_id: buildEventId(args.kind, args.eventKey),
      order_id: order.id as string,
      user_id: order.user_id as string,
      tool_slug: order.tool_slug as string,
      amount: args.amount,
      currency: args.currency,
      email: (prof as { email?: string } | null)?.email ?? null,
      custom: { source: "webhook", paystack_reference: i.reference ?? null },
    });
  } catch (err) {
    console.warn("[marketing] webhook conversion failed", err);
  }
}


async function handleSubscriptionCreate(i: DispatchInput) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let order: any = null;
  if (i.customerCode && i.planCode) {
    const { data } = await i.supabaseAdmin
      .from("tool_orders")
      .select("id, paystack_subscription_code, subscription_status")
      .eq("paystack_customer_code", i.customerCode)
      .eq("paystack_plan_code", i.planCode)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    order = data;
  }
  if (!order && i.reference) {
    const { data } = await i.supabaseAdmin
      .from("tool_orders")
      .select("id, paystack_subscription_code, subscription_status")
      .eq("paystack_reference", i.reference)
      .maybeSingle();
    order = data;
  }
  if (!order) return;

  const nextPaymentAt = i.data?.next_payment_date ?? null;
  await i.supabaseAdmin
    .from("tool_orders")
    .update({
      paystack_subscription_code: i.subscriptionCode ?? order.paystack_subscription_code,
      paystack_customer_code: i.customerCode ?? undefined,
      next_payment_at: nextPaymentAt ?? undefined,
    })
    .eq("id", order.id);

  if (i.customerCode) {
    const { data: existing } = await i.supabaseAdmin
      .from("paystack_customers")
      .select("id")
      .eq("paystack_customer_code", i.customerCode)
      .maybeSingle();
    if (!existing) {
      await i.supabaseAdmin.from("paystack_customers").insert({
        paystack_customer_code: i.customerCode,
        paystack_environment: i.env,
        user_id: i.data?.customer?.metadata?.user_id ?? null,
        email: i.data?.customer?.email ?? null,
      });
    }
  }
}

async function handleSubscriptionDisabled(i: DispatchInput) {
  if (!i.subscriptionCode) return;
  const { data: matched } = await i.supabaseAdmin
    .from("tool_orders")
    .update({
      renewal_status: "disabled",
      subscription_status: "non_renewing",
      subscription_disabled_at: new Date().toISOString(),
    })
    .eq("paystack_subscription_code", i.subscriptionCode)
    .select("id");
  const { queueOrderEmail } = await import("@/lib/email/order-emails");
  const list: { id: string }[] = Array.isArray(matched)
    ? (matched as { id: string }[])
    : matched
      ? [matched as { id: string }]
      : [];
  for (const row of list) {
    await queueOrderEmail(i.supabaseAdmin, {
      kind: "renewal_disabled",
      orderId: row.id,
      extraPayload: { disabled_at: new Date().toISOString(), source: i.eventType },
    });
    // Load order so we can attribute the conversion.
    const { data: full } = await i.supabaseAdmin
      .from("tool_orders")
      .select("id, user_id, tool_slug, price_amount, currency, payment_currency, final_amount_charged")
      .eq("id", row.id)
      .maybeSingle();
    if (full) {
      await fireWebhookConversion(i, full, {
        kind: "renewal_disabled",
        eventKey: `${row.id}:${Date.now()}`,
        amount: chargedAmount(full as CurrencyBearingOrder),
        currency: chargedCurrency(full as CurrencyBearingOrder),
      });
    }
  }
}


async function handleInvoiceFailed(i: DispatchInput) {
  if (!i.subscriptionCode) return;
  const { data: matched } = await i.supabaseAdmin
    .from("tool_orders")
    .update({
      subscription_status: "past_due",
      payment_status: "failed",
    })
    .eq("paystack_subscription_code", i.subscriptionCode)
    .select("id");
  if (i.reference) {
    await upsertPaymentStatus(i, i.reference, "failed", "invoice.payment_failed");
  }
  const { queueOrderEmail } = await import("@/lib/email/order-emails");
  const failKey = i.reference ?? i.invoiceCode ?? `${i.subscriptionCode}:${Date.now()}`;
  const list: { id: string }[] = Array.isArray(matched)
    ? (matched as { id: string }[])
    : matched
      ? [matched as { id: string }]
      : [];
  for (const row of list) {
    await queueOrderEmail(i.supabaseAdmin, {
      kind: "renewal_failed",
      orderId: row.id,
      reference: i.reference ?? null,
      eventKey: `renewal_failed:${failKey}`,
      extraPayload: { failed_at: new Date().toISOString() },
    });
    const { data: full } = await i.supabaseAdmin
      .from("tool_orders")
      .select("id, user_id, tool_slug, price_amount, currency, payment_currency, final_amount_charged")
      .eq("id", row.id)
      .maybeSingle();
    if (full) {
      await fireWebhookConversion(i, full, {
        kind: "renewal_failed",
        eventKey: failKey,
        amount: chargedAmount(full as CurrencyBearingOrder),
        currency: chargedCurrency(full as CurrencyBearingOrder),
      });
    }
  }
}



async function handleChargeFailed(i: DispatchInput) {
  if (!i.reference) return;
  await upsertPaymentStatus(i, i.reference, "failed", "charge.failed webhook");
  // Reflect failure on the pending order if we can find it.
  const order = await findOrder(i);
  if (order && order.status !== "approved") {
    await i.supabaseAdmin
      .from("tool_orders")
      .update({ payment_status: "failed" })
      .eq("id", order.id);
    const { queueOrderEmail } = await import("@/lib/email/order-emails");
    await queueOrderEmail(i.supabaseAdmin, {
      kind: "payment_failed",
      orderId: order.id as string,
      reference: i.reference,
      extraPayload: {
        failed_at: new Date().toISOString(),
        retry_url: `https://topratedseotools.com/order/${order.tool_slug}`,
      },
    });
  }
}


/**
 * Upsert-by-reference payment status change (used by failure events).
 * Advances an existing row's status or inserts a new record when the initial
 * checkout row was never created (e.g. legacy or offline-imported references).
 */
async function upsertPaymentStatus(
  i: DispatchInput,
  reference: string,
  toStatus: string,
  note: string,
) {
  const { data: existing } = await i.supabaseAdmin
    .from("tool_payments")
    .select("id, payment_status, user_id, order_id, tool_slug")
    .eq("paystack_reference", reference)
    .maybeSingle();
  if (existing) {
    if (existing.payment_status === "successful") return; // never overwrite success
    if (existing.payment_status === toStatus) return;
    await i.supabaseAdmin
      .from("tool_payments")
      .update({
        payment_status: toStatus,
        paystack_status: (i.data as { status?: string })?.status ?? toStatus,
        paystack_last_checked_at: new Date().toISOString(),
        last_status_change_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
    await i.supabaseAdmin.from("tool_payment_status_history").insert({
      payment_id: existing.id,
      from_status: existing.payment_status,
      to_status: toStatus,
      source: "webhook",
      paystack_status: (i.data as { status?: string })?.status ?? null,
      note,
    });
  }
}

