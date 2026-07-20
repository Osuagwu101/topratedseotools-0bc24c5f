/**
 * Paystack — subscription payment initialization, verification, and
 * Disable Renewal.
 *
 * Flow (recurring):
 *  1. User picks a plan → `createOrder` snapshots server-validated details
 *     into a `pending` `tool_orders` row.
 *  2. `initializePaystackPayment`:
 *       a. Reads env from `PAYSTACK_SECRET_KEY` prefix.
 *       b. Re-validates the plan and rebuilds the snapshot (admin can
 *          disable Shared/Private mid-flow).
 *       c. `ensurePlanFromSnapshot` reuses / creates a Paystack plan.
 *       d. Initializes a Paystack transaction with `plan: <plan_code>` so
 *          the first successful charge auto-creates a subscription.
 *       e. Persists the plan code + subscription lifecycle fields on the
 *          order (`subscription_status='initialized'`, `renewal_status='will_renew'`).
 *       f. Private access orders start `fulfilment_status='pending_fulfilment'`.
 *  3. Paystack redirects back to `/orders?reference=…`; the client calls
 *     `verifyPaystackPayment` as a fallback to the webhook.
 *  4. The webhook (`/api/public/webhooks/paystack`) is the authoritative
 *     path — it records renewals, subscription creation, failures, and
 *     Disable Renewal notifications.
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
    createPlan: async (input: { name: string; amount: number; interval: "monthly" | "quarterly" | "annually"; currency: "NGN" }) =>
      paystack<{ plan_code: string }>("/plan", {
        method: "POST",
        body: JSON.stringify(input),
      }),
  };
}

export const initializePaystackPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ order_id: z.string().uuid(), callback_url: z.string().url() }).parse(input),
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
    if (!env) {
      throw new Error("Payments are temporarily unavailable. Please contact support.");
    }

    const { data: order, error } = await context.supabase
      .from("tool_orders")
      .select("id, user_id, tool_slug, pricing_option_id, status, paystack_reference")
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
        },
        env,
      );
    } catch (err) {
      if (err instanceof CheckoutError) throw new Error(err.message);
      throw err;
    }

    // Ensure a Paystack plan exists (reuse when possible) via admin client.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { plan_code } = await ensurePlanFromSnapshot(supabaseAdmin, paystackApi(), snapshot);

    const email = context.claims?.email ?? `${context.userId}@users.local`;
    const reference = generatePaystackReference(order.id as string);
    const metadata = buildPaystackMetadata({
      order_id: order.id as string,
      user_id: order.user_id as string,
      tool_slug: snapshot.tool_slug,
      pricing_option_id: snapshot.pricing_option_id,
      access_type: snapshot.access_type,
      billing_period: snapshot.billing_period,
    });

    const init = await paystack<{ authorization_url: string; access_code: string; reference: string }>(
      "/transaction/initialize",
      {
        method: "POST",
        body: JSON.stringify({
          email,
          amount: toKobo(snapshot.price_amount),
          currency: "NGN",
          plan: plan_code,
          reference,
          callback_url: data.callback_url,
          metadata,
        }),
      },
    );

    const fulfilment = snapshot.access_type === "private" ? "pending_fulfilment" : "pending";

    await context.supabase
      .from("tool_orders")
      .update({
        paystack_reference: init.reference,
        paystack_plan_code: plan_code,
        access_type: snapshot.access_type,
        billing_period: snapshot.billing_period,
        price_amount: snapshot.price_amount,
        currency: snapshot.currency,
        duration_days: snapshot.duration_days,
        grace_days: snapshot.grace_days,
        warning_days: snapshot.warning_days,
        payment_type: "subscription",
        product_type: snapshot.product_type,
        paystack_environment: snapshot.paystack_environment,
        subscription_status: "initialized",
        renewal_status: "will_renew",
        fulfilment_status: fulfilment,
      })
      .eq("id", order.id);

    return { authorization_url: init.authorization_url, reference: init.reference };
  });

/**
 * Fallback verify — used when the browser returns from Paystack before the
 * webhook fires. Idempotent; the webhook remains authoritative for the
 * subscription lifecycle.
 */
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
        "id, user_id, status, price_amount, currency, paystack_reference, paystack_environment, duration_days, grace_days, access_type, fulfilment_status",
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

    if (!verdict.ok) {
      console.warn("[paystack-verify] rejected", { reason: verdict.reason, ref: tx.reference });
      throw new Error(VERIFY_FAILURE_MESSAGE);
    }

    const paidAt = new Date();
    const dur = (order.duration_days as number) ?? 28;
    const grace = (order.grace_days as number) ?? 0;
    const expiresAt = new Date(paidAt.getTime() + (dur + grace) * 86400_000);
    const nextPaymentAt = new Date(paidAt.getTime() + dur * 86400_000);
    const access = (order.access_type as string) ?? "shared";
    const fulfilment = access === "private" ? "pending_fulfilment" : "fulfilled";

    await supabaseAdmin
      .from("tool_orders")
      .update({
        status: "approved",
        approved_at: paidAt.toISOString(),
        paid_at: paidAt.toISOString(),
        paid_through_at: nextPaymentAt.toISOString(),
        current_period_start: paidAt.toISOString(),
        current_period_end: nextPaymentAt.toISOString(),
        next_payment_at: nextPaymentAt.toISOString(),
        expires_at: expiresAt.toISOString(),
        paystack_reference: tx.reference,
        paystack_environment: env,
        paystack_customer_code: tx.customer?.customer_code ?? null,
        subscription_status: "active",
        renewal_status: "will_renew",
        payment_status: "paid",
        fulfilment_status: fulfilment,
      })
      .eq("id", orderId)
      .neq("status", "approved");

    return { ok: true, orderId, alreadyActive: false, fulfilment };
  });

/**
 * Auth — user disables auto-renewal on an active subscription. Access stays
 * active until the paid period ends; no further Paystack charges are made.
 *
 * Paystack requires the subscription code + a per-subscription "email
 * token" to disable. We fetch the token from `/subscription/:code`.
 */
export const disableOrderRenewal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ order_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: order, error } = await context.supabase
      .from("tool_orders")
      .select(
        "id, user_id, paystack_subscription_code, subscription_status, renewal_status",
      )
      .eq("id", data.order_id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!order) throw new Error("Subscription not found");
    if (!order.paystack_subscription_code) {
      // Subscription hasn't been created yet by Paystack. Still record intent.
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin
        .from("tool_orders")
        .update({
          renewal_status: "non_renewing",
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

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("tool_orders")
      .update({
        renewal_status: "non_renewing",
        subscription_status: "non_renewing",
        subscription_disabled_at: new Date().toISOString(),
        non_renewal_requested_at: new Date().toISOString(),
      })
      .eq("id", order.id);

    return { ok: true };
  });
