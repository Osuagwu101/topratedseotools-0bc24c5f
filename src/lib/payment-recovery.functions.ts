/**
 * Payment Recovery Centre — server functions.
 *
 * Powers Admin → Settings → Payment Management. Queries surface the
 * seven issue categories used by the UI and expose one-click resolution
 * actions. Every action writes to admin_activity_log.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { logAdminActivity } from "@/lib/admin-audit.server";

async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase.rpc("has_role", {
    _user_id: ctx.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

export interface RecoveryIssue {
  id: string;
  category:
    | "paid_no_access"
    | "failed_payment"
    | "pending_payment"
    | "duplicate_attempt"
    | "webhook_failed"
    | "refund_requested"
    | "cancelled_transaction";
  title: string;
  reference: string | null;
  order_id: string | null;
  payment_id: string | null;
  user_id: string | null;
  customer_email: string | null;
  tool_slug: string | null;
  amount: number | null;
  currency: string;
  created_at: string;
  detail: string;
  recommended_action: string;
  action_key: string; // maps to a specific one-click server fn
}

export const adminListPaymentIssues = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const admin = await assertAdmin(context);
    const issues: RecoveryIssue[] = [];

    // 1) Successful payments where order is NOT approved (paid but no access)
    {
      const { data: rows } = await admin
        .from("tool_payments")
        .select(
          "id, paystack_reference, order_id, user_id, tool_slug, amount, currency, customer_email, initiated_at",
        )
        .eq("payment_status", "successful")
        .not("order_id", "is", null)
        .order("initiated_at", { ascending: false })
        .limit(50);
      for (const r of (rows ?? []) as any[]) {
        const { data: order } = await admin
          .from("tool_orders")
          .select("status")
          .eq("id", r.order_id)
          .maybeSingle();
        if (order && order.status !== "approved") {
          issues.push({
            id: `paid_no_access:${r.id}`,
            category: "paid_no_access",
            title: "Payment successful but access not assigned",
            reference: r.paystack_reference,
            order_id: r.order_id,
            payment_id: r.id,
            user_id: r.user_id,
            customer_email: r.customer_email,
            tool_slug: r.tool_slug,
            amount: r.amount ? Number(r.amount) : null,
            currency: r.currency,
            created_at: r.initiated_at,
            detail: `Order is still "${order.status}" despite successful payment.`,
            recommended_action: "Retry Access Assignment",
            action_key: "retry_access_assignment",
          });
        }
      }
    }

    // 2) Failed payments (last 100)
    {
      const { data: rows } = await admin
        .from("tool_payments")
        .select(
          "id, paystack_reference, order_id, user_id, tool_slug, amount, currency, customer_email, initiated_at, receipt_last_error",
        )
        .eq("payment_status", "failed")
        .order("initiated_at", { ascending: false })
        .limit(100);
      for (const r of (rows ?? []) as any[]) {
        issues.push({
          id: `failed:${r.id}`,
          category: "failed_payment",
          title: "Payment failed",
          reference: r.paystack_reference,
          order_id: r.order_id,
          payment_id: r.id,
          user_id: r.user_id,
          customer_email: r.customer_email,
          tool_slug: r.tool_slug,
          amount: r.amount ? Number(r.amount) : null,
          currency: r.currency,
          created_at: r.initiated_at,
          detail: r.receipt_last_error ?? "Paystack reported this attempt as failed.",
          recommended_action: "Recheck with Paystack",
          action_key: "recheck_payment",
        });
      }
    }

    // 3) Pending / initiated / processing payments older than 30 minutes
    {
      const cutoff = new Date(Date.now() - 30 * 60_000).toISOString();
      const { data: rows } = await admin
        .from("tool_payments")
        .select(
          "id, paystack_reference, order_id, user_id, tool_slug, amount, currency, customer_email, initiated_at, payment_status",
        )
        .in("payment_status", ["pending", "initiated", "processing"])
        .lt("initiated_at", cutoff)
        .order("initiated_at", { ascending: false })
        .limit(100);
      for (const r of (rows ?? []) as any[]) {
        issues.push({
          id: `pending:${r.id}`,
          category: "pending_payment",
          title: `Payment still ${r.payment_status}`,
          reference: r.paystack_reference,
          order_id: r.order_id,
          payment_id: r.id,
          user_id: r.user_id,
          customer_email: r.customer_email,
          tool_slug: r.tool_slug,
          amount: r.amount ? Number(r.amount) : null,
          currency: r.currency,
          created_at: r.initiated_at,
          detail: "Paystack has not confirmed the outcome. Recheck to reconcile.",
          recommended_action: "Reconcile Payment",
          action_key: "recheck_payment",
        });
      }
    }

    // 4) Duplicate payment attempts — same user + tool + amount within 24h
    {
      const cutoff = new Date(Date.now() - 24 * 3600_000).toISOString();
      const { data: rows } = await admin
        .from("tool_payments")
        .select(
          "id, paystack_reference, order_id, user_id, tool_slug, amount, currency, customer_email, initiated_at",
        )
        .gte("initiated_at", cutoff)
        .order("initiated_at", { ascending: false })
        .limit(400);
      const bucket = new Map<string, any[]>();
      for (const r of (rows ?? []) as any[]) {
        const k = `${r.user_id}|${r.tool_slug}|${r.amount}`;
        if (!bucket.has(k)) bucket.set(k, []);
        bucket.get(k)!.push(r);
      }
      for (const list of bucket.values()) {
        if (list.length > 1) {
          const r = list[0];
          issues.push({
            id: `dup:${r.id}`,
            category: "duplicate_attempt",
            title: `Duplicate payment attempts (${list.length})`,
            reference: r.paystack_reference,
            order_id: r.order_id,
            payment_id: r.id,
            user_id: r.user_id,
            customer_email: r.customer_email,
            tool_slug: r.tool_slug,
            amount: r.amount ? Number(r.amount) : null,
            currency: r.currency,
            created_at: r.initiated_at,
            detail: `${list.length} attempts in 24h for the same tool and amount.`,
            recommended_action: "Review & mark reconciled",
            action_key: "mark_reconciled",
          });
        }
      }
    }

    // 5) Webhook events that failed processing
    {
      const { data: rows } = await admin
        .from("paystack_webhook_events")
        .select(
          "id, event_type, transaction_reference, last_error, received_at, processing_attempts",
        )
        .eq("processing_status", "failed")
        .order("received_at", { ascending: false })
        .limit(50);
      for (const r of (rows ?? []) as any[]) {
        issues.push({
          id: `wh:${r.id}`,
          category: "webhook_failed",
          title: `Webhook failed: ${r.event_type}`,
          reference: r.transaction_reference,
          order_id: null,
          payment_id: null,
          user_id: null,
          customer_email: null,
          tool_slug: null,
          amount: null,
          currency: "NGN",
          created_at: r.received_at,
          detail: r.last_error ?? `Attempted ${r.processing_attempts} times.`,
          recommended_action: "Retry Webhook Processing",
          action_key: "retry_webhook",
        });
      }
    }

    // 6) Refund reconciliation requests (transactions flagged for refund)
    {
      const { data: rows } = await admin
        .from("tool_payments")
        .select(
          "id, paystack_reference, order_id, user_id, tool_slug, amount, currency, customer_email, initiated_at, reconciliation_note",
        )
        .in("reconciliation_status", ["open", "investigating"])
        .order("flagged_at", { ascending: false })
        .limit(50);
      for (const r of (rows ?? []) as any[]) {
        issues.push({
          id: `refund:${r.id}`,
          category: "refund_requested",
          title: "Flagged for review / refund",
          reference: r.paystack_reference,
          order_id: r.order_id,
          payment_id: r.id,
          user_id: r.user_id,
          customer_email: r.customer_email,
          tool_slug: r.tool_slug,
          amount: r.amount ? Number(r.amount) : null,
          currency: r.currency,
          created_at: r.initiated_at,
          detail: r.reconciliation_note ?? "Awaiting admin decision.",
          recommended_action: "Mark refunded or resolved",
          action_key: "mark_reconciled",
        });
      }
    }

    // 7) Cancelled transactions (last 30)
    {
      const { data: rows } = await admin
        .from("tool_payments")
        .select(
          "id, paystack_reference, order_id, user_id, tool_slug, amount, currency, customer_email, initiated_at",
        )
        .eq("payment_status", "abandoned")
        .order("initiated_at", { ascending: false })
        .limit(30);
      for (const r of (rows ?? []) as any[]) {
        issues.push({
          id: `cancel:${r.id}`,
          category: "cancelled_transaction",
          title: "Checkout abandoned",
          reference: r.paystack_reference,
          order_id: r.order_id,
          payment_id: r.id,
          user_id: r.user_id,
          customer_email: r.customer_email,
          tool_slug: r.tool_slug,
          amount: r.amount ? Number(r.amount) : null,
          currency: r.currency,
          created_at: r.initiated_at,
          detail: "Customer left the payment page.",
          recommended_action: "Resend checkout link",
          action_key: "mark_reconciled",
        });
      }
    }

    const summary = {
      paid_no_access: issues.filter((i) => i.category === "paid_no_access").length,
      failed_payment: issues.filter((i) => i.category === "failed_payment").length,
      pending_payment: issues.filter((i) => i.category === "pending_payment").length,
      duplicate_attempt: issues.filter((i) => i.category === "duplicate_attempt").length,
      webhook_failed: issues.filter((i) => i.category === "webhook_failed").length,
      refund_requested: issues.filter((i) => i.category === "refund_requested").length,
      cancelled_transaction: issues.filter((i) => i.category === "cancelled_transaction").length,
    };

    return { issues, summary };
  });

// ---------- ONE-CLICK ACTIONS ----------

export const retryAccessAssignment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ order_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const admin = await assertAdmin(context);
    const { data: order } = await admin
      .from("tool_orders")
      .select(
        "id, status, access_type, duration_days, grace_days, payment_type, paid_at, user_id, tool_slug",
      )
      .eq("id", data.order_id)
      .maybeSingle();
    if (!order) throw new Error("Order not found");

    let approved = false;
    if (order.status !== "approved") {
      const paidAt = order.paid_at ? new Date(order.paid_at) : new Date();
      const dur = (order.duration_days as number) ?? 28;
      const grace = (order.grace_days as number) ?? 0;
      const access = ((order.access_type as string) ?? "shared") as "shared" | "private";
      const isOneTime = (order.payment_type as string) === "one_time";
      if (access === "private") {
        await admin
          .from("tool_orders")
          .update({
            status: "approved",
            approved_at: paidAt.toISOString(),
            subscription_status: "pending",
            renewal_status: isOneTime ? "not_applicable" : "enabled",
            payment_status: "successful",
            fulfilment_status: "pending",
            fulfilment_deadline_at: new Date(paidAt.getTime() + 6 * 3600_000).toISOString(),
          })
          .eq("id", order.id);
      } else {
        const expiresAt = new Date(paidAt.getTime() + (dur + grace) * 86400_000);
        const nextAt = new Date(paidAt.getTime() + dur * 86400_000);
        await admin
          .from("tool_orders")
          .update({
            status: "approved",
            approved_at: paidAt.toISOString(),
            current_period_start: paidAt.toISOString(),
            current_period_end: isOneTime ? null : nextAt.toISOString(),
            next_payment_at: isOneTime ? null : nextAt.toISOString(),
            paid_through_at: isOneTime ? null : nextAt.toISOString(),
            expires_at: expiresAt.toISOString(),
            subscription_status: isOneTime ? "non_renewing" : "active",
            renewal_status: isOneTime ? "not_applicable" : "enabled",
            payment_status: "successful",
            fulfilment_status: "not_required",
          })
          .eq("id", order.id);
      }
      approved = true;
    }

    // Try to auto-assign an account from the pool.
    const { tryAutoAssignAccount } = await import("@/lib/account-pool.functions");
    const assignmentId = await tryAutoAssignAccount(admin, order.id);

    await logAdminActivity(context, {
      action: approved ? "recovery.approve_and_assign" : "recovery.retry_assignment",
      area: "payments",
      target_type: "tool_order",
      target_id: order.id,
      success: !!assignmentId,
      details: assignmentId ? `assignment=${assignmentId}` : "no pool account available",
    });

    return { ok: true, approved, assignment_id: assignmentId };
  });

export const retryWebhookEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ event_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const admin = await assertAdmin(context);
    const { data: ev } = await admin
      .from("paystack_webhook_events")
      .select("*")
      .eq("id", data.event_id)
      .maybeSingle();
    if (!ev) throw new Error("Webhook event not found");
    // Re-run the verify path if we still have the reference; then mark the
    // event processed. This is safer than replaying the raw payload.
    if (ev.transaction_reference) {
      try {
        const { adminRecheckPaystackTransaction } = await import("@/lib/transactions.functions");
        await (adminRecheckPaystackTransaction as any)({
          data: { reference: ev.transaction_reference },
        });
      } catch (err) {
        await admin
          .from("paystack_webhook_events")
          .update({
            processing_status: "failed",
            processing_attempts: (ev.processing_attempts ?? 0) + 1,
            last_error: (err as Error).message,
          })
          .eq("id", ev.id);
        await logAdminActivity(context, {
          action: "recovery.retry_webhook",
          area: "payments",
          target_type: "webhook_event",
          target_id: ev.id,
          success: false,
          details: (err as Error).message,
        });
        throw err;
      }
    }
    await admin
      .from("paystack_webhook_events")
      .update({
        processing_status: "processed",
        processed_at: new Date().toISOString(),
        last_error: null,
      })
      .eq("id", ev.id);
    await logAdminActivity(context, {
      action: "recovery.retry_webhook",
      area: "payments",
      target_type: "webhook_event",
      target_id: ev.id,
      success: true,
    });
    return { ok: true };
  });

export const markPaymentReconciled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        payment_id: z.string().uuid(),
        status: z.enum(["resolved", "refunded", "none"]),
        note: z.string().max(1000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const admin = await assertAdmin(context);
    await admin
      .from("tool_payments")
      .update({
        reconciliation_status: data.status,
        reconciliation_note: data.note ?? null,
        flagged_at: data.status === "none" ? null : new Date().toISOString(),
        flagged_reason: data.status === "none" ? null : (data.note ?? null),
      })
      .eq("id", data.payment_id);
    await logAdminActivity(context, {
      action: "recovery.mark_reconciled",
      area: "payments",
      target_type: "tool_payment",
      target_id: data.payment_id,
      reason: data.status,
      details: data.note,
    });
    return { ok: true };
  });
