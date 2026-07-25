/**
 * Phase 7 — Backup, Migration & System Recovery.
 *
 * Server functions consumed by:
 *   - /admin/settings/backup           (Backup & Recovery)
 *   - /admin/settings/migration        (Migration Readiness)
 *   - /admin/settings/emergency        (Emergency Controls)
 *   - /admin/settings/system-health    (System Health)
 *
 * All functions gate on `has_role(admin)` plus a specific permission.
 * Sensitive secrets (API keys, tokens, passwords, credentials) are NEVER
 * returned. Configuration exports include only business data.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { logAdminActivity } from "@/lib/admin-audit.server";
import { isResendConfigured } from "@/lib/email/resend";

async function assertPerm(
  ctx: { supabase: any; userId: string },
  perm: string,
): Promise<any> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: role } = await (supabaseAdmin as any)
    .from("user_roles")
    .select("is_active, is_super_admin")
    .eq("user_id", ctx.userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!role || role.is_active === false) throw new Error("Forbidden");
  if (role.is_super_admin) return supabaseAdmin;
  const { data: allowed } = await (supabaseAdmin as any).rpc(
    "admin_effective_permission",
    { _uid: ctx.userId, _perm: perm },
  );
  if (!allowed) throw new Error("Forbidden");
  return supabaseAdmin;
}

// ────────────────────────────────────────────────────────────────────────────
// BACKUP — business data only. Secrets, credentials and passwords are stripped.
// ────────────────────────────────────────────────────────────────────────────

const BACKUP_TABLES = [
  "tools:tool_pricing",
  "tool_settings",
  "tool_overrides",
  "promotions",
  "profiles",
  "user_roles",
  "user_subscriptions",
  "tool_orders",
  "tool_payments",
  "email_templates",
  "site_settings",
  "admin_accounts",
  "admin_permissions",
  "blog_posts",
  "blog_categories",
  "blog_tags",
] as const;

/** Columns to strip before export — never leak passwords/keys/credentials. */
const REDACT_COLUMNS = new Set([
  "password",
  "password_hash",
  "must_change_password",
  "temp_password",
  "api_key",
  "api_secret",
  "secret",
  "encrypted_password",
  "resend_api_key",
  "credentials",
  "credential",
  "login_email",
  "login_password",
  "cookie",
  "cookies",
  "session",
  "token",
  "refresh_token",
  "access_token",
]);

function redact(rows: any[]): any[] {
  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      out[k] = REDACT_COLUMNS.has(k.toLowerCase()) ? "[REDACTED]" : v;
    }
    return out;
  });
}

export const createBackup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const admin = await assertPerm(context, "backups.access");
    const started = new Date().toISOString();
    const tables: Record<string, { rows: number; data: any[] }> = {};
    let totalRows = 0;

    for (const name of BACKUP_TABLES) {
      const table = name.startsWith("tools:") ? name.slice(6) : name;
      try {
        const { data, error } = await admin.from(table).select("*").limit(10000);
        if (error) {
          tables[table] = { rows: 0, data: [] };
        } else {
          const clean = redact((data ?? []) as any[]);
          tables[table] = { rows: clean.length, data: clean };
          totalRows += clean.length;
        }
      } catch {
        tables[table] = { rows: 0, data: [] };
      }
    }

    const payload = {
      version: 1,
      kind: "topratedseotools.backup",
      generated_at: started,
      generated_by: context.userId,
      note: "Business data export. Secrets, passwords, credentials, tokens are redacted.",
      total_rows: totalRows,
      tables,
    };

    await logAdminActivity(context, {
      action: "backup.created",
      area: "backup",
      success: true,
      reference: `${totalRows} rows across ${Object.keys(tables).length} tables`,
    });

    return {
      ok: true as const,
      filename: `topratedseotools-backup-${started.replace(/[:.]/g, "-")}.json`,
      total_rows: totalRows,
      tables: Object.entries(tables).map(([name, t]) => ({ name, rows: t.rows })),
      json: JSON.stringify(payload, null, 2),
    };
  });

/** History = admin_activity_log filtered on area='backup' or 'config-export'. */
export const listBackupHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const admin = await assertPerm(context, "backups.access");
    const { data } = await admin
      .from("admin_activity_log")
      .select("id, created_at, action, area, success, reason, reference, actor_email")
      .in("area", ["backup", "config-export"])
      .order("created_at", { ascending: false })
      .limit(100);
    return {
      rows: ((data ?? []) as any[]).map((r) => ({
        id: r.id,
        createdAt: r.created_at,
        action: r.action,
        area: r.area,
        success: r.success,
        reference: r.reference,
        actorEmail: r.actor_email,
      })),
    };
  });

// ────────────────────────────────────────────────────────────────────────────
// CONFIG EXPORT — smaller, portable, business-config only.
// ────────────────────────────────────────────────────────────────────────────

export const exportConfiguration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const admin = await assertPerm(context, "backups.access");
    const [tools, pricing, promotions, templates, settings, roles, permissions] = await Promise.all([
      admin.from("tool_settings").select("*").limit(1000),
      admin.from("tool_pricing").select("*").limit(2000),
      admin.from("promotions").select("*").limit(500),
      admin.from("email_templates").select("key, name, subject, html_body, text_body, enabled").limit(200),
      admin.from("site_settings").select("*").eq("id", true).maybeSingle(),
      admin.from("admin_accounts").select("user_id, account_email, role_key, is_active").limit(200),
      admin.from("admin_permissions").select("*").limit(1000),
    ]);

    const payload = {
      version: 1,
      kind: "topratedseotools.config",
      generated_at: new Date().toISOString(),
      note: "Configuration export. Secrets, credentials, passwords are not included.",
      tool_catalogue: redact((tools.data ?? []) as any[]),
      tool_pricing: redact((pricing.data ?? []) as any[]),
      promotions: redact((promotions.data ?? []) as any[]),
      email_templates: (templates.data ?? []) as any[],
      site_settings: settings.data ?? null,
      admin_roles: (roles.data ?? []) as any[],
      admin_permissions: (permissions.data ?? []) as any[],
    };

    await logAdminActivity(context, {
      action: "config.exported",
      area: "config-export",
      success: true,
      reference: `${(tools.data?.length ?? 0)} tools · ${(pricing.data?.length ?? 0)} pricing rows`,
    });

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    return {
      ok: true as const,
      filename: `topratedseotools-config-${stamp}.json`,
      json: JSON.stringify(payload, null, 2),
    };
  });

// ────────────────────────────────────────────────────────────────────────────
// SYSTEM HEALTH + MIGRATION CHECKLIST (share the same underlying probes).
// ────────────────────────────────────────────────────────────────────────────

type HealthStatus = "ok" | "warn" | "fail";

interface HealthCheck {
  key: string;
  label: string;
  status: HealthStatus;
  detail: string;
  fix?: string;
}

async function runProbes(admin: any): Promise<HealthCheck[]> {
  const checks: HealthCheck[] = [];

  // 1. Database
  try {
    const { error } = await admin.from("site_settings").select("id").eq("id", true).limit(1);
    checks.push({
      key: "database",
      label: "Database",
      status: error ? "fail" : "ok",
      detail: error ? error.message : "Connected and readable.",
      fix: error ? "Contact hosting support — the database is not responding." : undefined,
    });
  } catch (e: any) {
    checks.push({ key: "database", label: "Database", status: "fail", detail: String(e?.message ?? e) });
  }

  // 2. Payment provider
  const paystackConfigured = Boolean(process.env.PAYSTACK_SECRET_KEY);
  checks.push({
    key: "payments",
    label: "Payment provider (Paystack)",
    status: paystackConfigured ? "ok" : "fail",
    detail: paystackConfigured ? "Paystack secret key configured." : "PAYSTACK_SECRET_KEY is missing.",
    fix: paystackConfigured ? undefined : "Add PAYSTACK_SECRET_KEY in Cloud → Secrets.",
  });

  // 3. Email provider
  const resendReady = isResendConfigured();
  const { data: es } = await admin.from("email_settings").select("from_email, sending_domain, resend_domain_status, production_sending").eq("id", true).maybeSingle();
  let emailStatus: HealthStatus = "ok";
  let emailDetail = "Resend configured.";
  let emailFix: string | undefined;
  if (!resendReady) {
    emailStatus = "fail";
    emailDetail = "RESEND_API_KEY is missing.";
    emailFix = "Add RESEND_API_KEY in Cloud → Secrets.";
  } else if (!es?.from_email) {
    emailStatus = "warn";
    emailDetail = "No sender email configured.";
    emailFix = "Set From address in Admin → Settings → Email.";
  } else if (es.resend_domain_status && es.resend_domain_status !== "verified") {
    emailStatus = "warn";
    emailDetail = `Domain status: ${es.resend_domain_status}.`;
    emailFix = "Verify the sending domain in Admin → Settings → Email.";
  } else if (!es.production_sending) {
    emailStatus = "warn";
    emailDetail = "Production sending is disabled.";
    emailFix = "Turn on production sending in Admin → Settings → Email.";
  }
  checks.push({ key: "email", label: "Email provider (Resend)", status: emailStatus, detail: emailDetail, fix: emailFix });

  // 4. Storage (blog images bucket)
  try {
    const { error } = await admin.storage.getBucket("blog-images");
    checks.push({
      key: "storage",
      label: "Storage buckets",
      status: error ? "warn" : "ok",
      detail: error ? "blog-images bucket not reachable." : "Storage reachable.",
      fix: error ? "Re-create the blog-images bucket in Cloud → Storage." : undefined,
    });
  } catch (e: any) {
    checks.push({ key: "storage", label: "Storage buckets", status: "warn", detail: String(e?.message ?? e) });
  }

  // 5. Background jobs / cron
  const { data: cronRuns } = await admin
    .from("email_messages")
    .select("id")
    .in("status", ["pending", "retrying"])
    .lte("scheduled_for", new Date(Date.now() - 15 * 60_000).toISOString())
    .limit(1);
  const cronBehind = (cronRuns ?? []).length > 0;
  checks.push({
    key: "cron",
    label: "Background jobs (email dispatcher)",
    status: cronBehind ? "warn" : "ok",
    detail: cronBehind
      ? "Emails due for >15 minutes are still pending — dispatcher may be paused or delayed."
      : "Dispatcher up to date.",
    fix: cronBehind ? "Check Admin → Settings → Emergency: is email sending paused?" : undefined,
  });

  // 6. Recent admin failures
  const { data: recentFail } = await admin
    .from("admin_activity_log")
    .select("id")
    .eq("success", false)
    .gte("created_at", new Date(Date.now() - 24 * 3600_000).toISOString())
    .limit(50);
  const failed24h = (recentFail ?? []).length;
  checks.push({
    key: "recent_errors",
    label: "Recent admin failures (24h)",
    status: failed24h === 0 ? "ok" : failed24h < 5 ? "warn" : "fail",
    detail: `${failed24h} failed admin action(s) in the last 24 hours.`,
    fix: failed24h > 0 ? "Review Admin → Settings → Admin Activity." : undefined,
  });

  // 7. Failed payments last 7d
  const { data: fp } = await admin
    .from("tool_payments")
    .select("id")
    .eq("status", "failed")
    .gte("created_at", new Date(Date.now() - 7 * 24 * 3600_000).toISOString())
    .limit(50);
  const failedPayments = (fp ?? []).length;
  checks.push({
    key: "failed_payments",
    label: "Failed payments (7 days)",
    status: failedPayments === 0 ? "ok" : failedPayments < 5 ? "warn" : "fail",
    detail: `${failedPayments} failed payment(s) in the last 7 days.`,
    fix: failedPayments > 0 ? "Review Admin → Settings → Payment Recovery." : undefined,
  });

  return checks;
}

export const getSystemHealth = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const admin = await assertPerm(context, "system_health.access");
    const checks = await runProbes(admin);
    return {
      checks,
      summary: {
        ok: checks.filter((c) => c.status === "ok").length,
        warn: checks.filter((c) => c.status === "warn").length,
        fail: checks.filter((c) => c.status === "fail").length,
      },
      generatedAt: new Date().toISOString(),
    };
  });

export const getMigrationChecklist = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const admin = await assertPerm(context, "migration.access");
    const checks = await runProbes(admin);
    // Add migration-specific items.
    const { data: settings } = await admin.from("site_settings").select("admin_whatsapp_number").eq("id", true).maybeSingle();
    checks.push({
      key: "whatsapp",
      label: "Admin WhatsApp number",
      status: settings?.admin_whatsapp_number ? "ok" : "warn",
      detail: settings?.admin_whatsapp_number ? "Configured." : "Not set — Private-access fulfilment CTAs won't work.",
      fix: settings?.admin_whatsapp_number ? undefined : "Set it in Admin → Settings → General.",
    });
    const { data: templates } = await admin.from("email_templates").select("key, enabled").limit(50);
    const disabledTemplates = ((templates ?? []) as any[]).filter((t) => t.enabled === false).length;
    checks.push({
      key: "templates",
      label: "Email templates",
      status: disabledTemplates > 3 ? "warn" : "ok",
      detail: `${((templates ?? []).length)} templates present, ${disabledTemplates} disabled.`,
    });
    return {
      checks,
      generatedAt: new Date().toISOString(),
    };
  });

// ────────────────────────────────────────────────────────────────────────────
// EMERGENCY CONTROLS — pause switches, all audit-logged.
// ────────────────────────────────────────────────────────────────────────────

export const getEmergencyControls = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const admin = await assertPerm(context, "emergency.use");
    const { data } = await admin
      .from("site_settings")
      .select("maintenance_mode, orders_paused, payments_paused, emails_paused, updated_at, updated_by")
      .eq("id", true)
      .maybeSingle();
    return {
      maintenance_mode: Boolean(data?.maintenance_mode),
      orders_paused: Boolean(data?.orders_paused),
      payments_paused: Boolean(data?.payments_paused),
      emails_paused: Boolean(data?.emails_paused),
      updated_at: data?.updated_at ?? null,
    };
  });

const CONTROL_KEYS = ["maintenance_mode", "orders_paused", "payments_paused", "emails_paused"] as const;
type ControlKey = (typeof CONTROL_KEYS)[number];

export const setEmergencyControl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        key: z.enum(CONTROL_KEYS),
        enabled: z.boolean(),
        confirmation: z.literal("CONFIRM"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const admin = await assertPerm(context, "emergency.use");
    const patch: Record<ControlKey, boolean> = {} as any;
    patch[data.key] = data.enabled;
    const { error } = await admin
      .from("site_settings")
      .update({ ...patch, updated_by: context.userId })
      .eq("id", true);
    if (error) {
      await logAdminActivity(context, {
        action: `emergency.${data.key}.${data.enabled ? "on" : "off"}`,
        area: "emergency",
        success: false,
        reason: error.message,
      });
      throw new Error(error.message);
    }
    await logAdminActivity(context, {
      action: `emergency.${data.key}.${data.enabled ? "on" : "off"}`,
      area: "emergency",
      success: true,
      reference: `Admin ${data.enabled ? "enabled" : "disabled"} ${data.key.replace(/_/g, " ")}`,
    });
    return { ok: true as const };
  });
