/**
 * Marketing analytics — aggregates from `marketing_events`, `tool_payments`,
 * and `tool_orders.attribution`. Admin only.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getMarketingAnalytics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        from: z.string().optional(),
        to: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: role } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .maybeSingle();
    if (!role) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const from = data.from ?? new Date(Date.now() - 30 * 86400_000).toISOString();
    const to = data.to ?? new Date().toISOString();

    // Successful payments in range (source of truth for revenue/conversions).
    const { data: payments } = await supabaseAdmin
      .from("tool_payments")
      .select(
        "id, order_id, amount, currency, classification, access_type, billing_period, payment_type, paid_at, source, tool_slug",
      )
      .eq("payment_status", "successful")
      .gte("paid_at", from)
      .lte("paid_at", to);

    // Orders with attribution for those payments.
    const orderIds = Array.from(
      new Set((payments ?? []).map((p) => p.order_id).filter(Boolean) as string[]),
    );
    const { data: orders } = orderIds.length
      ? await supabaseAdmin
          .from("tool_orders")
          .select("id, attribution, tool_slug, access_type, billing_period, payment_type")
          .in("id", orderIds)
      : {
          data: [] as {
            id: string;
            attribution: Record<string, unknown> | null;
            tool_slug: string;
          }[],
        };
    const orderMap = new Map(
      (orders ?? []).map((o) => [
        o.id as string,
        (o.attribution as { utm_source?: string; utm_campaign?: string } | null) ?? null,
      ]),
    );

    const bySource = new Map<string, { revenue: number; count: number }>();
    const byCampaign = new Map<string, { revenue: number; count: number }>();
    const byTool = new Map<string, { revenue: number; count: number }>();
    let sharedCount = 0;
    let privateCount = 0;
    let monthly = 0,
      quarterly = 0,
      yearly = 0;
    let recurring = 0,
      oneTime = 0;
    let totalRevenue = 0;

    for (const p of payments ?? []) {
      const amt = Number(p.amount) || 0;
      totalRevenue += amt;
      const attr = orderMap.get(p.order_id as string) ?? null;
      const src = attr?.utm_source ?? "direct";
      const camp = attr?.utm_campaign ?? "(none)";
      const s = bySource.get(src) ?? { revenue: 0, count: 0 };
      s.revenue += amt;
      s.count += 1;
      bySource.set(src, s);
      const c = byCampaign.get(camp) ?? { revenue: 0, count: 0 };
      c.revenue += amt;
      c.count += 1;
      byCampaign.set(camp, c);
      const slug = String(p.tool_slug ?? "unknown");
      const t = byTool.get(slug) ?? { revenue: 0, count: 0 };
      t.revenue += amt;
      t.count += 1;
      byTool.set(slug, t);
      if (p.access_type === "shared") sharedCount++;
      if (p.access_type === "private") privateCount++;
      if (p.billing_period === "monthly") monthly++;
      if (p.billing_period === "quarterly") quarterly++;
      if (p.billing_period === "yearly") yearly++;
      if (p.payment_type === "recurring_subscription") recurring++;
      if (p.payment_type === "one_time") oneTime++;
    }

    // Checkout starts (initiated payments) + abandoned in range.
    const { count: startedCount } = await supabaseAdmin
      .from("tool_payments")
      .select("id", { count: "exact", head: true })
      .gte("initiated_at", from)
      .lte("initiated_at", to);
    const { count: abandonedCount } = await supabaseAdmin
      .from("tool_orders")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending")
      .gte("created_at", from)
      .lte("created_at", to);
    const { count: regCount } = await supabaseAdmin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .gte("created_at", from)
      .lte("created_at", to);

    return {
      range: { from, to },
      totalRevenue,
      totalConversions: (payments ?? []).length,
      checkoutStarts: startedCount ?? 0,
      abandoned: abandonedCount ?? 0,
      registrations: regCount ?? 0,
      conversionRate:
        (startedCount ?? 0) > 0 ? ((payments ?? []).length / (startedCount ?? 1)) * 100 : 0,
      bySource: Array.from(bySource.entries())
        .map(([source, v]) => ({ source, ...v }))
        .sort((a, b) => b.revenue - a.revenue),
      byCampaign: Array.from(byCampaign.entries())
        .map(([campaign, v]) => ({ campaign, ...v }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 25),
      byTool: Array.from(byTool.entries())
        .map(([tool, v]) => ({ tool, ...v }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 15),
      accessMix: { shared: sharedCount, private: privateCount },
      billingMix: { monthly, quarterly, yearly },
      paymentTypeMix: { recurring, oneTime },
    };
  });
