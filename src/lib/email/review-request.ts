/**
 * Queues a single "how was your purchase?" email per qualifying order.
 *
 * Idempotency: eventKey = `review_request:{orderId}` — the unique constraint
 * on email_messages.event_key guarantees at most one email per order, even if
 * multiple triggers fire (payment_success + private_fulfilled + retries).
 *
 * Gating: caller decides when it's safe to fire (payment successful & access
 * granted / private fulfilled). We add a short delay so customers have time
 * to use the tool before we ask.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { queueEmail } from "./queue";

const DEFAULT_DELAY_HOURS = 48;

export async function queueReviewRequest(
  admin: any,
  input: {
    orderId: string;
    delayHours?: number;
  },
): Promise<void> {
  try {
    const { data: order } = await admin
      .from("tool_orders")
      .select("id, user_id, tool_slug, access_type, status, cancelled_at")
      .eq("id", input.orderId)
      .maybeSingle();
    if (!order) return;
    // Skip cancelled orders.
    if (order.status === "cancelled" || order.cancelled_at) return;

    // Skip refunded/reversed orders (both online and offline records).
    const { data: pays } = await admin
      .from("tool_payments")
      .select("payment_status, reconciliation_status")
      .eq("order_id", order.id);
    for (const p of (pays ?? []) as Array<{ payment_status?: string | null; reconciliation_status?: string | null }>) {
      const st = (p.payment_status ?? "").toLowerCase();
      const rc = (p.reconciliation_status ?? "").toLowerCase();
      if (st === "refunded" || st === "reversed" || rc === "refunded") return;
    }

    const { data: profile } = await admin
      .from("profiles")
      .select("email, full_name")
      .eq("id", order.user_id)
      .maybeSingle();
    const to = (profile as { email?: string } | null)?.email ?? null;
    if (!to) return;

    const delay = input.delayHours ?? DEFAULT_DELAY_HOURS;
    const scheduledFor = new Date(Date.now() + delay * 3600_000).toISOString();

    await queueEmail(admin, {
      eventKey: `review_request:${order.id}`,
      templateKey: "review_request",
      recipient: to,
      relatedOrderId: order.id as string,
      relatedUserId: order.user_id as string,
      scheduledFor,
      payload: {
        name: (profile as { full_name?: string } | null)?.full_name ?? "there",
        tool: order.tool_slug ?? "your tool",
        review_url: `https://topratedseotools.com/tools/${order.tool_slug}#reviews`,
      },
    });
  } catch (err) {
    console.warn("[email] queueReviewRequest failed", err);
  }
}
