import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type AdminContext = { supabase: any; userId: string };

async function getAdminRole(ctx: AdminContext) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: role, error } = await (supabaseAdmin as any)
    .from("user_roles")
    .select("is_active, is_super_admin")
    .eq("user_id", ctx.userId)
    .eq("role", "admin")
    .maybeSingle();

  if (error) throw new Error(error.message);

  const { data: account, error: accountError } = await (supabaseAdmin as any)
    .from("admin_accounts")
    .select("user_id")
    .eq("user_id", ctx.userId)
    .maybeSingle();

  if (accountError) throw new Error(accountError.message);
  if (!role || role.is_active === false || !account) {
    throw new Error("Forbidden");
  }

  return { isSuperAdmin: !!role.is_super_admin };
}

async function assertAdmin(ctx: AdminContext) {
  return getAdminRole(ctx);
}

async function assertSuperAdmin(ctx: AdminContext) {
  const role = await getAdminRole(ctx);
  if (!role.isSuperAdmin) {
    throw new Error("Forbidden — Super Admin only");
  }
  return role;
}

const userInput = z.object({
  userId: z.string().uuid(),
});

export interface AdminTurnitinPostpaidControls {
  customer: {
    id: string;
    email: string | null;
    fullName: string | null;
  };
  caller: {
    isSuperAdmin: boolean;
  };
  account: {
    billingMode: "prepaid" | "postpaid";
    postpaidRateNgn: number | null;
    postpaidEnabledAt: string | null;
    postpaidDisabledAt: string | null;
  };
  billingSettings: { fileThreshold: number | null; triggerMode: string; reminderEnabled: boolean; reminderIntervalDays: number; dueDays: number | null };
  summary: {
    totalCharges: number;
    unpaidChecks: number;
    outstandingNgn: number;
    voidChecks: number;
  };
  rateHistory: Array<{
    id: string;
    previousRateNgn: number | null;
    newRateNgn: number;
    effectiveAt: string;
    changedBy: string | null;
    reason: string;
  }>;
  events: Array<{
    id: string;
    eventType: string;
    previousMode: string | null;
    newMode: string | null;
    previousRateNgn: number | null;
    newRateNgn: number | null;
    reason: string;
    actorAdminId: string | null;
    createdAt: string;
  }>;
}

export const adminGetTurnitinPostpaidControls = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => userInput.parse(input))
  .handler(async ({ data, context }): Promise<AdminTurnitinPostpaidControls> => {
    const caller = await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any;

    const [profileRes, settingsRes, chargesRes, historyRes, eventsRes] =
      await Promise.all([
        admin
          .from("profiles")
          .select("id, email, full_name")
          .eq("id", data.userId)
          .maybeSingle(),
        admin
          .from("turnitin_account_settings")
          .select(
            "user_id, billing_mode, postpaid_rate_ngn, postpaid_enabled_at, postpaid_disabled_at",
          )
          .eq("user_id", data.userId)
          .maybeSingle(),
        admin
          .from("turnitin_postpaid_charges")
          .select("id, status, amount_ngn, paid_amount_ngn")
          .eq("user_id", data.userId),
        admin
          .from("turnitin_postpaid_rate_history")
          .select(
            "id, previous_rate_ngn, new_rate_ngn, effective_at, changed_by, reason",
          )
          .eq("user_id", data.userId)
          .order("effective_at", { ascending: false })
          .limit(50),
        admin
          .from("turnitin_postpaid_account_events")
          .select(
            "id, event_type, previous_mode, new_mode, previous_rate_ngn, new_rate_ngn, reason, actor_admin_id, created_at",
          )
          .eq("user_id", data.userId)
          .order("created_at", { ascending: false })
          .limit(50),
      ]);

    if (profileRes.error) throw new Error(profileRes.error.message);
    if (!profileRes.data) throw new Error("Customer not found.");
    if (settingsRes.error) throw new Error(settingsRes.error.message);
    if (chargesRes.error) throw new Error(chargesRes.error.message);
    if (historyRes.error) throw new Error(historyRes.error.message);
    if (eventsRes.error) throw new Error(eventsRes.error.message);

    const settings = settingsRes.data as any | null;
    const charges = (chargesRes.data ?? []) as Array<any>;

    const outstandingNgn = charges.reduce((sum, charge) => {
      if (charge.status === "void") return sum;
      return (
        sum +
        Math.max(
          0,
          Number(charge.amount_ngn ?? 0) - Number(charge.paid_amount_ngn ?? 0),
        )
      );
    }, 0);

    const billing = await admin.from("turnitin_postpaid_billing_settings")
      .select("file_threshold,trigger_mode,reminder_enabled,reminder_interval_days,due_days")
      .eq("user_id", data.userId).maybeSingle();
    if (billing.error) throw new Error(billing.error.message);
    return {
      billingSettings: { fileThreshold: billing.data?.file_threshold ?? null,
        triggerMode: billing.data?.trigger_mode ?? "monthly", reminderEnabled: billing.data?.reminder_enabled ?? true,
        reminderIntervalDays: billing.data?.reminder_interval_days ?? 3, dueDays: billing.data?.due_days ?? null },
      customer: {
        id: profileRes.data.id as string,
        email: (profileRes.data.email as string | null) ?? null,
        fullName: (profileRes.data.full_name as string | null) ?? null,
      },
      caller: {
        isSuperAdmin: caller.isSuperAdmin,
      },
      account: {
        billingMode:
          settings?.billing_mode === "postpaid" ? "postpaid" : "prepaid",
        postpaidRateNgn:
          settings?.postpaid_rate_ngn == null
            ? null
            : Number(settings.postpaid_rate_ngn),
        postpaidEnabledAt: settings?.postpaid_enabled_at ?? null,
        postpaidDisabledAt: settings?.postpaid_disabled_at ?? null,
      },
      summary: {
        totalCharges: charges.length,
        unpaidChecks: charges.filter(
          (charge) =>
            charge.status === "unpaid" || charge.status === "partially_paid",
        ).length,
        outstandingNgn,
        voidChecks: charges.filter((charge) => charge.status === "void").length,
      },
      rateHistory: (historyRes.data ?? []).map((row: any) => ({
        id: String(row.id),
        previousRateNgn:
          row.previous_rate_ngn == null ? null : Number(row.previous_rate_ngn),
        newRateNgn: Number(row.new_rate_ngn),
        effectiveAt: String(row.effective_at),
        changedBy: row.changed_by ? String(row.changed_by) : null,
        reason: String(row.reason ?? ""),
      })),
      events: (eventsRes.data ?? []).map((row: any) => ({
        id: String(row.id),
        eventType: String(row.event_type),
        previousMode: row.previous_mode ? String(row.previous_mode) : null,
        newMode: row.new_mode ? String(row.new_mode) : null,
        previousRateNgn:
          row.previous_rate_ngn == null ? null : Number(row.previous_rate_ngn),
        newRateNgn:
          row.new_rate_ngn == null ? null : Number(row.new_rate_ngn),
        reason: String(row.reason ?? ""),
        actorAdminId: row.actor_admin_id ? String(row.actor_admin_id) : null,
        createdAt: String(row.created_at),
      })),
    };
  });

const statusInput = z.object({
  userId: z.string().uuid(),
  enabled: z.boolean(),
  fileThreshold: z.number().int().min(1).max(100000).optional(),
  rateNgn: z.number().int().min(1).max(10_000_000).nullable(),
  reason: z.string().trim().min(3).max(1000),
});

export const adminSetTurnitinPostpaidStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => statusInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context);

    if (data.enabled && (!data.rateNgn || data.rateNgn <= 0)) {
      throw new Error("Enter the agreed Postpaid price per check.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any;

    if (data.enabled) {
      if (!data.fileThreshold) throw new Error("Enter the allowed file threshold before enabling Postpaid.");
      const policy = await admin.from("turnitin_postpaid_billing_settings")
        .select("file_threshold,restriction_enabled,trigger_mode").eq("user_id", data.userId).maybeSingle();
      if (policy.error) throw new Error("Could not verify the saved threshold. Postpaid was not enabled.");
      if (!policy.data?.restriction_enabled || policy.data.trigger_mode !== "files" ||
          Number(policy.data.file_threshold) !== data.fileThreshold)
        throw new Error("Save the allowed file threshold before enabling Postpaid.");
    }

    const { data: mode, error } = await admin.rpc(
      "turnitin_set_postpaid_status",
      {
        _user_id: data.userId,
        _enabled: data.enabled,
        _rate_ngn: data.enabled ? data.rateNgn : null,
        _reason: data.reason,
        _admin_id: context.userId,
      },
    );

    if (error) {
      const message = String(error.message ?? "");
      if (/TURNITIN_POSTPAID_OUTSTANDING_BALANCE/i.test(message)) {
        throw new Error(
          "This customer still has an outstanding Postpaid balance. Settle it before returning the account to Prepaid.",
        );
      }
      if (/TURNITIN_POSTPAID_ACTIVE_JOBS/i.test(message)) {
        throw new Error(
          "This customer still has active Postpaid checks. Wait for them to finish before returning the account to Prepaid.",
        );
      }
      throw new Error(message || "Could not update Turnitin billing mode.");
    }

    const { error: auditError } = await admin.from("customer_admin_audit").insert({
      customer_id: data.userId,
      admin_id: context.userId,
      action: data.enabled
        ? "turnitin_postpaid_enabled"
        : "turnitin_postpaid_disabled",
      details: {
        billing_mode: String(mode),
        rate_ngn: data.enabled ? data.rateNgn : null,
        reason: data.reason,
      },
    });
    if (auditError) {
      console.warn(
        "[turnitin-postpaid] billing mode changed but customer audit insert failed",
        auditError.message,
      );
    }

    return {
      ok: true as const,
      billingMode: String(mode) as "prepaid" | "postpaid",
    };
  });

const rateInput = z.object({
  userId: z.string().uuid(),
  rateNgn: z.number().int().min(1).max(10_000_000),
  reason: z.string().trim().min(3).max(1000),
});

export const adminUpdateTurnitinPostpaidRate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => rateInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any;

    const { data: rate, error } = await admin.rpc(
      "turnitin_update_postpaid_rate",
      {
        _user_id: data.userId,
        _new_rate_ngn: data.rateNgn,
        _reason: data.reason,
        _admin_id: context.userId,
      },
    );

    if (error) throw new Error(error.message);

    const { error: auditError } = await admin.from("customer_admin_audit").insert({
      customer_id: data.userId,
      admin_id: context.userId,
      action: "turnitin_postpaid_rate_changed",
      details: {
        new_rate_ngn: Number(rate),
        reason: data.reason,
      },
    });
    if (auditError) {
      console.warn(
        "[turnitin-postpaid] rate changed but customer audit insert failed",
        auditError.message,
      );
    }

    return {
      ok: true as const,
      rateNgn: Number(rate),
    };
  });


export const adminGetCustomerTurnitinHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ userId: z.string().uuid(), page: z.number().int().min(0),
    pageSize: z.union([z.literal(10), z.literal(25), z.literal(50)]) }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, count, error } = await (supabaseAdmin as any).from("turnitin_jobs")
      .select("id,original_filename,display_name,status,created_at,similarity_percentage,ai_percentage", { count: "exact" })
      .eq("user_id", data.userId).order("created_at", { ascending: false }).order("id", { ascending: false })
      .range(data.page * data.pageSize, (data.page + 1) * data.pageSize - 1);
    if (error) throw new Error("Could not load Turnitin checking history.");
    return { rows: rows as Array<{ id: string; original_filename: string; display_name: string | null;
      status: string; created_at: string; similarity_percentage: number | null; ai_percentage: number | null }>, total: count ?? 0 };
  });


export const adminGetCustomerPostpaidCharges = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ userId: z.string().uuid(), page: z.number().int().min(0),
    pageSize: z.union([z.literal(10), z.literal(25), z.literal(50)]) }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { data: rows, count, error } = await db.from("turnitin_postpaid_charges")
      .select("id,job_id,rate_ngn,amount_ngn,paid_amount_ngn,status,charged_at", { count: "exact" })
      .eq("user_id", data.userId).order("charged_at", { ascending: false }).order("id", { ascending: false })
      .range(data.page * data.pageSize, (data.page + 1) * data.pageSize - 1);
    if (error) throw new Error("Could not load Postpaid check ledger.");
    const jobIds = [...new Set((rows ?? []).map((r: any) => r.job_id))];
    const names = new Map<string, string>();
    if (jobIds.length) {
      const jobs = await db.from("turnitin_jobs").select("id,original_filename,display_name")
        .eq("user_id", data.userId).in("id", jobIds);
      if (jobs.error) throw new Error("Could not load check document names.");
      for (const job of jobs.data ?? []) names.set(job.id, job.display_name || job.original_filename);
    }
    return { total: count ?? 0, rows: (rows ?? []).map((r: any) => ({ id: String(r.id),
      documentName: names.get(r.job_id) ?? "Turnitin check", chargedAt: String(r.charged_at),
      rateNgn: Number(r.rate_ngn), amountNgn: Number(r.amount_ngn), paidAmountNgn: Number(r.paid_amount_ngn), status: String(r.status) })) as Array<{ id: string; documentName: string; chargedAt: string; rateNgn: number; amountNgn: number; paidAmountNgn: number; status: string }> };
  });
