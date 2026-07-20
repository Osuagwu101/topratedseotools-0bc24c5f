/**
 * Paystack — payment initialization + verification.
 *
 * Flow:
 *  1. User clicks "Pay" → `initializePaystackPayment` creates a Paystack
 *     transaction, snapshots duration/grace/warning onto the order, and
 *     returns the hosted checkout URL.
 *  2. User completes payment on Paystack.
 *  3. Paystack webhook (`/api/public/webhooks/paystack`) flips the order to
 *     approved, records `paid_at`, and sets `expires_at = paid_at + duration + grace`.
 *  4. As a fallback the return URL calls `verifyPaystackPayment` so users
 *     see access even if the webhook is delayed.
 *
 * The Paystack secret key is server-only. The webhook uses HMAC-SHA512 over
 * the raw request body per Paystack's spec.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const PAYSTACK_BASE = "https://api.paystack.co";

/** Kobo is Paystack's minor unit for NGN. */
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

/**
 * Auth — start a Paystack transaction for a pending order the user owns.
 * Server re-validates access, generates the reference, and controls price.
 */
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

    const env = detectCheckoutEnvironment(process.env.PAYSTACK_SECRET_KEY);
    if (!env) {
      throw new Error("Payments are temporarily unavailable. Please contact support.");
    }

    const { data: order, error } = await context.supabase
      .from("tool_orders")
      .select(
        "id, user_id, tool_slug, pricing_option_id, status, paystack_reference",
      )
      .eq("id", data.order_id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!order) throw new Error("Order not found");
    if (order.status === "approved") throw new Error("This subscription is already active");

    // Re-validate the plan on every init attempt so admins toggling access
    // mid-flow cannot be bypassed by an old pending order.
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
          reference,
          callback_url: data.callback_url,
          metadata,
        }),
      },
    );

    // Snapshot the server-generated reference + environment on the order.
    await context.supabase
      .from("tool_orders")
      .update({
        paystack_reference: init.reference,
        access_type: snapshot.access_type,
        billing_period: snapshot.billing_period,
        price_amount: snapshot.price_amount,
        currency: snapshot.currency,
        duration_days: snapshot.duration_days,
        grace_days: snapshot.grace_days,
        warning_days: snapshot.warning_days,
        payment_type: snapshot.payment_type,
        product_type: snapshot.product_type,
        paystack_environment: snapshot.paystack_environment,
      })
      .eq("id", order.id);

    return { authorization_url: init.authorization_url, reference: init.reference };
  });

/**
 * Auth — after redirect from Paystack, the client calls this so access is
 * granted immediately even if the webhook hasn't arrived. Idempotent.
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
    }>(`/transaction/verify/${encodeURIComponent(data.reference)}`);

    const orderId = tx.metadata?.order_id;
    if (!orderId) throw new Error(VERIFY_FAILURE_MESSAGE);

    const { data: order } = await context.supabase
      .from("tool_orders")
      .select(
        "id, user_id, status, price_amount, currency, paystack_reference, paystack_environment, duration_days, grace_days",
      )
      .eq("id", orderId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!order) throw new Error(VERIFY_FAILURE_MESSAGE);
    if (order.status === "approved") {
      return { ok: true, orderId, alreadyActive: true };
    }

    // Check reference-reuse against other orders (bypass RLS to see globally).
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

    await supabaseAdmin
      .from("tool_orders")
      .update({
        status: "approved",
        approved_at: paidAt.toISOString(),
        paid_at: paidAt.toISOString(),
        expires_at: expiresAt.toISOString(),
        paystack_reference: tx.reference,
        paystack_environment: env,
      })
      .eq("id", orderId)
      .neq("status", "approved");

    return { ok: true, orderId, alreadyActive: false };
  });
