/**
 * Admin-only customer management: create customer accounts, assign tools
 * with offline payments, cancel admin-assigned subscriptions, load customer
 * detail. Never touches the online Paystack checkout flow.
 *
 * All server functions gate on `has_role(userId,'admin')` and use the
 * service-role client for privileged reads/writes.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Duration mapping used everywhere offline access windows are computed.
export const PERIOD_DAYS = { monthly: 28, quarterly: 90, yearly: 365 } as const;
export type BillingPeriod = keyof typeof PERIOD_DAYS;
export type AccessType = "shared" | "private";
export type PaymentMethod = "bank_transfer" | "cash" | "whatsapp" | "other";

/** Pure helper — used by the server fn and unit tests. */
export function computeAccessWindow(input: {
  startDate: string | Date;
  period: BillingPeriod;
  graceDays?: number;
}): { start: Date; end: Date; durationDays: number } {
  const start = typeof input.startDate === "string" ? new Date(input.startDate) : input.startDate;
  const dur = PERIOD_DAYS[input.period];
  const grace = input.graceDays ?? 0;
  const end = new Date(start.getTime() + (dur + grace) * 86_400_000);
  return { start, end, durationDays: dur };
}

/**
 * Duplicate detector — same customer + tool + amount + date (±1 day) OR same
 * non-empty reference note counts as a possible duplicate.
 */
export interface OfflinePaymentLike {
  user_id: string;
  tool_slug: string;
  amount: number;
  paid_at: string;
  reference_note?: string | null;
  source?: string;
}
export function findOfflineDuplicates<T extends OfflinePaymentLike>(
  existing: T[],
  candidate: OfflinePaymentLike,
): T[] {
  const day = 24 * 3600_000;
  const cAt = new Date(candidate.paid_at).getTime();
  const cRef = (candidate.reference_note ?? "").trim().toLowerCase();
  return existing.filter((r) => {
    if (r.user_id !== candidate.user_id || r.tool_slug !== candidate.tool_slug) return false;
    if (Number(r.amount) !== Number(candidate.amount)) return false;
    const sameDay = Math.abs(new Date(r.paid_at).getTime() - cAt) <= day;
    const sameRef =
      cRef.length > 0 && (r.reference_note ?? "").trim().toLowerCase() === cRef;
    return sameDay || sameRef;
  });
}

async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase.rpc("has_role", {
    _user_id: ctx.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden");
}

async function assertNotAdminEmail(admin: any, email: string) {
  const { data } = await admin
    .from("admin_accounts")
    .select("user_id")
    .eq("account_email", email)
    .maybeSingle();
  if (data) {
    throw new Error(
      "This email belongs to an Admin account and cannot be used for a customer.",
    );
  }
}

// -------- Create customer --------

const createInput = z.object({
  email: z.string().email().transform((v) => v.trim().toLowerCase()),
  fullName: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
});

export const adminCreateCustomer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => createInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await assertNotAdminEmail(supabaseAdmin, data.email);

    // Existing customer? open it instead.
    const { data: existing } = await supabaseAdmin
      .from("profiles")
      .select("id, email, full_name")
      .eq("email", data.email)
      .maybeSingle();

    let userId: string;
    let existed = false;
    let invited = false;

    if (existing) {
      userId = existing.id as string;
      existed = true;
    } else {
      const { data: created, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(
        data.email,
        { data: { full_name: data.fullName } },
      );
      if (error || !created.user) {
        throw new Error(error?.message ?? "Could not send customer invitation.");
      }
      userId = created.user.id;
      invited = true;
      // handle_new_user trigger creates the profile row; nudge full_name in case
      await supabaseAdmin
        .from("profiles")
        .update({ full_name: data.fullName, email: data.email })
        .eq("id", userId);
    }

    // Upsert admin metadata (phone + notes)
    if (data.phone || data.notes) {
      await supabaseAdmin.from("customer_admin_meta").upsert(
        {
          user_id: userId,
          phone: data.phone || null,
          admin_notes: data.notes || null,
          updated_by: context.userId,
        },
        { onConflict: "user_id" },
      );
    }

    await supabaseAdmin.from("customer_admin_audit").insert({
      customer_id: userId,
      admin_id: context.userId,
      action: existed ? "customer_reopened" : "customer_created",
      details: {
        email: data.email,
        full_name: data.fullName,
        invited,
      },
    });

    return { userId, existed, invited };
  });

// -------- Assign tool + record offline payment --------

const assignInput = z.object({
  userId: z.string().uuid(),
  toolSlug: z.string().min(1).max(120),
  accessType: z.enum(["shared", "private"]),
  billingPeriod: z.enum(["monthly", "quarterly", "yearly"]),
  startDate: z.string(), // ISO date or datetime
  amount: z.number().nonnegative().max(10_000_000),
  paymentDate: z.string(),
  paymentMethod: z.enum(["bank_transfer", "cash", "whatsapp", "other"]),
  referenceNote: z.string().trim().max(200).optional().or(z.literal("")),
  adminNote: z.string().trim().max(2000).optional().or(z.literal("")),
  confirmDuplicate: z.boolean().optional(),
});

export const adminAssignTool = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => assignInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Duplicate check across this customer's OFFLINE payments
    const { data: prior } = await supabaseAdmin
      .from("tool_payments")
      .select("id, user_id, tool_slug, amount, paid_at, reference_note, source")
      .eq("user_id", data.userId)
      .eq("tool_slug", data.toolSlug)
      .eq("source", "offline");

    const dupes = findOfflineDuplicates(prior ?? [], {
      user_id: data.userId,
      tool_slug: data.toolSlug,
      amount: data.amount,
      paid_at: data.paymentDate,
      reference_note: data.referenceNote,
    });

    if (dupes.length && !data.confirmDuplicate) {
      return {
        ok: false as const,
        duplicate: true,
        duplicates: dupes.map((d) => ({
          id: d.id,
          amount: d.amount,
          paid_at: d.paid_at,
          reference_note: d.reference_note,
        })),
      };
    }

    const { start, end, durationDays } = computeAccessWindow({
      startDate: data.startDate,
      period: data.billingPeriod,
    });

    const isShared = data.accessType === "shared";
    // Pick a plan snapshot if one exists for label/currency; not required.
    const { data: plan } = await supabaseAdmin
      .from("tool_pricing")
      .select("id, currency, label")
      .eq("tool_slug", data.toolSlug)
      .eq("access_type", data.accessType)
      .eq("billing_period", data.billingPeriod)
      .limit(1)
      .maybeSingle();

    const paidAtIso = new Date(data.paymentDate).toISOString();
    const startIso = start.toISOString();
    const endIso = end.toISOString();

    const orderInsert = {
      user_id: data.userId,
      tool_slug: data.toolSlug,
      pricing_option_id: (plan?.id as string | undefined) ?? null,
      price_amount: data.amount,
      price_label: (plan?.label as string | null) ?? null,
      currency: (plan?.currency as string | undefined) ?? "₦",
      status: "approved" as const,
      access_type: data.accessType,
      billing_period: data.billingPeriod,
      payment_type: "one_time" as const,
      product_type: "subscription" as const,
      paystack_environment: "offline" as const,
      payment_status: "successful" as const,
      subscription_status: "non_renewing" as const,
      renewal_status: "not_applicable" as const,
      fulfilment_status: isShared ? "not_required" : "pending",
      fulfilment_deadline_at: isShared
        ? null
        : new Date(new Date(paidAtIso).getTime() + 6 * 3600_000).toISOString(),
      duration_days: durationDays,
      grace_days: 0,
      warning_days: 0,
      origin: "offline",
      created_by_admin: context.userId,
      admin_notes: data.adminNote || null,
      approved_at: paidAtIso,
      paid_at: paidAtIso,
      subscription_started_at: startIso,
      current_period_start: startIso,
      current_period_end: endIso,
      expires_at: endIso,
    };

    const { data: order, error: orderErr } = await supabaseAdmin
      .from("tool_orders")
      .insert(orderInsert)
      .select("id")
      .single();
    if (orderErr) throw new Error(orderErr.message);

    const { data: payment, error: payErr } = await supabaseAdmin
      .from("tool_payments")
      .insert({
        order_id: order.id,
        user_id: data.userId,
        tool_slug: data.toolSlug,
        amount: data.amount,
        currency: (plan?.currency as string | undefined) ?? "NGN",
        payment_status: "successful",
        payment_type: "one_time",
        classification: "one_time",
        paystack_environment: "offline",
        source: "offline",
        payment_method: data.paymentMethod,
        reference_note: data.referenceNote || null,
        admin_note: data.adminNote || null,
        recorded_by: context.userId,
        paid_at: paidAtIso,
      })
      .select("id")
      .single();
    if (payErr) throw new Error(payErr.message);

    await supabaseAdmin.from("customer_admin_audit").insert({
      customer_id: data.userId,
      admin_id: context.userId,
      action: "tool_assigned_offline",
      order_id: order.id,
      payment_id: payment.id,
      details: {
        tool_slug: data.toolSlug,
        access_type: data.accessType,
        billing_period: data.billingPeriod,
        amount: data.amount,
        payment_method: data.paymentMethod,
        reference_note: data.referenceNote ?? null,
        start: startIso,
        end: endIso,
      },
    });

    return { ok: true as const, orderId: order.id, paymentId: payment.id, expiresAt: endIso };
  });

// -------- Cancel an admin-assigned subscription --------

export const adminCancelAssignedOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        orderId: z.string().uuid(),
        reason: z.string().trim().max(500).optional().or(z.literal("")),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: order, error } = await supabaseAdmin
      .from("tool_orders")
      .select("id, user_id, origin, status")
      .eq("id", data.orderId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!order) throw new Error("Order not found");
    if (order.origin !== "offline") {
      throw new Error("Only admin-assigned (offline) orders can be cancelled here.");
    }
    const nowIso = new Date().toISOString();
    await supabaseAdmin
      .from("tool_orders")
      .update({
        status: "cancelled",
        cancelled_at: nowIso,
        cancelled_by: context.userId,
        cancellation_reason: data.reason || null,
        expires_at: nowIso,
        subscription_status: "cancelled",
      })
      .eq("id", data.orderId);

    await supabaseAdmin.from("customer_admin_audit").insert({
      customer_id: order.user_id,
      admin_id: context.userId,
      action: "order_cancelled",
      order_id: data.orderId,
      details: { reason: data.reason ?? null },
    });
    return { ok: true };
  });

// -------- Update customer admin meta (phone / notes) --------

export const adminUpdateCustomerMeta = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        userId: z.string().uuid(),
        phone: z.string().trim().max(40).optional().or(z.literal("")),
        notes: z.string().trim().max(4000).optional().or(z.literal("")),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("customer_admin_meta").upsert(
      {
        user_id: data.userId,
        phone: data.phone || null,
        admin_notes: data.notes || null,
        updated_by: context.userId,
      },
      { onConflict: "user_id" },
    );
    await supabaseAdmin.from("customer_admin_audit").insert({
      customer_id: data.userId,
      admin_id: context.userId,
      action: "meta_updated",
      details: { phone: data.phone ?? null, notes_len: (data.notes ?? "").length },
    });
    return { ok: true };
  });

// -------- Load customer detail --------

export interface CustomerDetail {
  profile: {
    id: string;
    email: string | null;
    fullName: string | null;
    registeredAt: string;
  };
  meta: { phone: string | null; adminNotes: string | null } | null;
  orders: Array<{
    id: string;
    toolSlug: string;
    accessType: string | null;
    billingPeriod: string | null;
    status: string;
    origin: string;
    amount: number | null;
    startedAt: string | null;
    expiresAt: string | null;
    createdAt: string;
    fulfilmentStatus: string | null;
  }>;
  payments: Array<{
    id: string;
    orderId: string | null;
    toolSlug: string;
    amount: number;
    source: string;
    paymentMethod: string | null;
    referenceNote: string | null;
    paidAt: string | null;
    status: string;
    paymentType: string;
  }>;
  totals: {
    totalPaid: number;
    onlinePaid: number;
    offlinePaid: number;
    lastPaymentAt: string | null;
    activeSubscriptions: number;
    expiredSubscriptions: number;
  };
  audit: Array<{
    id: string;
    action: string;
    at: string;
    adminId: string | null;
    orderId: string | null;
    details: unknown;
  }>;
}

export const adminGetCustomerDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ userId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<CustomerDetail> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [profRes, metaRes, ordersRes, paymentsRes, auditRes] = await Promise.all([
      supabaseAdmin.from("profiles").select("id, email, full_name, created_at").eq("id", data.userId).maybeSingle(),
      supabaseAdmin.from("customer_admin_meta").select("phone, admin_notes").eq("user_id", data.userId).maybeSingle(),
      supabaseAdmin
        .from("tool_orders")
        .select(
          "id, tool_slug, access_type, billing_period, status, origin, price_amount, subscription_started_at, expires_at, created_at, fulfilment_status",
        )
        .eq("user_id", data.userId)
        .order("created_at", { ascending: false }),
      supabaseAdmin
        .from("tool_payments")
        .select(
          "id, order_id, tool_slug, amount, source, payment_method, reference_note, paid_at, created_at, payment_status, payment_type",
        )
        .eq("user_id", data.userId)
        .order("paid_at", { ascending: false, nullsFirst: false }),
      supabaseAdmin
        .from("customer_admin_audit")
        .select("id, action, created_at, admin_id, order_id, details")
        .eq("customer_id", data.userId)
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

    if (!profRes.data) throw new Error("Customer not found");
    const now = new Date();
    const orders = (ordersRes.data ?? []).map((o: any) => ({
      id: o.id,
      toolSlug: o.tool_slug,
      accessType: o.access_type,
      billingPeriod: o.billing_period,
      status: o.status,
      origin: o.origin ?? "paystack",
      amount: o.price_amount != null ? Number(o.price_amount) : null,
      startedAt: o.subscription_started_at,
      expiresAt: o.expires_at,
      createdAt: o.created_at,
      fulfilmentStatus: o.fulfilment_status,
    }));
    const successful = (paymentsRes.data ?? []).filter((p: any) => p.payment_status === "successful");
    const totalPaid = successful.reduce((a: number, p: any) => a + Number(p.amount ?? 0), 0);
    const onlinePaid = successful
      .filter((p: any) => (p.source ?? "paystack") === "paystack")
      .reduce((a: number, p: any) => a + Number(p.amount ?? 0), 0);
    const offlinePaid = successful
      .filter((p: any) => p.source === "offline")
      .reduce((a: number, p: any) => a + Number(p.amount ?? 0), 0);
    const lastPaymentAt =
      successful.reduce<string | null>((latest, p: any) => {
        const at = (p.paid_at as string) ?? (p.created_at as string);
        if (!latest || new Date(at) > new Date(latest)) return at;
        return latest;
      }, null);
    const activeSubscriptions = orders.filter(
      (o) => o.status === "approved" && (!o.expiresAt || new Date(o.expiresAt) > now),
    ).length;
    const expiredSubscriptions = orders.filter(
      (o) =>
        o.status === "expired" ||
        (o.status === "approved" && o.expiresAt && new Date(o.expiresAt) <= now),
    ).length;

    return {
      profile: {
        id: profRes.data.id as string,
        email: (profRes.data.email as string) ?? null,
        fullName: (profRes.data.full_name as string) ?? null,
        registeredAt: profRes.data.created_at as string,
      },
      meta: metaRes.data
        ? {
            phone: (metaRes.data.phone as string) ?? null,
            adminNotes: (metaRes.data.admin_notes as string) ?? null,
          }
        : null,
      orders,
      payments: (paymentsRes.data ?? []).map((p: any) => ({
        id: p.id,
        orderId: p.order_id,
        toolSlug: p.tool_slug,
        amount: Number(p.amount ?? 0),
        source: p.source ?? "paystack",
        paymentMethod: p.payment_method ?? null,
        referenceNote: p.reference_note ?? null,
        paidAt: p.paid_at ?? p.created_at,
        status: p.payment_status,
        paymentType: p.payment_type,
      })),
      totals: {
        totalPaid,
        onlinePaid,
        offlinePaid,
        lastPaymentAt,
        activeSubscriptions,
        expiredSubscriptions,
      },
      audit: (auditRes.data ?? []).map((a: any) => ({
        id: a.id,
        action: a.action,
        at: a.created_at,
        adminId: a.admin_id,
        orderId: a.order_id,
        details: a.details,
      })),
    };
  });
