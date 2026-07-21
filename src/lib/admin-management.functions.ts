/**
 * Admin management — Super Admin only.
 *
 * Server functions for the /admin/admins page. Only a Super Admin may create,
 * activate, deactivate or remove other admin accounts. Ordinary admins keep
 * every other admin power but cannot touch admin accounts.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertSuperAdmin(userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("is_super_admin, is_active, role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || !data.is_super_admin || !data.is_active) {
    throw new Error("Forbidden — Super Admin only");
  }
}

export const getAdminContext = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("user_roles")
      .select("role, is_super_admin, is_active")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .maybeSingle();
    const row = data as { is_super_admin?: boolean; is_active?: boolean } | null;
    const isActive = !!row && row.is_active !== false;
    return {
      isAdmin: isActive,
      isSuperAdmin: isActive && !!row?.is_super_admin,
    };
  });

export const listAdmins = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertSuperAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: roles, error } = await supabaseAdmin
      .from("user_roles")
      .select("id, user_id, role, is_active, is_super_admin, created_at")
      .eq("role", "admin")
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);

    const ids = (roles ?? []).map((r) => r.user_id);
    let profiles: Record<string, { email: string | null; full_name: string | null }> = {};
    if (ids.length) {
      const { data: rows } = await supabaseAdmin
        .from("profiles")
        .select("id, email, full_name")
        .in("id", ids);
      profiles = Object.fromEntries((rows ?? []).map((p) => [p.id, { email: p.email, full_name: p.full_name }]));
    }

    return {
      admins: (roles ?? []).map((r) => ({
        id: r.id,
        userId: r.user_id,
        email: profiles[r.user_id]?.email ?? null,
        fullName: profiles[r.user_id]?.full_name ?? null,
        isActive: (r as { is_active?: boolean }).is_active !== false,
        isSuperAdmin: !!(r as { is_super_admin?: boolean }).is_super_admin,
        createdAt: r.created_at,
      })),
    };
  });

export const createAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        email: z.string().email().transform((v) => v.trim().toLowerCase()),
        fullName: z.string().trim().max(120).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Find or invite the target auth user
    let targetUserId: string | null = null;
    const { data: existing } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("email", data.email)
      .maybeSingle();
    if (existing) {
      targetUserId = existing.id;
    } else {
      const { data: invited, error: inviteErr } =
        await supabaseAdmin.auth.admin.inviteUserByEmail(data.email, {
          data: data.fullName ? { full_name: data.fullName } : undefined,
        });
      if (inviteErr || !invited.user) {
        throw new Error(inviteErr?.message ?? "Could not invite admin");
      }
      targetUserId = invited.user.id;
    }

    // Insert / re-activate the admin role row
    const { data: roleRow } = await supabaseAdmin
      .from("user_roles")
      .select("id")
      .eq("user_id", targetUserId)
      .eq("role", "admin")
      .maybeSingle();

    if (roleRow) {
      const { error } = await supabaseAdmin
        .from("user_roles")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .update({ is_active: true } as any)
        .eq("id", roleRow.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabaseAdmin
        .from("user_roles")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .insert({ user_id: targetUserId, role: "admin", is_active: true, is_super_admin: false } as any);
      if (error) throw new Error(error.message);
    }

    return { ok: true, userId: targetUserId };
  });

export const setAdminActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ userId: z.string().uuid(), isActive: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context.userId);
    if (data.userId === context.userId) {
      throw new Error("You cannot deactivate your own admin account.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("user_roles")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update({ is_active: data.isActive } as any)
      .eq("user_id", data.userId)
      .eq("role", "admin");
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const resendAdminInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ email: z.string().email() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.inviteUserByEmail(data.email);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const removeAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ userId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context.userId);
    if (data.userId === context.userId) {
      throw new Error("You cannot remove your own admin account.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("user_roles")
      .delete()
      .eq("user_id", data.userId)
      .eq("role", "admin");
    if (error) throw new Error(error.message);
    return { ok: true };
  });
