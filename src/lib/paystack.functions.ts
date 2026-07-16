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
 * Returns the hosted checkout URL. The order must belong to the caller.
 */
export const initializePaystackPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ order_id: z.string().uuid(), callback_url: z.string().url() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    // Load the order + user email
    const { data: order, error } = await context.supabase
      .from("tool_orders")
      .select(
        "id, user_id, tool_slug, price_amount, currency, status, pricing_option_id, paystack_reference",
      )
      .eq("id", data.order_id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!order) throw new Error("Order not found");
    if (order.status === "approved") throw new Error("This subscription is already active");
    if (!order.price_amount) throw new Error("This order has no fixed price — contact admin");

    // Pull duration/grace/warning from the chosen pricing option
    let duration_days = 28;
    let grace_days = 0;
    let warning_days = 0;
    if (order.pricing_option_id) {
      const { data: opt } = await context.supabase
        .from("tool_pricing")
        .select("duration_days, grace_days, warning_days")
        .eq("id", order.pricing_option_id)
        .maybeSingle();
      if (opt) {
        duration_days = (opt.duration_days as number) ?? 28;
        grace_days = (opt.grace_days as number) ?? 0;
        warning_days = (opt.warning_days as number) ?? 0;
      }
    }

    const email = context.claims?.email ?? `${context.userId}@users.local`;
    const reference = `TRST-${order.id.slice(0, 8)}-${Date.now()}`;

    const init = await paystack<{ authorization_url: string; access_code: string; reference: string }>(
      "/transaction/initialize",
      {
        method: "POST",
        body: JSON.stringify({
          email,
          amount: toKobo(order.price_amount as unknown as number),
          currency: "NGN",
          reference,
          callback_url: data.callback_url,
          metadata: {
            order_id: order.id,
            user_id: order.user_id,
            tool_slug: order.tool_slug,
          },
        }),
      },
    );

    // Snapshot terms + reference on the order
    await context.supabase
      .from("tool_orders")
      .update({
        paystack_reference: init.reference,
        duration_days,
        grace_days,
        warning_days,
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
    const tx = await paystack<{
      status: string;
      reference: string;
      amount: number;
      metadata: { order_id?: string; user_id?: string };
    }>(`/transaction/verify/${encodeURIComponent(data.reference)}`);

    if (tx.status !== "success") {
      return { ok: false, status: tx.status };
    }

    const orderId = tx.metadata?.order_id;
    if (!orderId) throw new Error("Missing order reference on transaction");

    // Load order (must belong to caller)
    const { data: order } = await context.supabase
      .from("tool_orders")
      .select("id, user_id, status, paid_at, duration_days, grace_days, expires_at")
      .eq("id", orderId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!order) throw new Error("Order not found");
    if (order.status === "approved") {
      return { ok: true, orderId, alreadyActive: true };
    }

    // Approve via admin client to bypass RLS status transition constraints
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
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
      })
      .eq("id", orderId);

    return { ok: true, orderId, alreadyActive: false };
  });
