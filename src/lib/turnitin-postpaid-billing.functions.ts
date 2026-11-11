import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Phase 5 — postpaid billing for administrators.
 * Reads: balances, invoices (with derived status), statements, reconciliation exceptions, audit.
 * Writes (audited, admin-only): invoice generation via the idempotent DB function, and per-customer
 * billing settings. Nothing here marks charges or invoices paid: paid status always comes from
 * recorded settlements/allocations.
 */

const LIMIT = 5000;

async function admin(context: any) {
  const { assertAdminRole } = await import("@/lib/turnitin-admin-gate");
  assertAdminRole(await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" }));
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}
const must = <T,>(r: { data: T; error: any }, what: string): T => {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data;
};
const UUID = /^[0-9a-f-]{36}$/i;

async function audit(db: any, actorId: string, rec: { action: string; success: boolean; targetType: string;
  targetId: string; reason?: string | null; details: Record<string, unknown> }, strict: boolean) {
  const { error } = await db.from("admin_activity_log").insert({
    actor_user_id: actorId, actor_role: "admin", success: rec.success, action: rec.action, area: "turnitin_billing",
    target_type: rec.targetType, target_id: rec.targetId, reason: rec.reason ?? null, reference: JSON.stringify(rec.details),
  });
  if (error && strict) throw new Error("The audit log could not be written, so nothing was changed.");
}

async function loadBooks(db: any) {
  const [charges, settlements, allocations, invoices, lines, settings, cycleInvoices, cycleLines, notifications] = await Promise.all([
    db.from("turnitin_postpaid_charges").select("id,user_id,job_id,rate_ngn,amount_ngn,paid_amount_ngn,status,charged_at,voided_at,void_reason").limit(LIMIT),
    db.from("turnitin_postpaid_settlements").select("id,user_id,amount_ngn,allocated_amount_ngn,status,method,payment_gateway,payment_reference,gateway_reference,gateway_transaction_id,confirmed_at,failed_at,created_at").limit(LIMIT),
    db.from("turnitin_postpaid_allocations").select("id,settlement_id,charge_id,amount_ngn,allocated_at").limit(LIMIT),
    db.from("turnitin_postpaid_invoices").select("id,invoice_ref,user_id,period_start,period_end,amount_due_ngn,status,issued_at,due_at,created_by,created_at").order("created_at", { ascending: false }).limit(LIMIT),
    db.from("turnitin_postpaid_invoice_lines").select("id,invoice_id,charge_id,rate_ngn_at_use,amount_ngn,job_id,used_at").limit(LIMIT),
    db.from("turnitin_postpaid_billing_settings").select("user_id,billing_period,due_days,trigger_mode,file_threshold,restriction_enabled,restriction_override,restriction_started_at,policy_effective_at,reminder_enabled,reminder_interval_days,cycle_reset_at,cycle_reset_by,cycle_reset_kind,cycle_reset_note,updated_at").limit(LIMIT),
    db.from("turnitin_postpaid_cycle_invoices").select("id,invoice_ref,user_id,trigger_mode,trigger_reason,cycle_started_at,file_count,amount_due_ngn,issued_at,due_at").order("issued_at", { ascending: false }).limit(LIMIT),
    db.from("turnitin_postpaid_cycle_invoice_lines").select("id,invoice_id,charge_id,job_id,rate_ngn_at_use,amount_ngn,used_at").limit(LIMIT),
    db.from("turnitin_postpaid_notifications").select("invoice_id,kind,status,sent_at,attempts,last_error").limit(LIMIT),
  ]);
  const b = {
    charges: must(charges, "charges") as any[], settlements: must(settlements, "payments") as any[],
    allocations: must(allocations, "allocations") as any[], invoices: must(invoices, "invoices") as any[],
    lines: must(lines, "invoice lines") as any[], settings: must(settings, "billing settings") as any[],
    cycleInvoices: must(cycleInvoices, "cycle invoices") as any[],
    cycleLines: must(cycleLines, "cycle invoice lines") as any[],
    notifications: must(notifications,"postpaid notifications") as any[],
  };
  const limited = Object.values(b).some((rows) => rows.length >= LIMIT);
  const jobIdList = [...new Set(b.charges.map((c) => c.job_id).filter(Boolean))] as string[];
  const jobIds = new Set<string>();
  for (let i = 0; i < jobIdList.length; i += 200) {
    const r = await db.from("turnitin_jobs").select("id").in("id", jobIdList.slice(i, i + 200));
    for (const j of must(r, "jobs") as any[]) jobIds.add(j.id);
  }
  return { ...b, jobIds, limited };
}

async function emailsFor(db: any, ids: string[]) {
  const m = new Map<string, { email: string | null; name: string | null }>();
  if (!ids.length) return m;
  const r = await db.from("profiles").select("id,email,full_name").in("id", ids.slice(0, 1000));
  if (!r.error) for (const p of r.data ?? []) m.set(p.id, { email: p.email ?? null, name: p.full_name ?? null });
  return m;
}

export const adminGetPostpaidBillingOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = await admin(context);
    const { customerBalances, reconcile, invoiceState } = await import("@/lib/turnitin-postpaid-billing");
    const refresh = await db.rpc("turnitin_postpaid_refresh_monthly_due");
    if (refresh.error) console.warn("Postpaid monthly invoice refresh failed", refresh.error.message);
    const books = await loadBooks(db);
    const now = new Date();
    const chargesById = new Map(books.charges.map((c) => [c.id, c]));
    const linesByInvoice = new Map<string, any[]>();
    for (const l of books.lines) linesByInvoice.set(l.invoice_id, [...(linesByInvoice.get(l.invoice_id) ?? []), l]);
    const invoices = books.invoices.map((inv) => ({ ...inv, lineCount: (linesByInvoice.get(inv.id) ?? []).length,
      derived: invoiceState(inv, linesByInvoice.get(inv.id) ?? [], chargesById, now) }));
    const cycleLinesByInvoice = new Map<string, any[]>();
    for (const l of books.cycleLines) cycleLinesByInvoice.set(l.invoice_id, [...(cycleLinesByInvoice.get(l.invoice_id) ?? []), l]);
    const cycleInvoiceRows = books.cycleInvoices.map((inv) => {
      const rows = cycleLinesByInvoice.get(inv.id) ?? [];
      let billed = 0, paid = 0, liveCount = 0;
      for (const line of rows) {
        const c = chargesById.get(line.charge_id);
        if (!c || c.status === "void") continue;
        liveCount++;
        const n = Number(line.amount_ngn ?? 0);
        billed += n;
        paid += Math.min(n, Number(c.paid_amount_ngn ?? 0));
      }
      const outstanding = Math.max(0, billed - paid);
      const state = rows.length && !liveCount ? "voided" :
        outstanding === 0 ? "settled" :
        inv.due_at && now > new Date(inv.due_at) ? "overdue" :
        paid > 0 ? "partially_paid" : "due";
      const notice = books.notifications.filter((n) => n.invoice_id === inv.id && n.kind === "invoice");
      return { ...inv, lineCount: rows.length, derived: { billed, paid, outstanding, state },
        emailStatus: notice.length ? notice[0].status : "not_queued" };
    });
    const overdueByUser = new Map<string, number>();
    for (const i of invoices) if (i.derived.state === "overdue") overdueByUser.set(i.user_id, (overdueByUser.get(i.user_id) ?? 0) + 1);
    const settingsByUser = new Map(books.settings.map((s) => [s.user_id, s]));
    const balances = customerBalances(books.charges, books.settlements, books.allocations);
    const people = await emailsFor(db, [...new Set([...balances.map((b) => b.userId), ...invoices.map((i) => i.user_id)])]);
    const exceptions = reconcile({ charges: books.charges, settlements: books.settlements, allocations: books.allocations,
      invoices: books.invoices, lines: books.lines, jobIds: books.jobIds });
    const policyPairs = await Promise.all(balances.map(async (b) => {
      if (!settingsByUser.get(b.userId)?.restriction_enabled) return [b.userId, null] as const;
      const r = await db.rpc("turnitin_postpaid_policy_status", { _user_id: b.userId });
      return [b.userId, r.error ? null : r.data] as const;
    }));
    const policyByUser = new Map<string, any>(policyPairs);
    const auditRes = await db.from("admin_activity_log").select("id,actor_email,actor_user_id,action,target_type,target_id,success,reason,reference,created_at")
      .eq("area", "turnitin_billing").order("created_at", { ascending: false }).limit(100);
    return {
      generatedAt: now.toISOString(), limited: books.limited,
      customers: balances.map((b) => ({ ...b, email: people.get(b.userId)?.email ?? null, name: people.get(b.userId)?.name ?? null,
        overdueInvoices: overdueByUser.get(b.userId) ?? 0, billingPeriod: settingsByUser.get(b.userId)?.billing_period ?? "monthly",
        dueDays: settingsByUser.get(b.userId)?.due_days ?? null,
        triggerMode: settingsByUser.get(b.userId)?.trigger_mode ?? "monthly",
        fileThreshold: settingsByUser.get(b.userId)?.file_threshold ?? null,
        restrictionEnabled: !!settingsByUser.get(b.userId)?.restriction_enabled,
        restrictionOverride: !!settingsByUser.get(b.userId)?.restriction_override,
        cycleResetAt: settingsByUser.get(b.userId)?.cycle_reset_at ?? null,
        cycleResetKind: settingsByUser.get(b.userId)?.cycle_reset_kind ?? null,
        cycleResetNote: settingsByUser.get(b.userId)?.cycle_reset_note ?? null,
        policyState: policyByUser.get(b.userId) ?? null,
        reminderEnabled: settingsByUser.get(b.userId)?.reminder_enabled ?? true,
        reminderIntervalDays: settingsByUser.get(b.userId)?.reminder_interval_days ?? 3 })),
      invoices: invoices.map((i) => ({ ...i, email: people.get(i.user_id)?.email ?? null })),
      cycleInvoices: cycleInvoiceRows.map((i) => ({ ...i, email: people.get(i.user_id)?.email ?? null })),
      openCharges: books.charges.filter((c) => c.status !== "void" && Number(c.amount_ngn) > Number(c.paid_amount_ngn))
        .map((c) => ({ ...c, email: people.get(c.user_id)?.email ?? null })),
      settlements: books.settlements.filter((s) => s.status === "confirmed").map((s) => ({ ...s, email: people.get(s.user_id)?.email ?? null })),
      exceptions,
      audit: auditRes.error ? [] : auditRes.data ?? [],
    };
  });

export const adminGetPostpaidStatement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string; from: string; to: string }) => d)
  .handler(async ({ context, data }) => {
    const db = await admin(context);
    if (!UUID.test(data.userId)) throw new Error("Invalid customer.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data.from) || !/^\d{4}-\d{2}-\d{2}$/.test(data.to) || data.to <= data.from)
      throw new Error("Choose a valid statement period.");
    const [summary, charges, settlements, allocations] = await Promise.all([
      db.rpc("turnitin_postpaid_statement", { _user_id: data.userId, _from: data.from, _to: data.to }),
      db.from("turnitin_postpaid_charges").select("id,job_id,upstream_submission_id,rate_ngn,amount_ngn,paid_amount_ngn,status,charged_at,voided_at,void_reason")
        .eq("user_id", data.userId).or(`and(charged_at.gte.${data.from},charged_at.lt.${data.to}),and(voided_at.gte.${data.from},voided_at.lt.${data.to})`)
        .order("charged_at", { ascending: true }).limit(LIMIT),
      db.from("turnitin_postpaid_settlements").select("id,amount_ngn,allocated_amount_ngn,status,method,payment_gateway,payment_reference,gateway_reference,confirmed_at,created_at")
        .eq("user_id", data.userId).eq("status", "confirmed").gte("confirmed_at", data.from).lt("confirmed_at", data.to)
        .order("confirmed_at", { ascending: true }).limit(LIMIT),
      db.from("turnitin_postpaid_allocations").select("settlement_id,charge_id,amount_ngn").limit(LIMIT),
    ]);
    const s = (must(summary, "statement") as any[])?.[0] ?? {};
    const people = await emailsFor(db, [data.userId]);
    return {
      customer: { id: data.userId, ...(people.get(data.userId) ?? { email: null, name: null }) },
      period: { from: data.from, to: data.to },
      openingBalance: Number(s.opening_balance_ngn ?? 0), charges: Number(s.charges_ngn ?? 0),
      payments: Number(s.settlements_ngn ?? 0), voids: Number(s.voids_ngn ?? 0),
      closingBalance: Number(s.closing_balance_ngn ?? 0), outstanding: Number(s.outstanding_ngn ?? 0),
      chargeLines: must(charges, "charges") as any[],
      paymentLines: must(settlements, "payments") as any[],
      allocations: (must(allocations, "allocations") as any[]).filter((a) =>
        (must(settlements, "payments") as any[]).some((p) => p.id === a.settlement_id)),
      generatedAt: new Date().toISOString(),
    };
  });

export const adminGeneratePostpaidInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string; periodStart: string; periodEnd: string; reason: string }) => d)
  .handler(async ({ context, data }) => {
    const db = await admin(context);
    const { validatePeriod } = await import("@/lib/turnitin-postpaid-billing");
    if (!UUID.test(data.userId)) throw new Error("Invalid customer.");
    validatePeriod(data.periodStart, data.periodEnd, new Date());
    const reason = String(data.reason ?? "").trim();
    if (reason.length < 5 || reason.length > 300) throw new Error("Enter a reason between 5 and 300 characters.");
    const details = { customerId: data.userId, periodStart: data.periodStart, periodEnd: data.periodEnd };
    await audit(db, context.userId, { action: "postpaid_invoice_generate_started", success: true, targetType: "postpaid_customer",
      targetId: data.userId, reason, details }, true);
    // Idempotent in the database: returns the existing invoice if one exists for this customer and period.
    const r = await db.rpc("turnitin_generate_postpaid_invoice", { _user_id: data.userId, _period_start: data.periodStart,
      _period_end: data.periodEnd, _actor: context.userId });
    if (r.error) {
      await audit(db, context.userId, { action: "postpaid_invoice_generate_failed", success: false, targetType: "postpaid_customer",
        targetId: data.userId, reason, details: { ...details, error: r.error.message } }, false);
      throw new Error(`Invoice could not be generated: ${r.error.message}`);
    }
    const inv = await db.from("turnitin_postpaid_invoices").select("id,invoice_ref,amount_due_ngn,status,created_at")
      .eq("user_id", data.userId).eq("period_start", data.periodStart).eq("period_end", data.periodEnd).maybeSingle();
    const invoice = must(inv, "invoice") as any;
    await audit(db, context.userId, { action: "postpaid_invoice_generate_completed", success: true, targetType: "postpaid_invoice",
      targetId: invoice?.id ?? String(r.data ?? ""), reason, details: { ...details, invoiceRef: invoice?.invoice_ref ?? null,
        amountDue: invoice?.amount_due_ngn ?? null, rpcResult: r.data ?? null } }, false);
    return { invoice, rpcResult: r.data ?? null };
  });

export const adminSetPostpaidBillingSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string; billingPeriod: "monthly"; triggerMode: "monthly" | "files" | "hybrid";
    fileThreshold: number | null; restrictionEnabled: boolean; dueDays: number | null;
    reminderEnabled: boolean; reminderIntervalDays: number; reason: string }) => d)
  .handler(async ({ context, data }) => {
    const db = await admin(context);
    if (!UUID.test(data.userId)) throw new Error("Invalid customer.");
    if (data.billingPeriod !== "monthly") throw new Error("Invalid billing period.");
    if (!["monthly", "files", "hybrid"].includes(data.triggerMode)) throw new Error("Invalid billing trigger.");
    const dueDays = data.dueDays == null ? null : Number(data.dueDays);
    if (dueDays != null && (!Number.isInteger(dueDays) || dueDays < 0 || dueDays > 90))
      throw new Error("Due days must be between 0 and 90, or blank.");
    const threshold = data.triggerMode === "monthly" ? null : Number(data.fileThreshold);
    if (data.triggerMode !== "monthly" && (!Number.isInteger(threshold) || threshold! < 1 || threshold! > 100000))
      throw new Error("File threshold must be a whole number from 1 to 100,000.");
    if (data.restrictionEnabled !== true) throw new Error("Automatic restrictions are required for all billing modes. Admin can manually lift a restriction.");
    const reason = String(data.reason ?? "").trim();
    if (reason.length < 5 || reason.length > 300) throw new Error("Enter a reason between 5 and 300 characters.");
    const before = await db.from("turnitin_postpaid_billing_settings").select("*").eq("user_id", data.userId).maybeSingle();
    if (before.error) throw new Error(before.error.message);
    const b = before.data as any;
    // Legacy Admin bundles may omit reminder inputs: preserve existing settings.
    const reminderEnabled = typeof data.reminderEnabled === "boolean"
      ? data.reminderEnabled : (b?.reminder_enabled ?? true);
    const reminderIntervalDays = data.reminderIntervalDays == null
      ? Number(b?.reminder_interval_days ?? 3) : Number(data.reminderIntervalDays);
    if (!Number.isInteger(reminderIntervalDays) || reminderIntervalDays < 1 || reminderIntervalDays > 30)
      throw new Error("Payment reminders must repeat every 1 to 30 days.");
    const policyChanged = (b?.trigger_mode ?? "monthly") !== data.triggerMode
      || Number(b?.file_threshold ?? 0) !== Number(threshold ?? 0)
      || !!b?.restriction_enabled !== data.restrictionEnabled;
    const now = new Date().toISOString();
    const next: Record<string, any> = { user_id: data.userId, billing_period: "monthly", due_days: dueDays,
      trigger_mode: data.triggerMode, file_threshold: threshold, restriction_enabled: data.restrictionEnabled,
      reminder_enabled: reminderEnabled, reminder_interval_days: reminderIntervalDays,
      updated_by: context.userId, updated_at: now };
    if (policyChanged || !b) Object.assign(next, { policy_effective_at: now, restriction_started_at: now,
      restriction_override: false, restriction_override_by: null, restriction_override_at: null });
    await audit(db, context.userId, { action: "postpaid_billing_settings_change_started", success: true,
      targetType: "postpaid_customer", targetId: data.userId, reason, details: { before: b ?? null, after: next } }, true);
    const r = await db.from("turnitin_postpaid_billing_settings").upsert(next, { onConflict: "user_id" });
    if (r.error) {
      await audit(db, context.userId, { action: "postpaid_billing_settings_change_failed", success: false,
        targetType: "postpaid_customer", targetId: data.userId, reason, details: { error: r.error.message } }, false);
      throw new Error(r.error.message);
    }
    await audit(db, context.userId, { action: "postpaid_billing_settings_change_completed", success: true,
      targetType: "postpaid_customer", targetId: data.userId, reason, details: { before: b ?? null, after: next } }, false);
    return { ok: true };
  });

export const adminSetPostpaidRestrictionOverride = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string; lift: boolean; reason: string }) => d)
  .handler(async ({ context, data }) => {
    const db = await admin(context);
    if (!UUID.test(data.userId) || typeof data.lift !== "boolean") throw new Error("Invalid request.");
    const reason = String(data.reason ?? "").trim();
    if (reason.length < 5 || reason.length > 300) throw new Error("Enter a reason between 5 and 300 characters.");
    const before = await db.from("turnitin_postpaid_billing_settings")
      .select("restriction_enabled,restriction_override,trigger_mode,file_threshold")
      .eq("user_id", data.userId).maybeSingle();
    if (before.error) throw new Error(before.error.message);
    if (!before.data?.restriction_enabled) throw new Error("Enable billing restrictions for this customer first.");
    await audit(db, context.userId, { action: "postpaid_restriction_override_started", success: true,
      targetType: "postpaid_customer", targetId: data.userId, reason,
      details: { prior: before.data.restriction_override, requested: data.lift } }, true);
    const r = await db.from("turnitin_postpaid_billing_settings").update({
      restriction_override: data.lift, restriction_override_by: data.lift ? context.userId : null,
      restriction_override_at: data.lift ? new Date().toISOString() : null,
      updated_by: context.userId, updated_at: new Date().toISOString(),
    }).eq("user_id", data.userId).eq("restriction_enabled", true).select("user_id").single();
    if (r.error) {
      await audit(db, context.userId, { action: "postpaid_restriction_override_failed", success: false,
        targetType: "postpaid_customer", targetId: data.userId, reason,
        details: { requested: data.lift, error: r.error.message } }, false);
      throw new Error(r.error.message);
    }
    await audit(db, context.userId, { action: "postpaid_restriction_override_completed", success: true,
      targetType: "postpaid_customer", targetId: data.userId, reason,
      details: { before: before.data.restriction_override, after: data.lift } }, false);
    return { ok: true };
  });


/**
 * Admin lifts a postpaid restriction with a required note. This starts a fresh usage cycle:
 * the customer can submit until the next threshold, then is restricted again automatically.
 * Outstanding balances are untouched and stay payable.
 */
export const adminLiftPostpaidRestriction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string; note: string }) => d)
  .handler(async ({ context, data }) => {
    const db = await admin(context);
    if (!UUID.test(data.userId)) throw new Error("Invalid customer.");
    const note = String(data.note ?? "").trim();
    if (note.length < 5 || note.length > 1000) throw new Error("Enter an Admin note between 5 and 1,000 characters explaining why.");
    await audit(db, context.userId, { action: "postpaid_restriction_lift_started", success: true,
      targetType: "postpaid_customer", targetId: data.userId, reason: note, details: { kind: "manual_lift" } }, true);
    const r = await db.rpc("turnitin_postpaid_reset_cycle", { _user_id: data.userId, _admin_id: context.userId,
      _kind: "manual_lift", _note: note });
    if (r.error) {
      const m = String(r.error.message ?? "");
      await audit(db, context.userId, { action: "postpaid_restriction_lift_failed", success: false,
        targetType: "postpaid_customer", targetId: data.userId, reason: note, details: { error: m } }, false);
      throw new Error(/RESTRICTION_NOT_ENABLED/.test(m) ? "Save a billing policy for this customer first."
        : /NOT_ADMIN/.test(m) ? "Only Admin can lift a restriction." : m || "The restriction could not be lifted.");
    }
    await audit(db, context.userId, { action: "postpaid_restriction_lift_completed", success: true,
      targetType: "postpaid_customer", targetId: data.userId, reason: note, details: { policy: r.data } }, false);
    await db.from("customer_admin_audit").insert({ customer_id: data.userId, admin_id: context.userId,
      action: "turnitin_postpaid_restriction_lifted", details: { note, policy: r.data } });
    return { ok: true as const, policy: r.data };
  });
