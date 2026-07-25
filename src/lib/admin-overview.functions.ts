/**
 * Settings Overview — real-data-only aggregation.
 * Runs on server; uses supabaseAdmin. No decorative counters.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function loadAdminContext(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: role } = await (supabaseAdmin as any)
    .from("user_roles")
    .select("is_active, is_super_admin")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  const isActive = !!role && role.is_active !== false;
  const { data: acct } = await (supabaseAdmin as any)
    .from("admin_accounts")
    .select("role_key")
    .eq("user_id", userId)
    .maybeSingle();
  const isActiveAdmin = isActive && !!acct;
  const isSuperAdmin = isActiveAdmin && !!role?.is_super_admin;
  return { isActiveAdmin, isSuperAdmin };
}

async function canReadAudit(userId: string, isSuperAdmin: boolean) {
  if (isSuperAdmin) return true;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await (supabaseAdmin as any).rpc("admin_effective_permission", {
    _uid: userId,
    _perm: "audit.view",
  });
  return !!data;
}

export const getSettingsOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = await loadAdminContext(context.userId);
    if (!ctx.isActiveAdmin) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Real-data attention items
    const attention: Array<{
      id: string;
      label: string;
      count: number;
      href: string;
    }> = [];

    // Pending Private fulfilment
    try {
      const { count } = await (supabaseAdmin as any)
        .from("tool_orders")
        .select("id", { count: "exact", head: true })
        .eq("access_type", "private")
        .eq("status", "approved")
        .in("fulfilment_status", ["pending", "awaiting"]);
      if ((count ?? 0) > 0) {
        attention.push({
          id: "private-pending",
          label: "Private access awaiting fulfilment",
          count: count ?? 0,
          href: "/admin/orders",
        });
      }
    } catch {}

    // Awaiting assignment — approved orders with no active pool assignment
    try {
      const { data: orders } = await (supabaseAdmin as any)
        .from("tool_orders")
        .select("id")
        .eq("status", "approved");
      const orderIds = (orders ?? []).map((o: any) => o.id);
      if (orderIds.length) {
        const { data: assigned } = await (supabaseAdmin as any)
          .from("tool_account_assignments")
          .select("order_id")
          .in("order_id", orderIds)
          .eq("status", "active");
        const assignedIds = new Set((assigned ?? []).map((a: any) => a.order_id));
        const awaiting = orderIds.filter((id: string) => !assignedIds.has(id)).length;
        if (awaiting > 0) {
          attention.push({
            id: "awaiting-assignment",
            label: "Customers awaiting account assignment",
            count: awaiting,
            href: "/admin/awaiting-assignments",
          });
        }
      }
    } catch {}

    // Failed emails
    try {
      const { count } = await (supabaseAdmin as any)
        .from("email_messages")
        .select("id", { count: "exact", head: true })
        .eq("status", "failed");
      if ((count ?? 0) > 0) {
        attention.push({
          id: "failed-emails",
          label: "Failed email deliveries",
          count: count ?? 0,
          href: "/admin/settings/email",
        });
      }
    } catch {}

    // Expired invitations
    try {
      const { count } = await (supabaseAdmin as any)
        .from("admin_invitations")
        .select("id", { count: "exact", head: true })
        .eq("status", "expired");
      if ((count ?? 0) > 0) {
        attention.push({
          id: "expired-invitations",
          label: "Expired admin invitations",
          count: count ?? 0,
          href: "/admin/settings/staff",
        });
      }
    } catch {}

    // Disabled admins
    try {
      const { count } = await (supabaseAdmin as any)
        .from("user_roles")
        .select("id", { count: "exact", head: true })
        .eq("role", "admin")
        .eq("is_active", false);
      if ((count ?? 0) > 0) {
        attention.push({
          id: "disabled-admins",
          label: "Disabled admin accounts",
          count: count ?? 0,
          href: "/admin/settings/staff",
        });
      }
    } catch {}

    // Paid but no access assigned yet
    try {
      const { count } = await (supabaseAdmin as any)
        .from("tool_orders")
        .select("id", { count: "exact", head: true })
        .eq("payment_status", "paid")
        .eq("status", "pending_manual");
      if ((count ?? 0) > 0) {
        attention.push({
          id: "paid-no-access",
          label: "Paid orders without access",
          count: count ?? 0,
          href: "/admin/settings/payment-recovery",
        });
      }
    } catch {}

    // Recent webhook failures (last 24h)
    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { count } = await (supabaseAdmin as any)
        .from("paystack_webhook_events")
        .select("id", { count: "exact", head: true })
        .eq("status", "failed")
        .gte("created_at", since);
      if ((count ?? 0) > 0) {
        attention.push({
          id: "webhook-failed",
          label: "Recent webhook failures",
          count: count ?? 0,
          href: "/admin/settings/payment-recovery",
        });
      }
    } catch {}

    // Subscriptions expiring within 7 days
    try {
      const now = new Date();
      const upper = new Date(now.getTime() + 7 * 86400_000).toISOString();
      const { count } = await (supabaseAdmin as any)
        .from("tool_orders")
        .select("id", { count: "exact", head: true })
        .eq("status", "approved")
        .gte("expires_at", now.toISOString())
        .lte("expires_at", upper);
      if ((count ?? 0) > 0) {
        attention.push({
          id: "expiring-soon",
          label: "Subscriptions expiring in 7 days",
          count: count ?? 0,
          href: "/admin/settings/communications",
        });
      }
    } catch {}

    // Renewal-failed subscriptions
    try {
      const { count } = await (supabaseAdmin as any)
        .from("tool_orders")
        .select("id", { count: "exact", head: true })
        .eq("renewal_status", "failed");
      if ((count ?? 0) > 0) {
        attention.push({
          id: "renewal-failed",
          label: "Subscription renewals failed",
          count: count ?? 0,
          href: "/admin/settings/communications",
        });
      }
    } catch {}


    // Recent activity
    let recentActivity: Array<{
      id: string;
      action: string;
      actorEmail: string | null;
      createdAt: string;
      success: boolean;
    }> = [];
    if (await canReadAudit(context.userId, ctx.isSuperAdmin)) {
      const { data } = await (supabaseAdmin as any)
        .from("admin_activity_log")
        .select("id, action, actor_email, created_at, success")
        .order("created_at", { ascending: false })
        .limit(10);
      recentActivity = (data ?? []).map((r: any) => ({
        id: r.id,
        action: r.action,
        actorEmail: r.actor_email,
        createdAt: r.created_at,
        success: r.success,
      }));
    }

    const phaseProgress = [
      { phase: 1, name: "Admin Control Foundation", status: "Active" as const },
      { phase: 2, name: "General website & content", status: "Not started" as const },
      { phase: 3, name: "Credentials & capacity", status: "Not started" as const },
      { phase: 4, name: "Promotions & business rules", status: "Not started" as const },
      { phase: 5, name: "Payments & API keys", status: "Not started" as const },
      { phase: 6, name: "Support & communications", status: "Not started" as const },
      { phase: 7, name: "Security & automations", status: "Not started" as const },
      { phase: 8, name: "Migration & launch", status: "Not started" as const },
    ];

    return { attention, recentActivity, phaseProgress };
  });
