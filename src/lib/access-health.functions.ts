/**
 * Access Health — server functions for the Admin monitoring surface.
 *
 * Composes the pure helpers in `access-health.ts` with the account pool
 * (see `account-pool.functions.ts`) and paid-but-unassigned orders to
 * produce alerts, awaiting-assignment lists, per-tool summaries and the
 * email-alert deduplication log.
 *
 * All handlers are admin-only (verified via `has_role`).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  buildAccountAlerts,
  classifyHealth,
  summariseByTool,
  planBulkReassignment,
  DEFAULT_ALERT_SETTINGS,
  type AccountAlert,
  type AlertInputAccount,
  type AlertInputOrder,
  type AlertSettings,
  type HealthStatus,
  type ToolAccountSummary,
} from "@/lib/access-health";
import { tryAutoAssignAccount } from "@/lib/account-pool.functions";

const tbl = (client: any, name: string) => (client as any).from(name);

async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase.rpc("has_role", {
    _user_id: ctx.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden");
}

async function loadAlertSettings(admin: any): Promise<AlertSettings> {
  const { data } = await tbl(admin, "site_settings")
    .select("alert_almost_full_pct, alert_expiry_days, alert_emails_enabled, alert_email_recipients")
    .eq("id", true)
    .maybeSingle();
  if (!data) return DEFAULT_ALERT_SETTINGS;
  return {
    almostFullPct: (data.alert_almost_full_pct as number | null) ?? 80,
    expiryDays: (data.alert_expiry_days as number | null) ?? 7,
    emailsEnabled: Boolean(data.alert_emails_enabled),
    emailRecipients: (data.alert_email_recipients as string[] | null) ?? [],
  };
}

async function loadAwaitingOrders(admin: any): Promise<AlertInputOrder[]> {
  // Paid orders where the user has no active pool assignment.
  const { data: orders } = await tbl(admin, "tool_orders")
    .select("id, tool_slug, user_id, access_type, created_at, status, payment_status, fulfilment_status, expires_at")
    .in("status", ["approved"])
    .order("created_at", { ascending: false })
    .limit(500);
  const list = ((orders ?? []) as any[]).filter((o) =>
    (o.payment_status ?? "paid") === "paid" &&
    (o.access_type ?? "shared") === "shared" && // private is handled via fulfilment
    (!o.expires_at || new Date(o.expires_at).getTime() > Date.now()),
  );
  if (list.length === 0) return [];
  const ids = list.map((o) => o.id as string);
  const { data: assigns } = await tbl(admin, "tool_account_assignments")
    .select("order_id")
    .in("order_id", ids)
    .eq("status", "active");
  const assigned = new Set(((assigns ?? []) as any[]).map((a) => a.order_id as string));
  return list
    .filter((o) => !assigned.has(o.id as string))
    .map((o) => ({
      id: o.id as string,
      tool_slug: o.tool_slug as string,
      user_id: o.user_id as string,
      access_type: ((o.access_type as "shared" | "private" | null) ?? "shared"),
      created_at: o.created_at as string,
    }));
}

async function countsByAccount(admin: any, ids: string[]) {
  const out: Record<string, number> = {};
  if (!ids.length) return out;
  const { data } = await tbl(admin, "tool_account_assignments")
    .select("account_id")
    .in("account_id", ids)
    .eq("status", "active");
  for (const r of ((data ?? []) as any[])) {
    const id = r.account_id as string;
    out[id] = (out[id] ?? 0) + 1;
  }
  return out;
}

async function loadAllAccounts(admin: any): Promise<AlertInputAccount[]> {
  const { data } = await tbl(admin, "tool_accounts")
    .select("id, tool_slug, label, access_type, status, enabled, expires_at, max_capacity, needs_capacity_review, last_health_check_at")
    .order("tool_slug", { ascending: true });
  const rows = ((data ?? []) as any[]);
  const counts = await countsByAccount(admin, rows.map((r) => r.id as string));
  return rows.map((a) => {
    const active = counts[a.id as string] ?? 0;
    const cap = (a.max_capacity as number) ?? 0;
    return {
      id: a.id as string,
      tool_slug: a.tool_slug as string,
      label: (a.label as string | null) ?? "Account",
      access_type: a.access_type as any,
      status: a.status as any,
      enabled: Boolean(a.enabled),
      expires_at: (a.expires_at as string | null) ?? null,
      max_capacity: cap,
      needs_capacity_review: Boolean(a.needs_capacity_review),
      last_health_check_at: (a.last_health_check_at as string | null) ?? null,
      active_count: active,
      fill_pct: cap > 0 ? Math.round((active / cap) * 100) : 0,
    } as AlertInputAccount & { last_health_check_at: string | null; access_type: any };
  });
}

// -------- overview + alerts --------
export const getAccessHealthOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [settings, accounts, awaiting] = await Promise.all([
      loadAlertSettings(supabaseAdmin),
      loadAllAccounts(supabaseAdmin),
      loadAwaitingOrders(supabaseAdmin),
    ]);
    const now = Date.now();
    const alerts = buildAccountAlerts(accounts, awaiting, settings, now);
    const perTool = summariseByTool(accounts, awaiting, settings, now);
    const enriched = accounts.map((a) => ({
      ...a,
      active_count: a.active_count,
      available: Math.max(0, a.max_capacity - a.active_count),
      health: classifyHealth(a, settings, now) as HealthStatus,
    }));
    return {
      settings,
      accounts: enriched,
      awaiting,
      alerts,
      perTool,
      alertCounts: {
        total: alerts.length,
        critical: alerts.filter((x) => x.level === "critical").length,
        warning: alerts.filter((x) => x.level === "warning").length,
        info: alerts.filter((x) => x.level === "info").length,
      },
    };
  });

export const getToolAccountSummary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ tool_slug: z.string().min(1).max(120) }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [settings, accounts, awaiting] = await Promise.all([
      loadAlertSettings(supabaseAdmin),
      loadAllAccounts(supabaseAdmin),
      loadAwaitingOrders(supabaseAdmin),
    ]);
    const toolAccounts = accounts.filter((a) => a.tool_slug === data.tool_slug);
    const toolAwaiting = awaiting.filter((o) => o.tool_slug === data.tool_slug);
    const summary = summariseByTool(toolAccounts, toolAwaiting, settings)[0] ?? null;
    return { summary: summary as ToolAccountSummary | null };
  });

// -------- awaiting-assignment list --------
export const listAwaitingAssignments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const awaiting = await loadAwaitingOrders(supabaseAdmin);
    if (awaiting.length === 0) return { rows: [] as any[] };
    const orderIds = awaiting.map((a) => a.id);
    const userIds = Array.from(new Set(awaiting.map((a) => a.user_id)));
    const [{ data: orderRows }, { data: profiles }, accounts] = await Promise.all([
      tbl(supabaseAdmin, "tool_orders")
        .select("id, billing_period, paid_at, expires_at, access_type, tool_slug")
        .in("id", orderIds),
      tbl(supabaseAdmin, "profiles").select("id, email, full_name").in("id", userIds),
      loadAllAccounts(supabaseAdmin),
    ]);
    const pmap = new Map<string, any>();
    for (const p of ((profiles ?? []) as any[])) pmap.set(p.id as string, p);
    const omap = new Map<string, any>();
    for (const o of ((orderRows ?? []) as any[])) omap.set(o.id as string, o);
    const settings = await loadAlertSettings(supabaseAdmin);
    return {
      rows: awaiting.map((a) => {
        const o = omap.get(a.id) ?? {};
        const compat = accounts
          .filter((acc) =>
            acc.tool_slug === a.tool_slug &&
            (acc as any).access_type === a.access_type &&
            acc.enabled &&
            (acc.max_capacity - acc.active_count) > 0 &&
            classifyHealth(acc, settings) !== "expired" &&
            classifyHealth(acc, settings) !== "suspended",
          )
          .map((acc) => ({
            id: acc.id, label: (acc as any).label, available: acc.max_capacity - acc.active_count,
          }));
        return {
          order_id: a.id,
          user_id: a.user_id,
          tool_slug: a.tool_slug,
          access_type: a.access_type,
          billing_period: (o.billing_period as string | null) ?? null,
          paid_at: (o.paid_at as string | null) ?? null,
          expires_at: (o.expires_at as string | null) ?? null,
          reason: compat.length === 0 ? "No compatible account with capacity" : "Not yet assigned",
          available_accounts: compat,
          profile: pmap.get(a.user_id) ?? { email: null, full_name: null },
        };
      }),
    };
  });

export const assignAwaitingCustomer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ order_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const id = await tryAutoAssignAccount(supabaseAdmin, data.order_id);
    if (!id) throw new Error("No compatible account with available capacity.");
    return { ok: true, assignment_id: id };
  });

// -------- alert settings --------
export const getAlertSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return { settings: await loadAlertSettings(supabaseAdmin) };
  });

export const setAlertSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        almostFullPct: z.number().int().min(10).max(100),
        expiryDays: z.number().int().min(1).max(60),
        emailsEnabled: z.boolean(),
        emailRecipients: z.array(z.string().email().max(200)).max(10),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await tbl(supabaseAdmin, "site_settings")
      .update({
        alert_almost_full_pct: data.almostFullPct,
        alert_expiry_days: data.expiryDays,
        alert_emails_enabled: data.emailsEnabled,
        alert_email_recipients: data.emailRecipients,
        updated_by: context.userId,
      })
      .eq("id", true);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// -------- bulk reassignment --------
export const bulkReassignFromAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ account_id: z.string().uuid(), reason: z.string().max(300).optional() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const settings = await loadAlertSettings(supabaseAdmin);

    const { data: source } = await tbl(supabaseAdmin, "tool_accounts")
      .select("*")
      .eq("id", data.account_id)
      .maybeSingle();
    if (!source) throw new Error("Source account not found");
    const src = source as any;

    const accounts = await loadAllAccounts(supabaseAdmin);
    const candidates = accounts
      .filter((a) => a.id !== data.account_id && a.tool_slug === src.tool_slug && (a as any).access_type === src.access_type)
      .map((a) => ({
        id: a.id,
        available: Math.max(0, a.max_capacity - a.active_count),
        enabled: a.enabled,
        health: classifyHealth(a, settings),
        expires_at: a.expires_at,
      }));

    const { data: activeAssigns } = await tbl(supabaseAdmin, "tool_account_assignments")
      .select("id, order_id, user_id")
      .eq("account_id", data.account_id)
      .eq("status", "active");
    const orderIds = ((activeAssigns ?? []) as any[]).map((r) => r.order_id as string);

    const plan = planBulkReassignment(orderIds, candidates);

    let moved = 0;
    let stillAwaiting = 0;
    for (const step of plan.assignments) {
      if (!step.target_account_id) { stillAwaiting++; continue; }
      // Release the old row, create the new row (reuse pattern from adminReassignCustomer).
      const current = ((activeAssigns ?? []) as any[]).find((r) => r.order_id === step.order_id);
      if (!current) continue;
      await tbl(supabaseAdmin, "tool_account_assignments")
        .update({
          status: "reassigned",
          released_at: new Date().toISOString(),
          released_reason: data.reason ?? "bulk_reassign",
        })
        .eq("id", current.id);
      const { data: order } = await tbl(supabaseAdmin, "tool_orders")
        .select("id, user_id, tool_slug, access_type")
        .eq("id", step.order_id)
        .maybeSingle();
      const o = order as any;
      const { error: insErr } = await tbl(supabaseAdmin, "tool_account_assignments").insert({
        account_id: step.target_account_id,
        user_id: o.user_id,
        order_id: o.id,
        tool_slug: o.tool_slug,
        access_type: o.access_type ?? "shared",
        status: "active",
        assigned_by: context.userId,
      });
      if (insErr) throw new Error(insErr.message);
      await tbl(supabaseAdmin, "tool_account_audit").insert({
        account_id: step.target_account_id,
        from_account_id: data.account_id,
        to_account_id: step.target_account_id,
        user_id: o.user_id,
        order_id: o.id,
        action: "reassigned",
        actor: context.userId,
        notes: data.reason ?? "bulk_reassign",
      });
      moved++;
    }

    return { ok: true, moved, still_awaiting: stillAwaiting };
  });

// -------- Admin email alerts (deduped via admin_alert_log) --------
export const dispatchAdminAlertEmails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const settings = await loadAlertSettings(supabaseAdmin);
    if (!settings.emailsEnabled || settings.emailRecipients.length === 0) {
      return { sent: 0, skipped: "emails_disabled" as const };
    }
    const [accounts, awaiting] = await Promise.all([
      loadAllAccounts(supabaseAdmin),
      loadAwaitingOrders(supabaseAdmin),
    ]);
    const alerts = buildAccountAlerts(accounts, awaiting, settings);

    // Resolve alerts that were previously open but are no longer present.
    const openKeys = new Set(alerts.map((a) => a.key));
    const { data: openLog } = await tbl(supabaseAdmin, "admin_alert_log")
      .select("id, alert_key")
      .is("resolved_at", null);
    for (const row of ((openLog ?? []) as any[])) {
      if (!openKeys.has(row.alert_key as string)) {
        await tbl(supabaseAdmin, "admin_alert_log")
          .update({ resolved_at: new Date().toISOString() })
          .eq("id", row.id);
      }
    }

    // Build account-label lookup so email payloads include a human-readable
    // label without exposing any credentials.
    const labelById = new Map<string, string>();
    for (const a of accounts) labelById.set(a.id, a.label);

    const siteUrl =
      process.env.APP_URL ??
      process.env.SITE_URL ??
      "https://topratedseotools.com";
    const adminLink = `${siteUrl.replace(/\/$/, "")}/admin/access-health`;

    let sent = 0;
    const { queueEmail } = await import("@/lib/email/queue");
    for (const alert of alerts) {
      if (alert.level === "info") continue; // don't email info
      // dedupe: skip if already logged as unresolved
      const { data: existing } = await tbl(supabaseAdmin, "admin_alert_log")
        .select("id")
        .eq("alert_key", alert.key)
        .is("resolved_at", null)
        .maybeSingle();
      if (existing) continue;
      const subject = `Access Alert: ${alert.title}`;
      const accountLabel = alert.account_id
        ? (labelById.get(alert.account_id) ?? "—")
        : "—";
      const accountLine = alert.account_id ? ` (${accountLabel})` : "";
      const payload = {
        subject,
        title: alert.title,
        body: alert.message,
        level: alert.level,
        tool_slug: alert.tool_slug,
        account_label: accountLabel,
        account_line: accountLine,
        affected_customers: alert.affected_customers,
        admin_link: adminLink,
        raised_at: new Date().toISOString(),
      };
      for (const recipient of settings.emailRecipients) {
        await queueEmail(supabaseAdmin, {
          eventKey: `admin_alert:${alert.key}:${recipient}`,
          templateKey: "admin_alert",
          recipient,
          payload,
        }).catch(() => undefined);
      }
      await tbl(supabaseAdmin, "admin_alert_log").insert({
        alert_key: alert.key,
        alert_type: alert.kind,
        subject,
        recipient: settings.emailRecipients[0],
      });
      sent++;
    }
    return { sent };
  });

// -------- Sidebar badge counts (unresolved issues + awaiting) --------
export const getAccessHealthBadgeCounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [settings, accounts, awaiting] = await Promise.all([
      loadAlertSettings(supabaseAdmin),
      loadAllAccounts(supabaseAdmin),
      loadAwaitingOrders(supabaseAdmin),
    ]);
    const alerts = buildAccountAlerts(accounts, awaiting, settings);
    // Unresolved issues needing attention. Excludes info + almost_full
    // capacity heads-up. Login/suspended count only when they affect
    // customers.
    const attentionKinds = new Set<string>([
      "full",
      "expired",
      "login_problem",
      "suspended",
      "disabled_with_customers",
      "customers_on_unhealthy_account",
      "awaiting_assignment",
      "needs_capacity_review",
    ]);
    const unresolved = alerts.filter(
      (a) =>
        a.level !== "info" &&
        attentionKinds.has(a.kind) &&
        (["login_problem", "suspended"].includes(a.kind)
          ? a.affected_customers > 0
          : true),
    ).length;
    return { unresolved, awaiting: awaiting.length };
  });

