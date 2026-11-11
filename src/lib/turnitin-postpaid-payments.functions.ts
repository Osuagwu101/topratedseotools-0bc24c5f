import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Record a postpaid payment received OUTSIDE the platform (bank transfer, WhatsApp, offline, other).
 * Uses the existing DB function turnitin_record_manual_postpaid_settlement, which allocates the money
 * to the customer's charges and rejects amounts above the outstanding balance.
 * Adds: admin check, duplicate-submission guard, and audit entries (billing audit + customer audit).
 */

const METHODS = ["bank_transfer", "whatsapp", "offline", "other"] as const;
type Method = (typeof METHODS)[number];
const inFlight = new Set<string>();

export const adminRecordPostpaidPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string; amountNgn: number; method: Method; note: string }) => d)
  .handler(async ({ context, data }) => {
    const { assertAdminRole } = await import("@/lib/turnitin-admin-gate");
    assertAdminRole(await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" }));
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;

    if (!/^[0-9a-f-]{36}$/i.test(data.userId)) throw new Error("Invalid customer.");
    const amount = Number(data.amountNgn);
    if (!Number.isInteger(amount) || amount < 1 || amount > 100_000_000) throw new Error("Enter a whole naira amount of at least ₦1.");
    if (!METHODS.includes(data.method)) throw new Error("Choose how the customer paid.");
    const note = String(data.note ?? "").trim();
    if (note.length < 3 || note.length > 1000) throw new Error("Enter a note (for example the bank reference), 3 to 1000 characters.");

    // Admin may record a verified partial or full offline payment; customer checkout remains full-only.
    const existing = await db.from("turnitin_postpaid_charges")
      .select("amount_ngn,paid_amount_ngn,status").eq("user_id", data.userId).limit(5001);
    if (existing.error) throw new Error("Unable to verify the customer's outstanding balance.");
    if ((existing.data ?? []).length >= 5001) throw new Error("Please contact support to reconcile this large account before recording payment.");
    const outstanding = (existing.data ?? [])
      .filter((c: any) => c.status !== "void")
      .reduce((total: number, c: any) =>
        total + Math.max(0, Number(c.amount_ngn ?? 0) - Number(c.paid_amount_ngn ?? 0)), 0);
    if (!Number.isInteger(outstanding) || outstanding <= 0)
      throw new Error("This customer has no outstanding postpaid balance.");
    if (amount > outstanding)
      throw new Error("The payment exceeds the customer's current outstanding balance.");

    // One recording at a time per customer, and no identical repeat within 2 minutes (double-click guard).
    if (inFlight.has(data.userId)) throw new Error("A payment for this customer is already being recorded. Please wait.");
    inFlight.add(data.userId);
    try {
      const since = new Date(Date.now() - 120_000).toISOString();
      const dup = await db.from("turnitin_postpaid_settlements").select("id")
        .eq("user_id", data.userId).eq("amount_ngn", amount).eq("note", note).gte("created_at", since).limit(1);
      if (!dup.error && (dup.data ?? []).length) throw new Error("This exact payment was just recorded. Refresh the page to see it; nothing was added again.");

      const audit = (action: string, success: boolean, details: Record<string, unknown>) =>
        db.from("admin_activity_log").insert({ actor_user_id: context.userId, actor_role: "admin", success, action,
          area: "turnitin_billing", target_type: "postpaid_customer", target_id: data.userId, reason: note,
          reference: JSON.stringify(details) });

      const started = await audit("postpaid_payment_record_started", true, { amountNgn: amount, method: data.method });
      if (started.error) throw new Error("The audit log could not be written, so nothing was recorded.");

      const { data: settlementId, error } = await db.rpc("turnitin_record_manual_postpaid_settlement", {
        _user_id: data.userId, _amount_ngn: amount, _method: data.method, _note: note, _admin_id: context.userId });

      if (error) {
        const m = String(error.message ?? "");
        const friendly = /EXCEEDS_OUTSTANDING/i.test(m) ? "The amount is more than this customer owes."
          : /NOTHING_OUTSTANDING/i.test(m) ? "This customer has nothing outstanding."
          : /ONLINE_SETTLEMENT_PENDING/i.test(m) ? "This customer has an online payment awaiting confirmation. Wait for it to finish before recording another payment."
          : m || "The payment could not be recorded.";
        await audit("postpaid_payment_record_failed", false, { amountNgn: amount, method: data.method, error: m });
        throw new Error(friendly);
      }

      await audit("postpaid_payment_record_completed", true, { amountNgn: amount, method: data.method, settlementId });
      // Keep the existing customer audit trail consistent with the customer page.
      await db.from("customer_admin_audit").insert({ customer_id: data.userId, admin_id: context.userId,
        action: "turnitin_postpaid_settlement_recorded", details: { settlement_id: settlementId, amount_ngn: amount, method: data.method, note } });

      // Any Admin-recorded payment (full or partial) starts a fresh usage cycle: the customer can submit
      // again until the next threshold. Any remaining balance stays due on its invoice.
      let cycleReset: "done" | "not_enforced" | "failed" = "not_enforced";
      const st = await db.from("turnitin_postpaid_billing_settings").select("restriction_enabled")
        .eq("user_id", data.userId).maybeSingle();
      if (!st.error && st.data?.restriction_enabled) {
        const rr = await db.rpc("turnitin_postpaid_reset_cycle", { _user_id: data.userId, _admin_id: context.userId,
          _kind: "admin_payment", _note: `Payment of NGN ${amount} recorded (${data.method}): ${note}` });
        cycleReset = rr.error ? "failed" : "done";
        await audit(rr.error ? "postpaid_cycle_reset_failed" : "postpaid_cycle_reset_completed", !rr.error,
          { trigger: "admin_payment", settlementId, amountNgn: amount, error: rr.error?.message ?? null });
      }
      return { ok: true as const, settlementId: String(settlementId), amountNgn: amount, cycleReset };
    } finally {
      inFlight.delete(data.userId);
    }
  });
