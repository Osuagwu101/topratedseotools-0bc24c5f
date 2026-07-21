/**
 * Shared helper to queue post-payment / fulfilment / renewal emails from
 * either the Paystack webhook or verify-on-return code paths.
 *
 * Idempotency is handled by `queueEmail` via the unique `event_key` — the
 * same (kind, orderId) will insert once and no-op on repeats, so the webhook
 * and the browser callback cannot both send the "same" success email.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { queueEmail } from "./queue";
import type { TemplateVars } from "./templates";


export type OrderEmailKind =
  | "payment_success"
  | "payment_failed"
  | "private_pending"
  | "private_fulfilled"
  | "renewal_success"
  | "renewal_failed"
  | "renewal_disabled";

export interface QueueOrderEmailInput {
  kind: OrderEmailKind;
  orderId: string;
  reference?: string | null;
  /**
   * Override the idempotency key. Use for renewal events where each renewal
   * cycle needs its own send (e.g. `renewal_success:{reference}` or
   * `renewal_success:{invoiceCode}`). Defaults to `${kind}:${orderId}`.
   */
  eventKey?: string;
  extraPayload?: Record<string, string | number | null | undefined>;
}



/**
 * Best-effort — never throws. Looks up the customer + order and drops a
 * message onto the queue. Errors are logged and swallowed so a failed
 * email lookup can never break a payment/fulfilment write.
 */
export async function queueOrderEmail(admin: any, i: QueueOrderEmailInput): Promise<void> {
  try {
    const { data: order } = await admin
      .from("tool_orders")
      .select(
        "id, user_id, tool_slug, access_type, billing_period, price_amount, currency, fulfilment_deadline_at, current_period_end, next_payment_at, expires_at",
      )
      .eq("id", i.orderId)
      .maybeSingle();
    if (!order) return;

    const { data: profile } = await admin
      .from("profiles")
      .select("email, full_name")
      .eq("id", order.user_id)
      .maybeSingle();
    const to = (profile as { email?: string } | null)?.email ?? null;
    if (!to) return;
    const name = (profile as { full_name?: string } | null)?.full_name ?? "there";

    const basePayload: TemplateVars = {
      name,
      tool: order.tool_slug ?? "your tool",
      access_type: order.access_type ?? "shared",
      billing_period: order.billing_period ?? "monthly",
      amount: order.price_amount ?? "",
      currency: order.currency ?? "NGN",
      reference: i.reference ?? "",
      dashboard_url: "https://topratedseotools.com/dashboard",
      ...((i.extraPayload ?? {}) as TemplateVars),
    };


    const templateByKind: Record<OrderEmailKind, string> = {
      payment_success: "payment_success",
      payment_failed: "payment_failed",
      private_pending: "private_pending",
      private_fulfilled: "private_fulfilled",
      renewal_success: "renewal_success",
      renewal_failed: "renewal_failed",
      renewal_disabled: "renewal_disabled",
    };

    await queueEmail(admin, {
      eventKey: i.eventKey ?? `${i.kind}:${i.orderId}`,
      templateKey: templateByKind[i.kind],
      recipient: to,
      relatedOrderId: order.id as string,
      relatedUserId: order.user_id as string,
      payload: basePayload,
    });
  } catch (err) {
    console.warn("[email] queueOrderEmail failed", err);
  }
}

