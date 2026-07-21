/**
 * Paystack — subscription initialization, verification, Disable Renewal.
 * Enum values match DB CHECK constraints (see paystack-webhook.ts header).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const PAYSTACK_BASE = "https://api.paystack.co";

function toKobo(naira: number): number {
  return Math.round(naira * 100);
}

async function paystack<T>(path: string, init?: RequestInit): Promise<T> {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) throw new Error("Payments are not configured yet. Contact support.");
  const res = await fetch(`${PAYSTACK_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const json = (await res.json()) as { status: boolean; message: string; data: T };
  if (!res.ok || !json.status) {
    throw new Error(json.message || `Paystack error (${res.status})`);
  }
  return json.data;
}

function paystackApi() {
  return {
    createPlan: async (input: {
      name: string;
      amount: number;
      interval: "monthly" | "quarterly" | "annually";
      currency: "NGN";
    }) =>
      paystack<{ plan_code: string }>("/plan", {
        method: "POST",
        body: JSON.stringify(input),
      }),
  };
}

export const initializePaystackPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        order_id: z.string().uuid(),
        callback_url: z.string().url(),
        payment_type: z.enum(["one_time", "recurring_subscription"]).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const {
      detectCheckoutEnvironment,
      validateAndBuildOrderSnapshot,
      generatePaystackReference,
      buildPaystackMetadata,
      CheckoutError,
    } = await import("@/lib/paystack-checkout");
    const { ensurePlanFromSnapshot } = await import("@/lib/paystack-plans");

    const env = detectCheckoutEnvironment(process.env.PAYSTACK_SECRET_KEY);
    if (!env) throw new Error("Payments are temporarily unavailable. Please contact support.");

    const paymentType = data.payment_type ?? "recurring_subscription";
    const isRecurring = paymentType === "recurring_subscription";

    const { data: order, error } = await context.supabase
      .from("tool_orders")
      .select("id, user_id, tool_slug, pricing_option_id, status")
      .eq("id", data.order_id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!order) throw new Error("Order not found");
    if (order.status === "approved") throw new Error("This subscription is already active");

    let snapshot;
    try {
      snapshot = await validateAndBuildOrderSnapshot(
        context.supabase,
        {
          userId: context.userId,
          tool_slug: order.tool_slug as string,
          pricing_option_id: order.pricing_option_id as string | null,
          payment_type: paymentType,
        },
        env,
      );
    } catch (err) {
      if (err instanceof CheckoutError) throw new Error(err.message);
      throw err;
    }

    let planCode: string | null = null;
    if (isRecurring) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const res = await ensurePlanFromSnapshot(supabaseAdmin, paystackApi(), snapshot);
      planCode = res.plan_code;
    }

    const email = context.claims?.email ?? `${context.userId}@users.local`;
    const reference = generatePaystackReference(order.id as string);
    const metadata = {
      ...buildPaystackMetadata({
        order_id: order.id as string,
        user_id: order.user_id as string,
        tool_slug: snapshot.tool_slug,
        pricing_option_id: snapshot.pricing_option_id,
        access_type: snapshot.access_type,
        billing_period: snapshot.billing_period,
      }),
      payment_type: paymentType,
    };

    // Recurring: restrict to channels Paystack supports for subscriptions.
    // One-time: omit `channels` so every one-time channel enabled on the
    // Paystack account (bank transfer, USSD, pay with bank, QR, etc.) shows.
    const initBody: Record<string, unknown> = {
      email,
      amount: toKobo(snapshot.price_amount),
      currency: "NGN",
      reference,
      callback_url: data.callback_url,
      metadata,
    };
    if (isRecurring && planCode) {
      initBody.plan = planCode;
      initBody.channels = ["card", "direct_debit"];
    }

    const init = await paystack<{ authorization_url: string; access_code: string; reference: string }>(
      "/transaction/initialize",
      { method: "POST", body: JSON.stringify(initBody) },
    );

    const fulfilment = snapshot.access_type === "private" ? "pending" : "not_required";

    await context.supabase
      .from("tool_orders")
      .update({
        paystack_reference: init.reference,
        paystack_plan_code: planCode,
        access_type: snapshot.access_type,
        billing_period: snapshot.billing_period,
        price_amount: snapshot.price_amount,
        currency: snapshot.currency,
        duration_days: snapshot.duration_days,
        grace_days: snapshot.grace_days,
        warning_days: snapshot.warning_days,
        payment_type: paymentType,
        product_type: snapshot.product_type,
        paystack_environment: snapshot.paystack_environment,
        subscription_status: "pending",
        renewal_status: isRecurring ? "enabled" : "not_applicable",
        fulfilment_status: fulfilment,
      })
      .eq("id", order.id);

    return { authorization_url: init.authorization_url, reference: init.reference };
  });


/** Fallback verify — used when the browser returns from Paystack before the webhook fires. */
export const verifyPaystackPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ reference: z.string().min(4).max(120) }).parse(input))
  .handler(async ({ data, context }) => {
    const { detectCheckoutEnvironment, validatePaymentVerification, VERIFY_FAILURE_MESSAGE } =
      await import("@/lib/paystack-checkout");

    const env = detectCheckoutEnvironment(process.env.PAYSTACK_SECRET_KEY);
    if (!env) throw new Error(VERIFY_FAILURE_MESSAGE);

    const tx = await paystack<{
      status: string;
      reference: string;
      amount: number;
      currency: string;
      metadata: { order_id?: string; user_id?: string };
      customer?: { customer_code?: string };
    }>(`/transaction/verify/${encodeURIComponent(data.reference)}`);

    const orderId = tx.metadata?.order_id;
    if (!orderId) throw new Error(VERIFY_FAILURE_MESSAGE);

    const { data: order } = await context.supabase
      .from("tool_orders")
      .select(
        "id, user_id, status, price_amount, currency, paystack_reference, paystack_environment, duration_days, grace_days, access_type, fulfilment_status, payment_type",
      )
      .eq("id", orderId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!order) throw new Error(VERIFY_FAILURE_MESSAGE);
    if (order.status === "approved") {
      return { ok: true, orderId, alreadyActive: true };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: refClash } = await supabaseAdmin
      .from("tool_orders")
      .select("id")
      .eq("paystack_reference", tx.reference)
      .neq("id", orderId)
      .maybeSingle();

    const verdict = validatePaymentVerification({
      tx,
      order: {
        id: order.id as string,
        user_id: order.user_id as string,
        price_amount: (order.price_amount as number | null) ?? null,
        currency: (order.currency as string | null) ?? null,
        paystack_reference: (order.paystack_reference as string | null) ?? null,
        paystack_environment: (order.paystack_environment as string | null) ?? null,
      },
      callerUserId: context.userId,
      env,
      otherOrderHasReference: !!refClash,
    });

    if (!verdict.ok) throw new Error(VERIFY_FAILURE_MESSAGE);

    const paidAt = new Date();
    const dur = (order.duration_days as number) ?? 28;
    const grace = (order.grace_days as number) ?? 0;
    const access = ((order.access_type as string) ?? "shared") as "shared" | "private";
    const isOneTime = (order.payment_type as string) === "one_time";
    const renewalStatus = isOneTime ? "not_applicable" : "enabled";

    // Idempotently record this successful charge in tool_payments so the
    // admin revenue dashboard reflects it even when the webhook is delayed
    // or never delivered (e.g. checkout completed via the browser return).
    if (tx.reference) {
      const { data: dupPay } = await supabaseAdmin
        .from("tool_payments")
        .select("id")
        .eq("paystack_reference", tx.reference)
        .maybeSingle();
      if (!dupPay) {
        const { data: orderFull } = await supabaseAdmin
          .from("tool_orders")
          .select("tool_slug")
          .eq("id", order.id)
          .maybeSingle();
        await supabaseAdmin.from("tool_payments").insert({
          order_id: order.id,
          user_id: order.user_id,
          tool_slug: (orderFull?.tool_slug as string) ?? "unknown",
          amount: (order.price_amount as number | null) ?? tx.amount / 100,
          currency: (order.currency as string | null) ?? "NGN",
          payment_status: "successful",
          payment_type: isOneTime ? "one_time" : "recurring_subscription",
          classification: isOneTime ? "one_time" : "initial",
          paystack_reference: tx.reference,
          paystack_environment: env,
          paid_at: paidAt.toISOString(),
        });
      }
    }

    if (access === "private") {
      const deadline = new Date(paidAt.getTime() + 6 * 60 * 60 * 1000);
      await supabaseAdmin
        .from("tool_orders")
        .update({
          status: "approved",
          approved_at: paidAt.toISOString(),
          paid_at: paidAt.toISOString(),
          paystack_reference: tx.reference,
          paystack_environment: env,
          paystack_customer_code: tx.customer?.customer_code ?? null,
          subscription_status: "pending",
          renewal_status: renewalStatus,
          payment_status: "successful",
          fulfilment_status: "pending",
          fulfilment_deadline_at: deadline.toISOString(),
        })
        .eq("id", orderId)
        .neq("status", "approved");
      return { ok: true, orderId, alreadyActive: false, fulfilment: "pending" };
    }

    const expiresAt = new Date(paidAt.getTime() + (dur + grace) * 86400_000);
    const nextPaymentAt = new Date(paidAt.getTime() + dur * 86400_000);
    await supabaseAdmin
      .from("tool_orders")
      .update({
        status: "approved",
        approved_at: paidAt.toISOString(),
        paid_at: paidAt.toISOString(),
        subscription_started_at: paidAt.toISOString(),
        paid_through_at: isOneTime ? null : nextPaymentAt.toISOString(),
        current_period_start: paidAt.toISOString(),
        current_period_end: isOneTime ? null : nextPaymentAt.toISOString(),
        next_payment_at: isOneTime ? null : nextPaymentAt.toISOString(),
        expires_at: expiresAt.toISOString(),
        paystack_reference: tx.reference,
        paystack_environment: env,
        paystack_customer_code: tx.customer?.customer_code ?? null,
        subscription_status: isOneTime ? "non_renewing" : "active",
        renewal_status: renewalStatus,
        payment_status: "successful",
        fulfilment_status: "not_required",
      })
      .eq("id", orderId)
      .neq("status", "approved");

    return { ok: true, orderId, alreadyActive: false, fulfilment: "not_required" };
  });

/** Auth — user disables auto-renewal on an active subscription. */
export const disableOrderRenewal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ order_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: order, error } = await context.supabase
      .from("tool_orders")
      .select("id, user_id, paystack_subscription_code, subscription_status, renewal_status")
      .eq("id", data.order_id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!order) throw new Error("Subscription not found");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (!order.paystack_subscription_code) {
      await supabaseAdmin
        .from("tool_orders")
        .update({
          renewal_status: "disabled",
          subscription_status: "non_renewing",
          subscription_disabled_at: new Date().toISOString(),
          non_renewal_requested_at: new Date().toISOString(),
        })
        .eq("id", order.id);
      return { ok: true };
    }

    const code = order.paystack_subscription_code as string;
    const sub = await paystack<{ email_token: string }>(
      `/subscription/${encodeURIComponent(code)}`,
    );
    await paystack("/subscription/disable", {
      method: "POST",
      body: JSON.stringify({ code, token: sub.email_token }),
    });

    await supabaseAdmin
      .from("tool_orders")
      .update({
        renewal_status: "disable_pending",
        subscription_status: "non_renewing",
        non_renewal_requested_at: new Date().toISOString(),
      })
      .eq("id", order.id);

    return { ok: true };
  });
