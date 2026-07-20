/**
 * Paystack webhook handler — recurring-billing aware.
 *
 * Handled events (each one gets its own idempotency key so replays are safe):
 *  - charge.success         — first payment OR renewal payment
 *  - subscription.create    — Paystack created a subscription for this order
 *  - subscription.disable   — auto-renewal was disabled
 *  - subscription.not_renew — subscription will not renew at period end
 *  - invoice.payment_failed — a renewal attempt failed
 *  - invoice.update / invoice.create — informational (recorded, no state change)
 *
 * Everything else is ACKed with 200 to stop retries.
 *
 * Renewal detection: charge.success arrives with `data.plan?.plan_code` on
 * every recurring charge. If the matched order is already approved AND its
 * paystack_plan_code matches, we treat the event as a renewal — insert a
 * new `tool_payments` row, extend `expires_at`, keep the subscription active.
 * If the order isn't approved yet, we treat it as a first payment.
 */
import { createHash, createHmac, timingSafeEqual } from "crypto";

export type Env = "test" | "live";

export interface WebhookDeps {
  secret: string | undefined;
  supabaseAdmin: any;
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
  "subscription.create",
  "subscription.disable",
  "subscription.not_renew",
  "invoice.payment_failed",
  "invoice.update",
  "invoice.create",
]);

export async function handlePaystackWebhook(
  request: Request,
  deps: WebhookDeps,
): Promise<Response> {
  const { secret, supabaseAdmin } = deps;

  if (!secret) {
    console.error("[paystack-webhook] PAYSTACK_SECRET_KEY not configured");
    return new Response("not configured", { status: 503 });
  }

  const env = detectEnvironmentStrict(secret);
  if (!env) {
    console.error("[paystack-webhook] unrecognised PAYSTACK_SECRET_KEY prefix");
    return new Response("server configuration error", { status: 503 });
  }

  const signature = request.headers.get("x-paystack-signature") ?? "";
  const raw = await request.text();
  const expected = createHmac("sha512", secret).update(raw).digest("hex");
  const sig = Buffer.from(signature);
  const exp = Buffer.from(expected);
  if (sig.length !== exp.length || !timingSafeEqual(sig, exp)) {
    console.warn("[paystack-webhook] invalid signature rejected");
    return new Response("invalid signature", { status: 401 });
  }

  let payload: any;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("bad json", { status: 400 });
  }

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

  // Idempotency key: unique per (event, env, natural-id, status).
  const naturalId =
    reference ??
    invoiceCode ??
    subscriptionCode ??
    (orderId ? `order:${orderId}` : "");
  if (!naturalId) {
    return new Response("no identifier", { status: 400 });
  }
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
    if (!existing) {
      console.error("[paystack-webhook] insert failed", safeError(insertRes.error));
      return new Response("db error", { status: 500 });
    }
    if (existing.processing_status === "processed" || existing.processing_status === "skipped") {
      return new Response("ok", { status: 200 });
    }
    if (existing.processing_status === "processing") {
      return new Response("ok", { status: 200 });
    }
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
    .update({
      processing_status: "processing",
      processing_attempts: nextAttempts,
    })
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
      data,
    });

    if (result && (result as any).alreadyFailed) {
      // Handler already recorded the failure (e.g. unknown order for
      // reconciliation). ACK 200 without overwriting the failed status.
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
      .update({
        processing_status: "failed",
        last_error: safeError(err),
      })
      .eq("id", eventId);
    console.error("[paystack-webhook] processing failed", {
      key: idempotencyKey.slice(0, 12),
      error: safeError(err),
    });
    return new Response("processing failed", { status: 500 });
  }
}

interface DispatchInput {
  supabaseAdmin: any;
  env: Env;
  eventType: string;
  eventId: string;
  orderId?: string;
  reference?: string;
  planCode?: string;
  subscriptionCode?: string;
  customerCode?: string;
  data: any;
}

async function dispatchEvent(i: DispatchInput) {
  switch (i.eventType) {
    case "charge.success":
      return handleChargeSuccess(i);
    case "subscription.create":
      return handleSubscriptionCreate(i);
    case "subscription.disable":
    case "subscription.not_renew":
      return handleSubscriptionDisabled(i);
    case "invoice.payment_failed":
      return handleInvoiceFailed(i);
    case "invoice.update":
    case "invoice.create":
      return; // informational
  }
}

async function findOrder(i: DispatchInput) {
  const q = i.supabaseAdmin
    .from("tool_orders")
    .select(
      "id, user_id, tool_slug, status, duration_days, grace_days, warning_days, access_type, paystack_plan_code, paystack_subscription_code, paystack_reference, current_period_end, next_payment_at, expires_at, subscription_status, renewal_status, fulfilment_status, price_amount, currency, paystack_environment",
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
  const isRenewal =
    order.status === "approved" &&
    !!order.paystack_plan_code &&
    (order.paystack_plan_code === i.planCode || !!order.paystack_subscription_code);

  // Record every successful charge in tool_payments (idempotent per ref).
  if (i.reference) {
    const { data: dup } = await i.supabaseAdmin
      .from("tool_payments")
      .select("id")
      .eq("paystack_reference", i.reference)
      .maybeSingle();
    if (!dup) {
      await i.supabaseAdmin.from("tool_payments").insert({
        order_id: order.id,
        user_id: order.user_id,
        tool_slug: order.tool_slug,
        amount: order.price_amount,
        currency: order.currency ?? "₦",
        payment_status: "paid",
        payment_type: "subscription",
        classification: isRenewal ? "renewal" : "first_payment",
        paystack_reference: i.reference,
        paystack_environment: i.env,
        paid_at: paidAt.toISOString(),
      });
    }
  }

  if (isRenewal) {
    // Extend from the later of current expires_at or now.
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
          order.renewal_status === "non_renewing" ? "non_renewing" : "active",
        payment_status: "paid",
      })
      .eq("id", order.id);
    return;
  }

  // First payment path
  if (order.status !== "approved") {
    const newExpires = new Date(paidAt.getTime() + (dur + grace) * 86400_000);
    const newNext = new Date(paidAt.getTime() + dur * 86400_000);
    const access = (order.access_type as string) ?? "shared";
    const fulfilment = access === "private" ? "pending_fulfilment" : "fulfilled";
    await i.supabaseAdmin
      .from("tool_orders")
      .update({
        status: "approved",
        approved_at: paidAt.toISOString(),
        paid_at: paidAt.toISOString(),
        paid_through_at: newNext.toISOString(),
        current_period_start: paidAt.toISOString(),
        current_period_end: newNext.toISOString(),
        next_payment_at: newNext.toISOString(),
        expires_at: newExpires.toISOString(),
        paystack_reference: i.reference ?? null,
        paystack_customer_code:
          i.customerCode ?? (order.paystack_reference ? undefined : null),
        subscription_status: "active",
        renewal_status: order.renewal_status === "non_renewing" ? "non_renewing" : "will_renew",
        payment_status: "paid",
        fulfilment_status: fulfilment,
      })
      .eq("id", order.id)
      .neq("status", "approved");
  }
}

async function handleSubscriptionCreate(i: DispatchInput) {
  // Match order via customer_code + plan_code (most recent). Falls back to
  // reference stored on the order at init time.
  let order: any = null;
  if (i.customerCode && i.planCode) {
    const { data } = await i.supabaseAdmin
      .from("tool_orders")
      .select("id, paystack_subscription_code")
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
      .select("id, paystack_subscription_code")
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
      subscription_status: "active",
      next_payment_at: nextPaymentAt ?? undefined,
    })
    .eq("id", order.id);

  if (i.customerCode) {
    // Save customer mapping (best-effort).
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
  await i.supabaseAdmin
    .from("tool_orders")
    .update({
      renewal_status: "non_renewing",
      subscription_status: "non_renewing",
      subscription_disabled_at: new Date().toISOString(),
    })
    .eq("paystack_subscription_code", i.subscriptionCode);
}

async function handleInvoiceFailed(i: DispatchInput) {
  if (!i.subscriptionCode) return;
  await i.supabaseAdmin
    .from("tool_orders")
    .update({
      subscription_status: "past_due",
      renewal_status: "payment_failed",
      payment_status: "failed",
    })
    .eq("paystack_subscription_code", i.subscriptionCode);
}
