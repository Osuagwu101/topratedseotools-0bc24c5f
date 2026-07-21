/**
 * Transactions & receipts — customer + admin server functions.
 *
 * A "transaction" here is a single row in `tool_payments` keyed by the
 * unique Paystack reference (or, for offline records, an admin-created row).
 *
 * Guarantees:
 *  - Every checkout attempt creates exactly one row (status=initiated) at
 *    init time; every subsequent webhook / verify / recheck updates the
 *    same row identified by `paystack_reference`.
 *  - Status changes are appended to `tool_payment_status_history`.
 *  - Customers only see their own rows; admin queries use the service role.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { mapPaystackStatus, type PaymentStatus } from "@/lib/transaction-status";

// ---------- Types ----------

export interface TransactionRow {
  id: string;
  paystack_reference: string | null;
  paystack_transaction_id: string | null;
  order_id: string | null;
  user_id: string;
  tool_slug: string;
  amount: number | null;
  currency: string;
  payment_status: PaymentStatus;
  payment_type: string;
  classification: string;
  access_type: string | null;
  billing_period: string | null;
  price_label: string | null;
  payment_channel: string | null;
  paystack_status: string | null;
  paystack_environment: string;
  source: string;
  customer_email: string | null;
  customer_name: string | null;
  initiated_at: string;
  paid_at: string | null;
  paystack_last_checked_at: string | null;
  receipt_sent_at: string | null;
  receipt_last_status: string | null;
  reconciliation_status: "none" | "open" | "investigating" | "resolved" | "refunded";
  reconciliation_note: string | null;
  flagged_at: string | null;
  flagged_reason: string | null;
  last_status_change_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface StatusHistoryRow {
  id: string;
  from_status: string | null;
  to_status: string;
  source: string;
  paystack_status: string | null;
  note: string | null;
  created_at: string;
  created_by: string | null;
}

// ---------- Customer ----------

/** Auth — current user's transactions, newest first. */
export const listMyTransactions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("tool_payments")
      .select("*")
      .eq("user_id", context.userId)
      .order("initiated_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return { transactions: (data ?? []) as unknown as TransactionRow[] };
  });

/** Auth — full receipt (transaction row + status history) by paystack reference. */
export const getMyTransactionReceipt = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ reference: z.string().min(4).max(200) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: tx, error } = await context.supabase
      .from("tool_payments")
      .select("*")
      .eq("paystack_reference", data.reference)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!tx) throw new Error("Transaction not found");
    const { data: history } = await context.supabase
      .from("tool_payment_status_history")
      .select("*")
      .eq("payment_id", (tx as { id: string }).id)
      .order("created_at", { ascending: true });
    return {
      transaction: tx as unknown as TransactionRow,
      history: (history ?? []) as unknown as StatusHistoryRow[],
    };
  });

// ---------- Admin ----------

async function assertAdmin(context: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  userId: string;
}) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) throw new Error(String((error as { message?: string }).message ?? "role check failed"));
  if (!data) throw new Error("Forbidden");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

const listInput = z.object({
  search: z.string().trim().max(200).optional(),
  status: z
    .enum([
      "all",
      "initiated",
      "pending",
      "processing",
      "successful",
      "failed",
      "requires_review",
      "refunded",
      "reversed",
      "abandoned",
    ])
    .optional(),
  environment: z.enum(["all", "test", "live", "offline", "legacy"]).optional(),
  tool_slug: z.string().max(120).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.number().int().min(1).max(500).optional(),
});

export interface AdminTransactionRow extends TransactionRow {
  customer_profile_email: string | null;
  customer_profile_name: string | null;
}

/** Admin — list transactions with server-side filtering. */
export const adminListTransactions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => listInput.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const admin = await assertAdmin(context);
    let q = admin
      .from("tool_payments")
      .select("*")
      .order("initiated_at", { ascending: false })
      .limit(data.limit ?? 200);

    if (data.status && data.status !== "all") q = q.eq("payment_status", data.status);
    if (data.environment && data.environment !== "all") q = q.eq("paystack_environment", data.environment);
    if (data.tool_slug) q = q.eq("tool_slug", data.tool_slug);
    if (data.from) q = q.gte("initiated_at", data.from);
    if (data.to) q = q.lte("initiated_at", data.to);

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    // Enrich with profile info + optional textual search.
    const userIds = Array.from(new Set((rows ?? []).map((r: { user_id: string }) => r.user_id)));
    let profileMap = new Map<string, { email: string | null; full_name: string | null }>();
    if (userIds.length) {
      const { data: profiles } = await admin
        .from("profiles")
        .select("id, email, full_name")
        .in("id", userIds);
      profileMap = new Map(
        (profiles ?? []).map((p: { id: string; email: string | null; full_name: string | null }) => [
          p.id,
          { email: p.email, full_name: p.full_name },
        ]),
      );
    }

    let out: AdminTransactionRow[] = (rows ?? []).map((r: TransactionRow) => {
      const prof = profileMap.get(r.user_id) ?? { email: null, full_name: null };
      return {
        ...r,
        customer_profile_email: prof.email,
        customer_profile_name: prof.full_name,
      };
    });

    if (data.search) {
      const s = data.search.toLowerCase();
      out = out.filter((r) => {
        return (
          r.paystack_reference?.toLowerCase().includes(s) ||
          r.paystack_transaction_id?.toLowerCase().includes(s) ||
          r.order_id?.toLowerCase().includes(s) ||
          r.customer_email?.toLowerCase().includes(s) ||
          r.customer_profile_email?.toLowerCase().includes(s) ||
          r.customer_profile_name?.toLowerCase().includes(s) ||
          r.tool_slug.toLowerCase().includes(s)
        );
      });
    }

    return { transactions: out };
  });

/** Admin — one transaction by reference, with full history. */
export const adminGetTransaction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ reference: z.string().min(4).max(200) }).parse(input))
  .handler(async ({ data, context }) => {
    const admin = await assertAdmin(context);
    const { data: tx } = await admin
      .from("tool_payments")
      .select("*")
      .eq("paystack_reference", data.reference)
      .maybeSingle();
    if (!tx) throw new Error("Transaction not found");
    const [{ data: history }, { data: profile }, { data: order }] = await Promise.all([
      admin
        .from("tool_payment_status_history")
        .select("*")
        .eq("payment_id", tx.id)
        .order("created_at", { ascending: true }),
      admin
        .from("profiles")
        .select("id, email, full_name")
        .eq("id", tx.user_id)
        .maybeSingle(),
      tx.order_id
        ? admin.from("tool_orders").select("*").eq("id", tx.order_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    return {
      transaction: tx as unknown as AdminTransactionRow,
      history: (history ?? []) as unknown as StatusHistoryRow[],
      profile,
      order,
    };
  });

/** Admin — recheck a transaction directly with Paystack and reconcile. */
export const adminRecheckPaystackTransaction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ reference: z.string().min(4).max(200) }).parse(input))
  .handler(async ({ data, context }) => {
    const admin = await assertAdmin(context);
    const { data: tx } = await admin
      .from("tool_payments")
      .select("*")
      .eq("paystack_reference", data.reference)
      .maybeSingle();
    if (!tx) throw new Error("Transaction not found");

    const secret = process.env.PAYSTACK_SECRET_KEY;
    if (!secret) throw new Error("Paystack is not configured on the server.");

    const res = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(data.reference)}`,
      { headers: { Authorization: `Bearer ${secret}` } },
    );
    const json = (await res.json()) as {
      status?: boolean;
      message?: string;
      data?: {
        status?: string;
        reference?: string;
        amount?: number;
        currency?: string;
        channel?: string;
        id?: number | string;
        paid_at?: string;
        customer?: { email?: string; first_name?: string; last_name?: string };
      };
    };

    if (!res.ok || !json.status || !json.data) {
      // Log the recheck attempt as a status history note but don't mutate the row.
      await admin.from("tool_payment_status_history").insert({
        payment_id: tx.id,
        from_status: tx.payment_status,
        to_status: tx.payment_status,
        source: "recheck",
        paystack_status: null,
        note: `Recheck failed: ${json.message ?? `HTTP ${res.status}`}`,
        created_by: context.userId,
      });
      throw new Error(json.message ?? "Paystack rejected the recheck.");
    }

    const psStatus = json.data.status ?? null;
    const mapped = mapPaystackStatus(psStatus);
    const patch: Record<string, unknown> = {
      paystack_status: psStatus,
      paystack_last_checked_at: new Date().toISOString(),
      paystack_transaction_id: json.data.id ? String(json.data.id) : tx.paystack_transaction_id,
      payment_channel: json.data.channel ?? tx.payment_channel,
    };

    // Only advance status forward; never rewrite a successful record.
    if (tx.payment_status !== "successful" && mapped !== tx.payment_status) {
      patch.payment_status = mapped;
      patch.last_status_change_at = new Date().toISOString();
      if (mapped === "successful") {
        patch.paid_at = json.data.paid_at ?? new Date().toISOString();
      }
    }

    await admin.from("tool_payments").update(patch).eq("id", tx.id);

    await admin.from("tool_payment_status_history").insert({
      payment_id: tx.id,
      from_status: tx.payment_status,
      to_status: (patch.payment_status as PaymentStatus | undefined) ?? tx.payment_status,
      source: "recheck",
      paystack_status: psStatus,
      note: `Admin rechecked with Paystack (${psStatus ?? "unknown"})`,
      created_by: context.userId,
    });

    // If Paystack now confirms success and no access has been granted, hand
    // off to the existing verify pipeline via a service-role update mirroring
    // its side effects, but only when the order isn't already approved.
    if (
      mapped === "successful" &&
      tx.payment_status !== "successful" &&
      tx.order_id
    ) {
      const { data: order } = await admin
        .from("tool_orders")
        .select("id, status, access_type, duration_days, grace_days, payment_type")
        .eq("id", tx.order_id)
        .maybeSingle();
      if (order && order.status !== "approved") {
        const paidAt = new Date();
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
              paid_at: paidAt.toISOString(),
              subscription_status: "pending",
              renewal_status: isOneTime ? "not_applicable" : "enabled",
              payment_status: "successful",
              fulfilment_status: "pending",
              fulfilment_deadline_at: new Date(paidAt.getTime() + 6 * 3600_000).toISOString(),
            })
            .eq("id", order.id)
            .neq("status", "approved");
        } else {
          const expiresAt = new Date(paidAt.getTime() + (dur + grace) * 86400_000);
          const nextAt = new Date(paidAt.getTime() + dur * 86400_000);
          await admin
            .from("tool_orders")
            .update({
              status: "approved",
              approved_at: paidAt.toISOString(),
              paid_at: paidAt.toISOString(),
              subscription_started_at: paidAt.toISOString(),
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
            .eq("id", order.id)
            .neq("status", "approved");
        }
      }
    }

    return { ok: true, status: mapped, paystack_status: psStatus };
  });

const reconcileInput = z.object({
  reference: z.string().min(4).max(200),
  reconciliation_status: z.enum(["none", "open", "investigating", "resolved", "refunded"]),
  note: z.string().max(2000).optional(),
});

/** Admin — set the reconciliation state on a transaction. */
export const adminUpdateReconciliation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => reconcileInput.parse(input))
  .handler(async ({ data, context }) => {
    const admin = await assertAdmin(context);
    const { data: tx } = await admin
      .from("tool_payments")
      .select("id, reconciliation_status")
      .eq("paystack_reference", data.reference)
      .maybeSingle();
    if (!tx) throw new Error("Transaction not found");
    await admin
      .from("tool_payments")
      .update({
        reconciliation_status: data.reconciliation_status,
        reconciliation_note: data.note ?? null,
        flagged_at:
          data.reconciliation_status === "none" ? null : new Date().toISOString(),
        flagged_reason: data.reconciliation_status === "none" ? null : data.note ?? null,
      })
      .eq("id", tx.id);
    await admin.from("tool_payment_status_history").insert({
      payment_id: tx.id,
      from_status: null,
      to_status: `reconciliation:${data.reconciliation_status}`,
      source: "admin",
      note: data.note ?? null,
      created_by: context.userId,
    });
    return { ok: true };
  });
