/**
 * Shared admin activity logger. Writes a single row to
 * `admin_activity_log`. Must be imported INSIDE server-function handlers
 * (never at module scope of a `.functions.ts` file) because it pulls in
 * the service-role client.
 */
export interface AuditEntry {
  action: string;
  area?: string;
  target_type?: string;
  target_id?: string;
  success?: boolean;
  reason?: string;
  reference?: string;
  details?: string;
}

export async function logAdminActivity(ctx: { userId: string }, entry: AuditEntry): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: acct } = await (supabaseAdmin as any)
      .from("admin_accounts")
      .select("account_email")
      .eq("user_id", ctx.userId)
      .maybeSingle();
    const { data: role } = await (supabaseAdmin as any)
      .from("user_roles")
      .select("is_super_admin")
      .eq("user_id", ctx.userId)
      .eq("role", "admin")
      .maybeSingle();
    await (supabaseAdmin as any).from("admin_activity_log").insert({
      actor_user_id: ctx.userId,
      actor_email: acct?.account_email ?? null,
      actor_role: role?.is_super_admin ? "super_admin" : "admin",
      success: entry.success ?? true,
      action: entry.action,
      area: entry.area ?? null,
      target_type: entry.target_type ?? null,
      target_id: entry.target_id ?? null,
      reason: entry.reason ?? null,
      reference: entry.reference ?? entry.details ?? null,
    });
  } catch {
    // Non-fatal — do not block the sensitive action if the log write fails.
  }
}
