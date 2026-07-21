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

export const CUSTOMER_EMAIL_ADMIN_REJECTION =
  "This email is already registered as a customer. Please use a different email address for the Admin account.";

export function normalizeAdminEmail(email: string) {
  return email.trim().toLowerCase();
}

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
    const { data: accounts, error: accountError } = await supabaseAdmin
      .from("admin_accounts")
      .select("user_id, account_email, full_name, created_at")
      .order("created_at", { ascending: true });
    if (accountError) throw new Error(accountError.message);

    const ids = (accounts ?? []).map((r) => r.user_id);
    let roles: Record<string, { id: string; is_active?: boolean; is_super_admin?: boolean; created_at?: string }> = {};
    if (ids.length) {
      const { data: rows } = await supabaseAdmin
        .from("user_roles")
        .select("id, user_id, is_active, is_super_admin, created_at")
        .eq("role", "admin")
        .in("user_id", ids);
      roles = Object.fromEntries((rows ?? []).map((r) => [r.user_id, r]));
    }

    return {
      admins: (accounts ?? []).map((account) => ({
        id: roles[account.user_id]?.id ?? account.user_id,
        userId: account.user_id,
        email: account.account_email,
        fullName: account.full_name,
        isActive: roles[account.user_id]?.is_active !== false,
        isSuperAdmin: !!roles[account.user_id]?.is_super_admin,
        createdAt: roles[account.user_id]?.created_at ?? account.created_at,
      })),
    };
  });

export const createAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        email: z.string().email().transform(normalizeAdminEmail),
        fullName: z.string().trim().max(120).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: existingAdmin, error: existingAdminError } = await supabaseAdmin
      .from("admin_accounts")
      .select("user_id")
      .eq("account_email", data.email)
      .maybeSingle();
    if (existingAdminError) throw new Error(existingAdminError.message);

    if (existingAdmin) {
      const { error } = await supabaseAdmin
        .from("user_roles")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .update({ is_active: true } as any)
        .eq("user_id", existingAdmin.user_id)
        .eq("role", "admin");
      if (error) throw new Error(error.message);
      return { ok: true, userId: existingAdmin.user_id };
    }

    const { data: existingCustomer, error: existingCustomerError } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("email", data.email)
      .maybeSingle();
    if (existingCustomerError) throw new Error(existingCustomerError.message);
    if (existingCustomer) throw new Error(CUSTOMER_EMAIL_ADMIN_REJECTION);

    const { data: invited, error: inviteErr } =
      await supabaseAdmin.auth.admin.inviteUserByEmail(data.email, {
        data: data.fullName ? { full_name: data.fullName } : undefined,
      });
    if (inviteErr || !invited.user) {
      throw new Error(inviteErr?.message ?? "Could not invite admin");
    }
    const targetUserId = invited.user.id;

    const { error: accountError } = await supabaseAdmin
      .from("admin_accounts")
      .insert({
        user_id: targetUserId,
        account_email: data.email,
        email: data.email,
        full_name: data.fullName ?? null,
        invited_by: context.userId,
      });
    if (accountError) throw new Error(accountError.message);

    const { error } = await supabaseAdmin
      .from("user_roles")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .insert({ user_id: targetUserId, role: "admin", is_active: true, is_super_admin: false } as any);
    if (error) throw new Error(error.message);

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
    const { data: account } = await supabaseAdmin
      .from("admin_accounts")
      .select("account_email")
      .eq("account_email", normalizeAdminEmail(data.email))
      .maybeSingle();
    if (!account) throw new Error("Admin account not found.");
    const { error } = await supabaseAdmin.auth.admin.inviteUserByEmail(account.account_email);
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
