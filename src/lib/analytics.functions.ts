/**
 * Phase 6 — Business analytics server functions.
 *
 * Thin admin-only wrappers around existing tables. Everything here is
 * additive: revenue math already lives in `admin-analytics.functions`, this
 * module only adds filtered slices, tool performance, and CSV export.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdminAndGetAdmin(context: {
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

const rangeInput = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  tool_slug: z.string().trim().max(120).optional(),
  payment_method: z.string().trim().max(60).optional(),
  /** paystack | flutterwave | monnify | offline */
  gateway: z.string().trim().max(40).optional(),
  /** NGN | GHS | KES | USD | ZAR */
  payment_currency: z.string().trim().max(10).optional(),
});

function defaultRange(from?: string, to?: string) {
  const toIso = to ?? new Date().toISOString();
  const fromIso = from ?? new Date(Date.now() - 30 * 86400_000).toISOString();
  return { fromIso, toIso };
}

/** Presentation-only classification, mirrors `src/lib/transaction-display.ts`. */
function rowGateway(p: Record<string, unknown>): string {
  if ((p.source as string) === "offline") return "offline";
  return String(p.payment_gateway ?? p.source ?? "paystack").toLowerCase();
}
function rowCurrency(p: Record<string, unknown>): string {
  return String(p.payment_currency ?? p.display_currency ?? "NGN").toUpperCase();
}
/** Amount actually charged to the customer, in `rowCurrency`. */
function rowPaidAmount(p: Record<string, unknown>): number {
  const cur = rowCurrency(p);
  if (p.display_currency && String(p.display_currency).toUpperCase() === cur && p.display_amount != null) {
    return Number(p.display_amount);
  }
  if (p.final_amount != null) return Number(p.final_amount);
  if (p.converted_amount != null) return Number(p.converted_amount);
  return Number(p.amount ?? 0);
}
/** NGN accounting value — the only figure revenue totals ever use. */
function rowNgn(p: Record<string, unknown>): number {
  return Number(p.amount ?? p.base_amount_ngn ?? 0);
}

/** Payment-level gateway / currency filters (never touches revenue maths). */
function matchesPaymentFilters(
  p: Record<string, unknown>,
  f: { gateway?: string | undefined; payment_currency?: string | undefined },
): boolean {
  if (f.gateway && rowGateway(p) !== f.gateway.toLowerCase()) return false;
  if (f.payment_currency && rowCurrency(p) !== f.payment_currency.toUpperCase()) return false;
  return true;
}

const PAYMENT_SELECT =
  "id, order_id, user_id, tool_slug, amount, currency, payment_currency, display_currency, display_amount, converted_amount, final_amount, base_amount_ngn, exchange_rate, international_fee_amount, coupon_code, discount_amount_ngn, payment_gateway, payment_type, classification, payment_status, payment_method, source, billing_period, access_type, paystack_reference, gateway_transaction_reference, customer_email, paid_at, created_at";


// ---------- Revenue Dashboard ----------

export const getRevenueAnalytics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => rangeInput.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const admin = await assertAdminAndGetAdmin(context);
    const { fromIso, toIso } = defaultRange(data.from, data.to);

    let query = admin
      .from("tool_payments")
      .select(PAYMENT_SELECT)
      .gte("created_at", fromIso)
      .lte("created_at", toIso);
    if (data.tool_slug) query = query.eq("tool_slug", data.tool_slug);
    if (data.payment_method) query = query.eq("payment_method", data.payment_method);

    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    const allRows = (rows ?? []) as unknown as Array<Record<string, unknown>>;

    // Option lists come from the unfiltered range so the dropdowns stay usable.
    const gatewayOptions = Array.from(new Set(allRows.map(rowGateway))).sort();
    const currencyOptions = Array.from(new Set(allRows.map(rowCurrency))).sort();
    const methodOptions = Array.from(
      new Set(allRows.map((p) => (p.payment_method as string) || "").filter(Boolean)),
    ).sort();

    const payments = allRows.filter((p) => matchesPaymentFilters(p, data));

    const now = new Date();
    const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

    const successful = payments.filter((p) => p.payment_status === "successful");
    const failed = payments.filter((p) => p.payment_status === "failed");
    const refunds = payments.filter(
      (p) => p.payment_status === "refunded" || p.payment_status === "reversed",
    );

    // Revenue is always the NGN accounting value — unchanged behaviour.
    const totalRevenue = successful.reduce((s, p) => s + rowNgn(p), 0);
    const revenueThisMonth = successful
      .filter((p) => new Date((p.paid_at as string) ?? (p.created_at as string)) >= startOfMonth)
      .reduce((s, p) => s + rowNgn(p), 0);

    const bucket = (
      items: Array<Record<string, unknown>>,
      key: (p: Record<string, unknown>) => string | null | undefined,
      fallback: string,
    ) => {
      const m = new Map<string, { revenue: number; count: number }>();
      for (const p of items) {
        const k = key(p) ?? fallback;
        const cur = m.get(k) ?? { revenue: 0, count: 0 };
        cur.revenue += rowNgn(p);
        cur.count += 1;
        m.set(k, cur);
      }
      return Array.from(m.entries())
        .map(([label, v]) => ({ label, ...v }))
        .sort((a, b) => b.revenue - a.revenue);
    };

    const byTool = bucket(successful, (p) => p.tool_slug as string | null, "unknown");
    const byPlan = bucket(successful, (p) => (p.billing_period as string | null) ?? null, "unknown");
    const byAccess = bucket(successful, (p) => (p.access_type as string | null) ?? null, "unknown");
    const byProvider = bucket(successful, (p) => rowGateway(p), "paystack");

    // Charged-currency breakdown: NGN accounting revenue plus the original
    // amount customers actually paid in that currency.
    const curMap = new Map<string, { revenue: number; count: number; original: number }>();
    for (const p of successful) {
      const c = rowCurrency(p);
      const cur = curMap.get(c) ?? { revenue: 0, count: 0, original: 0 };
      cur.revenue += rowNgn(p);
      cur.original += rowPaidAmount(p);
      cur.count += 1;
      curMap.set(c, cur);
    }
    const byCurrency = Array.from(curMap.entries())
      .map(([label, v]) => ({ label, ...v }))
      .sort((a, b) => b.revenue - a.revenue);

    return {
      range: { from: fromIso, to: toIso },
      totalRevenue,
      revenueThisMonth,
      successfulPayments: successful.length,
      failedPayments: failed.length,
      refunds: refunds.length,
      byTool,
      byPlan,
      byAccess,
      byProvider,
      byCurrency,
      methodOptions,
      gatewayOptions,
      currencyOptions,
    };
  });


// ---------- Customer Growth ----------

export const getCustomerAnalytics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => rangeInput.parse(input ?? {}))
  .handler(async ({ data, context }) => {
    const admin = await assertAdminAndGetAdmin(context);
    const { fromIso, toIso } = defaultRange(data.from, data.to);
    const now = new Date();
    const in7d = new Date(now.getTime() + 7 * 86400_000);

    const [profilesRes, ordersRes] = await Promise.all([
      admin.from("profiles").select("id, created_at"),
      admin
        .from("tool_orders")
        .select(
          "id, user_id, tool_slug, status, access_type, expires_at, renewal_status, subscription_status, created_at",
        ),
    ]);
    let profiles = profilesRes.data ?? [];
    let orders = ordersRes.data ?? [];

    // Gateway / currency filters scope customers to those who paid that way.
    if (data.gateway || data.payment_currency) {
      const { data: payRows } = await admin.from("tool_payments").select(PAYMENT_SELECT);
      const allowed = new Set(
        ((payRows ?? []) as unknown as Array<Record<string, unknown>>)
          .filter((p) => matchesPaymentFilters(p, data))
          .map((p) => String(p.user_id ?? "")),
      );
      profiles = profiles.filter((p) => allowed.has(p.id as string));
      orders = orders.filter((o) => allowed.has(o.user_id as string));
    }

    const totalCustomers = profiles.length;
    const newCustomers = profiles.filter((p) => {
      const at = new Date(p.created_at as string);
      return at >= new Date(fromIso) && at <= new Date(toIso);
    }).length;


    const activeUserSet = new Set<string>();
    const expiredUserSet = new Set<string>();
    const renewingUserSet = new Set<string>();
    const byToolMap = new Map<string, Set<string>>();
    const expiringSoonSet = new Set<string>();

    for (const o of orders) {
      const uid = o.user_id as string;
      const slug = o.tool_slug as string;
      const status = o.status as string;
      const expiresAt = o.expires_at ? new Date(o.expires_at as string) : null;
      const isLive = status === "approved" && (!expiresAt || expiresAt > now);
      if (isLive) {
        activeUserSet.add(uid);
        const s = byToolMap.get(slug) ?? new Set<string>();
        s.add(uid);
        byToolMap.set(slug, s);
        if (expiresAt && expiresAt <= in7d) expiringSoonSet.add(uid);
        if (o.subscription_status === "active" && o.renewal_status !== "disabled" && o.renewal_status !== "disable_pending") {
          renewingUserSet.add(uid);
        }
      } else if (status === "expired" || (status === "approved" && expiresAt && expiresAt <= now)) {
        expiredUserSet.add(uid);
      }
    }

    const byTool = Array.from(byToolMap.entries())
      .map(([tool, set]) => ({ tool, customers: set.size }))
      .sort((a, b) => b.customers - a.customers);

    return {
      range: { from: fromIso, to: toIso },
      totalCustomers,
      newCustomers,
      activeCustomers: activeUserSet.size,
      expiredCustomers: expiredUserSet.size,
      renewingCustomers: renewingUserSet.size,
      expiringSoon: expiringSoonSet.size,
      byTool,
    };
  });

// ---------- Tool Performance ----------

export const getToolPerformance = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const admin = await assertAdminAndGetAdmin(context);
    const now = new Date();
    const in7d = new Date(now.getTime() + 7 * 86400_000);

    const [ordersRes, paymentsRes, accountsRes, reviewsRes] = await Promise.all([
      admin
        .from("tool_orders")
        .select("id, user_id, tool_slug, status, expires_at"),
      admin
        .from("tool_payments")
        .select("tool_slug, amount, payment_status"),
      admin
        .from("tool_accounts")
        .select("tool_slug, enabled, status, expires_at"),
      admin
        .from("tool_reviews")
        .select("tool_slug, rating, status"),
    ]);
    const orders = ordersRes.data ?? [];
    const payments = paymentsRes.data ?? [];
    const accounts = accountsRes.data ?? [];
    const reviews = reviewsRes.data ?? [];

    const map = new Map<
      string,
      {
        tool: string;
        customers: Set<string>;
        revenue: number;
        activeAccounts: number;
        expiring: number;
        ratingSum: number;
        ratingCount: number;
      }
    >();
    const ensure = (slug: string) => {
      let m = map.get(slug);
      if (!m) {
        m = {
          tool: slug,
          customers: new Set(),
          revenue: 0,
          activeAccounts: 0,
          expiring: 0,
          ratingSum: 0,
          ratingCount: 0,
        };
        map.set(slug, m);
      }
      return m;
    };

    for (const o of orders) {
      const slug = o.tool_slug as string;
      const m = ensure(slug);
      const live =
        o.status === "approved" &&
        (!o.expires_at || new Date(o.expires_at as string) > now);
      if (live) {
        m.customers.add(o.user_id as string);
        if (o.expires_at && new Date(o.expires_at as string) <= in7d) m.expiring += 1;
      }
    }
    for (const p of payments) {
      if (p.payment_status !== "successful") continue;
      const m = ensure(p.tool_slug as string);
      m.revenue += Number(p.amount ?? 0);
    }
    for (const a of accounts) {
      if (
        a.enabled &&
        a.status === "working" &&
        (!a.expires_at || new Date(a.expires_at as string) > now)
      ) {
        const m = ensure(a.tool_slug as string);
        m.activeAccounts += 1;
      }
    }
    for (const r of reviews) {
      if (r.status !== "approved") continue;
      const m = ensure(r.tool_slug as string);
      m.ratingSum += Number(r.rating ?? 0);
      m.ratingCount += 1;
    }

    return Array.from(map.values())
      .map((m) => ({
        tool: m.tool,
        customers: m.customers.size,
        revenue: m.revenue,
        activeAccounts: m.activeAccounts,
        expiring: m.expiring,
        rating: m.ratingCount ? Math.round((m.ratingSum / m.ratingCount) * 10) / 10 : 0,
        reviews: m.ratingCount,
      }))
      .sort((a, b) => b.revenue - a.revenue || b.customers - a.customers);
  });

// ---------- CSV Export ----------

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
function toCsv(headers: string[], rows: Array<Record<string, unknown>>): string {
  const head = headers.join(",");
  const body = rows
    .map((r) => headers.map((h) => csvEscape(r[h])).join(","))
    .join("\n");
  return `${head}\n${body}`;
}

export const exportAnalyticsCsv = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        report: z.enum(["revenue", "customers", "orders"]),
        from: z.string().optional(),
        to: z.string().optional(),
        tool_slug: z.string().trim().max(120).optional(),
        payment_method: z.string().trim().max(60).optional(),
        gateway: z.string().trim().max(40).optional(),
        payment_currency: z.string().trim().max(10).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const admin = await assertAdminAndGetAdmin(context);
    const { fromIso, toIso } = defaultRange(data.from, data.to);

    /** Transparency row: original charged money + NGN accounting value. */
    const paymentRow = (p: Record<string, unknown>) => ({
      date: (p.paid_at as string) ?? (p.created_at as string) ?? "",
      customer: (p.customer_email as string) ?? "",
      tool: (p.tool_slug as string) ?? "",
      payment_gateway: rowGateway(p),
      payment_currency: rowCurrency(p),
      original_amount_paid: rowPaidAmount(p),
      exchange_rate: p.exchange_rate ?? "",
      ngn_accounting_amount: rowNgn(p),
      coupon_used: (p.coupon_code as string) ?? "",
      discount_ngn: p.discount_amount_ngn ?? "",
      payment_reference:
        (p.paystack_reference as string) ?? (p.gateway_transaction_reference as string) ?? "",
      status: (p.payment_status as string) ?? "",
      payment_method: (p.payment_method as string) ?? "",
      billing_period: (p.billing_period as string) ?? "",
      access_type: (p.access_type as string) ?? "",
    });
    const PAYMENT_HEADERS = [
      "date",
      "customer",
      "tool",
      "payment_gateway",
      "payment_currency",
      "original_amount_paid",
      "exchange_rate",
      "ngn_accounting_amount",
      "coupon_used",
      "discount_ngn",
      "payment_reference",
      "status",
      "payment_method",
      "billing_period",
      "access_type",
    ];

    async function loadPayments() {
      let q = admin
        .from("tool_payments")
        .select(PAYMENT_SELECT)
        .gte("created_at", fromIso)
        .lte("created_at", toIso)
        .order("created_at", { ascending: false });
      if (data.tool_slug) q = q.eq("tool_slug", data.tool_slug);
      if (data.payment_method) q = q.eq("payment_method", data.payment_method);
      const { data: rows } = await q;
      return ((rows ?? []) as unknown as Array<Record<string, unknown>>).filter((p) =>
        matchesPaymentFilters(p, data),
      );
    }

    if (data.report === "revenue") {
      const payments = await loadPayments();
      const csv = toCsv(PAYMENT_HEADERS, payments.map(paymentRow));
      return { filename: `revenue-${fromIso.slice(0, 10)}-to-${toIso.slice(0, 10)}.csv`, csv };
    }

    if (data.report === "customers") {
      const { data: rows } = await admin
        .from("profiles")
        .select("id, email, full_name, created_at")
        .gte("created_at", fromIso)
        .lte("created_at", toIso)
        .order("created_at", { ascending: false });
      let profiles = rows ?? [];
      if (data.gateway || data.payment_currency) {
        const { data: payRows } = await admin.from("tool_payments").select(PAYMENT_SELECT);
        const allowed = new Set(
          ((payRows ?? []) as unknown as Array<Record<string, unknown>>)
            .filter((p) => matchesPaymentFilters(p, data))
            .map((p) => String(p.user_id ?? "")),
        );
        profiles = profiles.filter((p) => allowed.has(p.id as string));
      }
      const csv = toCsv(["id", "email", "full_name", "created_at"], profiles);
      return { filename: `customers-${fromIso.slice(0, 10)}-to-${toIso.slice(0, 10)}.csv`, csv };
    }

    // orders — enriched with the gateway/currency actually used to pay.
    const [ordersRes, payments] = await Promise.all([
      admin
        .from("tool_orders")
        .select(
          "id, user_id, tool_slug, status, access_type, billing_period, payment_type, payment_status, price_amount, payment_currency, final_amount_charged, exchange_rate, coupon_code, discount_amount_ngn, paystack_reference, expires_at, fulfilment_status, renewal_status, subscription_status, created_at, approved_at",
        )
        .gte("created_at", fromIso)
        .lte("created_at", toIso)
        .order("created_at", { ascending: false }),
      loadPayments(),
    ]);
    const payByOrder = new Map<string, Record<string, unknown>>();
    for (const p of payments) {
      const oid = String(p.order_id ?? "");
      if (oid && !payByOrder.has(oid)) payByOrder.set(oid, p);
    }
    let orders = (ordersRes.data ?? []) as unknown as Array<Record<string, unknown>>;
    if (data.tool_slug) orders = orders.filter((o) => o.tool_slug === data.tool_slug);
    if (data.gateway || data.payment_currency) {
      orders = orders.filter((o) => payByOrder.has(String(o.id)));
    }

    const csv = toCsv(
      [
        "order_id",
        "date",
        "customer_id",
        "tool",
        "status",
        "access_type",
        "billing_period",
        "payment_type",
        "payment_status",
        "payment_gateway",
        "payment_currency",
        "original_amount_paid",
        "exchange_rate",
        "ngn_accounting_amount",
        "coupon_used",
        "discount_ngn",
        "payment_reference",
        "expires_at",
        "fulfilment_status",
        "renewal_status",
        "subscription_status",
        "approved_at",
      ],
      orders.map((o) => {
        const p = payByOrder.get(String(o.id));
        return {
          order_id: o.id,
          date: o.created_at,
          customer_id: o.user_id,
          tool: o.tool_slug,
          status: o.status,
          access_type: o.access_type,
          billing_period: o.billing_period,
          payment_type: o.payment_type,
          payment_status: o.payment_status,
          payment_gateway: p ? rowGateway(p) : "",
          payment_currency: p ? rowCurrency(p) : (o.payment_currency ?? "NGN"),
          original_amount_paid: p ? rowPaidAmount(p) : (o.final_amount_charged ?? ""),
          exchange_rate: (p?.exchange_rate ?? o.exchange_rate) ?? "",
          ngn_accounting_amount: p ? rowNgn(p) : (o.price_amount ?? ""),
          coupon_used: (p?.coupon_code ?? o.coupon_code) ?? "",
          discount_ngn: (p?.discount_amount_ngn ?? o.discount_amount_ngn) ?? "",
          payment_reference: (p?.paystack_reference ?? o.paystack_reference) ?? "",
          expires_at: o.expires_at,
          fulfilment_status: o.fulfilment_status,
          renewal_status: o.renewal_status,
          subscription_status: o.subscription_status,
          approved_at: o.approved_at,
        };
      }),
    );
    return { filename: `orders-${fromIso.slice(0, 10)}-to-${toIso.slice(0, 10)}.csv`, csv };

  });
