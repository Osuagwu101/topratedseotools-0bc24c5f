/**
 * Admin activity log — read API for the Admin Activity page.
 * Access is limited to super admins and admins with the `audit.view` permission.
 * Writes happen inside the individual action server functions (never here).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAuditReader(ctx: { supabase: any; userId: string }) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: role } = await (supabaseAdmin as any)
    .from("user_roles")
    .select("is_active, is_super_admin")
    .eq("user_id", ctx.userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!role || role.is_active === false) throw new Error("Forbidden");
  if (role.is_super_admin) return;
  const { data: allowed } = await (supabaseAdmin as any).rpc("admin_effective_permission", {
    _uid: ctx.userId,
    _perm: "audit.view",
  });
  if (!allowed) throw new Error("Forbidden");
}

export const listAdminActivity = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        page: z.number().int().min(1).default(1).optional(),
        pageSize: z.number().int().min(1).max(200).default(50).optional(),
        area: z.string().optional(),
        success: z.enum(["all", "success", "failure"]).default("all").optional(),
      })
      .default({})
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    await assertAuditReader(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const page = data.page ?? 1;
    const pageSize = data.pageSize ?? 50;
    let q = (supabaseAdmin as any)
      .from("admin_activity_log")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);
    if (data.area) q = q.eq("area", data.area);
    if (data.success === "success") q = q.eq("success", true);
    if (data.success === "failure") q = q.eq("success", false);
    const { data: rows, count, error } = await q;
    if (error) throw new Error(error.message);
    return {
      rows: (rows ?? []).map((r: any) => ({
        id: r.id,
        actorEmail: r.actor_email,
        actorRole: r.actor_role,
        action: r.action,
        area: r.area,
        targetType: r.target_type,
        targetId: r.target_id,
        success: r.success,
        reason: r.reason,
        reference: r.reference,
        createdAt: r.created_at,
      })),
      total: count ?? 0,
      page,
      pageSize,
    };
  });
