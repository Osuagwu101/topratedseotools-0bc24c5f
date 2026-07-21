/**
 * Platform-wide admin analytics — server functions.
 *
 * All figures represent the ENTIRE platform, not the logged-in admin's
 * customer account. Every function asserts admin via has_role and then uses
 * the service-role client to read across users. RLS is not weakened; these
 * are trusted server functions gated by role.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdminAndGetAdmin(context: {
  supabase: { rpc: (name: string, args: unknown) => Promise<{ data: unknown; error: unknown }> };
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

// -------- Types --------

export interface AdminOverview {
  cards: {
    totalUsers: number;
    activeSubscribers: number;
    allTimeSubscribers: number;
    activeSubscriptions: number;
    pendingOrders: number;
    cancelledExpiredOrders: number;
    pendingPrivateFulfilment: number;
    uniqueBuyers: number;
  };
  revenue: {
    today: number;
    thisMonth: number;
    thisYear: number;
    allTime: number;
    recurring: number;
    oneTime: number;
    successfulPayments: number;
    failedPayments: number;
    refunds: number;
  };
  attention: {
    privatePending: number;
    privateNearDeadline: number;
    failedRenewals: number;
    reconciliation: number;
    expiringSoon: number;
    cancelledOrders: number;
    renewalDisabled: number;
  };
  breakdown: {
    accessType: { shared: number; private: number };
    billingPeriod: { monthly: number; quarterly: number; yearly: number };
    paymentModel: { recurring: number; oneTime: number };
  };
  topTools: Array<{
    tool_slug: string;
    purchases: number;
    active: number;
    revenue: number;
  }>;
  trend: {
    days: string[]; // ISO date strings (YYYY-MM-DD)
    registrations: number[];
    newSubscribers: number[];
    revenueTotal: number[];
    revenueRecurring: number[];
    revenueOneTime: number[];
  };
  recentActivity: Array<{
    id: string;
    at: string;
    kind: string;
    label: string;
    detail: string | null;
    orderId: string | null;
    userId: string | null;
  }>;
}

// -------- Overview --------

const overviewInput = z
  .object({ trendDays: z.number().int().min(1).max(365).optional() })
  .optional();

export const getAdminOverview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => overviewInput.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const admin = await assertAdminAndGetAdmin(context);
    const trendDays = data?.trendDays ?? 30;
    const now = new Date();
    const nowIso = now.toISOString();

    const startOfDay = new Date(now); startOfDay.setUTCHours(0, 0, 0, 0);
    const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const startOfYear = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    const trendStart = new Date(now); trendStart.setUTCDate(trendStart.getUTCDate() - (trendDays - 1)); trendStart.setUTCHours(0, 0, 0, 0);
    const in7d = new Date(now.getTime() + 7 * 86400_000);
    const in6h = new Date(now.getTime() + 6 * 3600_000);

    // Parallel fetches
    const [
      profilesCountRes,
      profilesRes,
      ordersActiveRes,
      ordersAllRes,
      paymentsRes,
    ] = await Promise.all([
      admin.from("profiles").select("id", { count: "exact", head: true }),
      admin.from("profiles").select("id, email, full_name, created_at").order("created_at", { ascending: false }),
      admin
        .from("tool_orders")
        .select("id, user_id, tool_slug, status, access_type, billing_period, payment_type, expires_at, fulfilment_status, fulfilment_deadline_at, subscription_status, renewal_status, payment_status, created_at, updated_at, approved_at, price_amount")
        .eq("status", "approved"),
      admin
        .from("tool_orders")
        .select("id, user_id, tool_slug, status, access_type, fulfilment_status, fulfilment_deadline_at, subscription_status, renewal_status, expires_at, created_at, updated_at, approved_at")
        .order("created_at", { ascending: false })
        .limit(2000),
      admin
        .from("tool_payments")
        .select("id, user_id, order_id, tool_slug, payment_type, classification, amount, payment_status, paid_at, created_at")
        .order("created_at", { ascending: false })
        .limit(5000),
    ]);

    const profiles = profilesRes.data ?? [];
    const activeOrders = ordersActiveRes.data ?? [];
    const allOrders = ordersAllRes.data ?? [];
    const payments = paymentsRes.data ?? [];

    // Active (unexpired approved) subset
    const liveOrders = activeOrders.filter(
      (o) => !o.expires_at || new Date(o.expires_at as string) > now,
    );

    const successful = payments.filter((p) => p.payment_status === "successful");
    const uniqueBuyerSet = new Set(successful.map((p) => p.user_id as string));

    // ---- cards ----
    const cards = {
      totalUsers: profilesCountRes.count ?? profiles.length,
      activeSubscribers: new Set(liveOrders.map((o) => o.user_id as string)).size,
      allTimeSubscribers: uniqueBuyerSet.size,
      activeSubscriptions: liveOrders.length,
      pendingOrders: allOrders.filter((o) => o.status === "pending").length,
      cancelledExpiredOrders: allOrders.filter(
        (o) => o.status === "cancelled" || o.status === "expired" || o.status === "rejected",
      ).length,
      pendingPrivateFulfilment: allOrders.filter(
        (o) => (o.access_type ?? "") === "private" && o.fulfilment_status === "pending",
      ).length,
      uniqueBuyers: uniqueBuyerSet.size,
    };

    // ---- revenue ----
    const sum = (rows: typeof successful, pred?: (r: (typeof successful)[number]) => boolean) =>
      rows.reduce((acc, r) => (pred && !pred(r) ? acc : acc + Number(r.amount ?? 0)), 0);
    const paidAtDate = (r: (typeof successful)[number]) =>
      new Date((r.paid_at as string) ?? (r.created_at as string));
    const revenue = {
      today: sum(successful, (r) => paidAtDate(r) >= startOfDay),
      thisMonth: sum(successful, (r) => paidAtDate(r) >= startOfMonth),
      thisYear: sum(successful, (r) => paidAtDate(r) >= startOfYear),
      allTime: sum(successful),
      recurring: sum(successful, (r) => r.payment_type === "recurring_subscription"),
      oneTime: sum(successful, (r) => r.payment_type !== "recurring_subscription"),
      successfulPayments: successful.length,
      failedPayments: payments.filter((p) => p.payment_status === "failed").length,
      refunds: payments.filter(
        (p) => p.payment_status === "refunded" || p.payment_status === "reversed",
      ).length,
    };

    // ---- attention ----
    const attention = {
      privatePending: cards.pendingPrivateFulfilment,
      privateNearDeadline: allOrders.filter(
        (o) =>
          (o.access_type ?? "") === "private" &&
          o.fulfilment_status === "pending" &&
          o.fulfilment_deadline_at &&
          new Date(o.fulfilment_deadline_at as string) <= in6h,
      ).length,
      failedRenewals: allOrders.filter((o) => o.subscription_status === "past_due").length,
      reconciliation: allOrders.filter((o) => o.payment_status === "requires_review").length,
      expiringSoon: liveOrders.filter(
        (o) => o.expires_at && new Date(o.expires_at as string) <= in7d,
      ).length,
      cancelledOrders: allOrders.filter((o) => o.status === "cancelled").length,
      renewalDisabled: allOrders.filter(
        (o) => o.renewal_status === "disabled" || o.renewal_status === "disable_pending",
      ).length,
    };

    // ---- breakdown ----
    const breakdown = {
      accessType: {
        shared: liveOrders.filter((o) => (o.access_type ?? "shared") === "shared").length,
        private: liveOrders.filter((o) => o.access_type === "private").length,
      },
      billingPeriod: {
        monthly: liveOrders.filter((o) => o.billing_period === "monthly").length,
        quarterly: liveOrders.filter((o) => o.billing_period === "quarterly").length,
        yearly: liveOrders.filter((o) => o.billing_period === "yearly").length,
      },
      paymentModel: {
        recurring: liveOrders.filter((o) => o.payment_type === "recurring_subscription").length,
        oneTime: liveOrders.filter((o) => o.payment_type !== "recurring_subscription").length,
      },
    };

    // ---- top tools ----
    const toolMap = new Map<string, { purchases: number; active: number; revenue: number }>();
    for (const o of allOrders) {
      const slug = o.tool_slug as string;
      const t = toolMap.get(slug) ?? { purchases: 0, active: 0, revenue: 0 };
      t.purchases += 1;
      toolMap.set(slug, t);
    }
    for (const o of liveOrders) {
      const slug = o.tool_slug as string;
      const t = toolMap.get(slug) ?? { purchases: 0, active: 0, revenue: 0 };
      t.active += 1;
      toolMap.set(slug, t);
    }
    for (const p of successful) {
      const slug = p.tool_slug as string;
      const t = toolMap.get(slug) ?? { purchases: 0, active: 0, revenue: 0 };
      t.revenue += Number(p.amount ?? 0);
      toolMap.set(slug, t);
    }
    const topTools = Array.from(toolMap.entries())
      .map(([tool_slug, v]) => ({ tool_slug, ...v }))
      .sort((a, b) => b.revenue - a.revenue || b.purchases - a.purchases)
      .slice(0, 10);

    // ---- trend ----
    const days: string[] = [];
    for (let i = 0; i < trendDays; i++) {
      const d = new Date(trendStart);
      d.setUTCDate(trendStart.getUTCDate() + i);
      days.push(d.toISOString().slice(0, 10));
    }
    const zeroArr = () => new Array(trendDays).fill(0);
    const registrations = zeroArr();
    const newSubscribers = zeroArr();
    const revenueTotal = zeroArr();
    const revenueRecurring = zeroArr();
    const revenueOneTime = zeroArr();
    const bucket = (iso: string | null | undefined) => {
      if (!iso) return -1;
      const idx = days.indexOf(iso.slice(0, 10));
      return idx;
    };
    for (const p of profiles) {
      const i = bucket(p.created_at as string);
      if (i >= 0) registrations[i]++;
    }
    // New subscribers per day = distinct users whose FIRST successful payment fell in that day
    const firstPay = new Map<string, string>();
    for (const p of successful) {
      const at = (p.paid_at as string) ?? (p.created_at as string);
      const uid = p.user_id as string;
      const cur = firstPay.get(uid);
      if (!cur || new Date(at) < new Date(cur)) firstPay.set(uid, at);
    }
    for (const at of firstPay.values()) {
      const i = bucket(at);
      if (i >= 0) newSubscribers[i]++;
    }
    for (const p of successful) {
      const at = (p.paid_at as string) ?? (p.created_at as string);
      const i = bucket(at);
      if (i < 0) continue;
      const amt = Number(p.amount ?? 0);
      revenueTotal[i] += amt;
      if (p.payment_type === "recurring_subscription") revenueRecurring[i] += amt;
      else revenueOneTime[i] += amt;
    }

    // ---- recent activity (last ~25 events across orders + payments) ----
    type Ev = AdminOverview["recentActivity"][number];
    const events: Ev[] = [];
    for (const o of allOrders.slice(0, 40)) {
      events.push({
        id: `order-created-${o.id}`,
        at: o.created_at as string,
        kind: "order_created",
        label: "New order",
        detail: `${o.tool_slug} · ${o.status}`,
        orderId: o.id as string,
        userId: o.user_id as string,
      });
      if (o.status === "cancelled") {
        events.push({
          id: `order-cancelled-${o.id}`,
          at: (o.updated_at as string) ?? (o.created_at as string),
          kind: "order_cancelled",
          label: "Order cancelled",
          detail: o.tool_slug as string,
          orderId: o.id as string,
          userId: o.user_id as string,
        });
      }
      if (o.fulfilment_status === "active") {
        events.push({
          id: `order-fulfilled-${o.id}`,
          at: (o.updated_at as string) ?? (o.created_at as string),
          kind: "private_fulfilled",
          label: "Private order fulfilled",
          detail: o.tool_slug as string,
          orderId: o.id as string,
          userId: o.user_id as string,
        });
      }
      if (o.renewal_status === "disabled" || o.renewal_status === "disable_pending") {
        events.push({
          id: `renewal-off-${o.id}`,
          at: (o.updated_at as string) ?? (o.created_at as string),
          kind: "renewal_disabled",
          label: "Renewal disabled",
          detail: o.tool_slug as string,
          orderId: o.id as string,
          userId: o.user_id as string,
        });
      }
    }
    for (const p of payments.slice(0, 40)) {
      if (p.payment_status === "successful") {
        events.push({
          id: `pay-ok-${p.id}`,
          at: (p.paid_at as string) ?? (p.created_at as string),
          kind: p.classification === "renewal" ? "renewal_success" : "purchase",
          label: p.classification === "renewal" ? "Successful renewal" : "Successful purchase",
          detail: `${p.tool_slug} · ₦${Number(p.amount ?? 0).toLocaleString()}`,
          orderId: (p.order_id as string) ?? null,
          userId: p.user_id as string,
        });
      } else if (p.payment_status === "failed") {
        events.push({
          id: `pay-fail-${p.id}`,
          at: (p.paid_at as string) ?? (p.created_at as string),
          kind: p.classification === "renewal" ? "renewal_failed" : "payment_failed",
          label: p.classification === "renewal" ? "Failed renewal" : "Failed payment",
          detail: p.tool_slug as string,
          orderId: (p.order_id as string) ?? null,
          userId: p.user_id as string,
        });
      }
    }
    // Recent registrations
    for (const pr of profiles.slice(0, 20)) {
      events.push({
        id: `reg-${pr.id}`,
        at: pr.created_at as string,
        kind: "registration",
        label: "New user registration",
        detail: (pr.email as string) ?? (pr.full_name as string) ?? "New user",
        orderId: null,
        userId: pr.id as string,
      });
    }
    events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    const recentActivity = events.slice(0, 25);

    const overview: AdminOverview = {
      cards,
      revenue,
      attention,
      breakdown,
      topTools,
      trend: { days, registrations, newSubscribers, revenueTotal, revenueRecurring, revenueOneTime },
      recentActivity,
    };
    // Suppress noise in dev logs for unused variables
    void nowIso;
    return overview;
  });

// -------- Customer list --------

export type CustomerSegment =
  | "all"
  | "active"
  | "all_time"
  | "inactive"
  | "new";

const listInput = z.object({
  segment: z.enum(["all", "active", "all_time", "inactive", "new"]),
  search: z.string().trim().max(200).optional(),
  from: z.string().optional(), // ISO date
  to: z.string().optional(),
});

export interface PlatformCustomer {
  userId: string;
  email: string | null;
  fullName: string | null;
  registeredAt: string;
  purchases: number;
  activeSubscriptions: number;
  totalSpent: number;
  lastPaymentAt: string | null;
  status: "active" | "inactive" | "never_paid";
}

export const listPlatformCustomers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => listInput.parse(input))
  .handler(async ({ data, context }) => {
    const admin = await assertAdminAndGetAdmin(context);
    const now = new Date();

    const [profilesRes, ordersRes, paymentsRes] = await Promise.all([
      admin.from("profiles").select("id, email, full_name, created_at").order("created_at", { ascending: false }),
      admin
        .from("tool_orders")
        .select("id, user_id, status, expires_at")
        .in("status", ["approved", "pending", "cancelled", "rejected", "expired"]),
      admin
        .from("tool_payments")
        .select("user_id, amount, payment_status, paid_at, created_at"),
    ]);

    const profiles = profilesRes.data ?? [];
    const orders = ordersRes.data ?? [];
    const payments = paymentsRes.data ?? [];

    const activeByUser = new Map<string, number>();
    for (const o of orders) {
      if (
        o.status === "approved" &&
        (!o.expires_at || new Date(o.expires_at as string) > now)
      ) {
        const uid = o.user_id as string;
        activeByUser.set(uid, (activeByUser.get(uid) ?? 0) + 1);
      }
    }
    const succByUser = new Map<string, { count: number; total: number; last: string | null }>();
    for (const p of payments) {
      if (p.payment_status !== "successful") continue;
      const uid = p.user_id as string;
      const at = (p.paid_at as string) ?? (p.created_at as string);
      const cur = succByUser.get(uid) ?? { count: 0, total: 0, last: null };
      cur.count += 1;
      cur.total += Number(p.amount ?? 0);
      if (!cur.last || new Date(at) > new Date(cur.last)) cur.last = at;
      succByUser.set(uid, cur);
    }

    let rows: PlatformCustomer[] = profiles.map((p) => {
      const uid = p.id as string;
      const succ = succByUser.get(uid);
      const activeCount = activeByUser.get(uid) ?? 0;
      const purchases = succ?.count ?? 0;
      const status: PlatformCustomer["status"] =
        activeCount > 0 ? "active" : purchases > 0 ? "inactive" : "never_paid";
      return {
        userId: uid,
        email: (p.email as string) ?? null,
        fullName: (p.full_name as string) ?? null,
        registeredAt: p.created_at as string,
        purchases,
        activeSubscriptions: activeCount,
        totalSpent: succ?.total ?? 0,
        lastPaymentAt: succ?.last ?? null,
        status,
      };
    });

    // Segment filter
    if (data.segment === "active") rows = rows.filter((r) => r.status === "active");
    else if (data.segment === "all_time") rows = rows.filter((r) => r.purchases > 0);
    else if (data.segment === "inactive") rows = rows.filter((r) => r.status === "inactive");
    else if (data.segment === "new") {
      const from = data.from ? new Date(data.from) : new Date(now.getTime() - 7 * 86400_000);
      const to = data.to ? new Date(data.to) : now;
      rows = rows.filter((r) => {
        const d = new Date(r.registeredAt);
        return d >= from && d <= to;
      });
    }

    // Search
    if (data.search) {
      const q = data.search.toLowerCase();
      rows = rows.filter(
        (r) =>
          (r.email ?? "").toLowerCase().includes(q) ||
          (r.fullName ?? "").toLowerCase().includes(q),
      );
    }

    // Sort by registration date descending
    rows.sort((a, b) => new Date(b.registeredAt).getTime() - new Date(a.registeredAt).getTime());

    return { customers: rows.slice(0, 500), total: rows.length };
  });
