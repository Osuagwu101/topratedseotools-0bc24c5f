/**
 * Admin permissions & staff — server functions.
 *
 * Single flow for admin invitation (Supabase inviteUserByEmail + admin_accounts
 * + user_roles + admin_invitations metadata). Synchronous audit logging for
 * sensitive actions.
 */
import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  ALL_PERMISSIONS,
  ROLE_DEFAULTS,
  ROLE_KEYS,
  resolveEffectivePermissions,
  type Permission,
  type RoleKey,
} from "@/lib/admin-permissions";

function normalizeEmail(e: string) {
  return e.trim().toLowerCase();
}

type AppSupabase = SupabaseClient<Database>;
type UserRoleRow = Pick<
  Database["public"]["Tables"]["user_roles"]["Row"],
  "id" | "user_id" | "is_active" | "is_super_admin"
>;
type AdminInvitationRow = Pick<
  Database["public"]["Tables"]["admin_invitations"]["Row"],
  "id" | "email" | "auth_user_id" | "status" | "expires_at" | "accepted_at" | "created_at"
>;
type Ctx = { supabase: AppSupabase; userId: string; claims?: Record<string, unknown> };

async function assertActiveAdmin(ctx: Ctx) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: role } = await supabaseAdmin
    .from("user_roles")
    .select("is_active, is_super_admin")
    .eq("user_id", ctx.userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!role || role.is_active === false) throw new Error("Forbidden");
  const { data: acct } = await supabaseAdmin
    .from("admin_accounts")
    .select("user_id")
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (!acct) throw new Error("Forbidden");
  return { isSuperAdmin: !!role.is_super_admin };
}

async function assertSuperAdmin(ctx: Ctx) {
  const r = await assertActiveAdmin(ctx);
  if (!r.isSuperAdmin) throw new Error("Forbidden — Super Admin only");
}

async function assertPermission(ctx: Ctx, perm: Permission) {
  const r = await assertActiveAdmin(ctx);
  if (r.isSuperAdmin) return;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.rpc("admin_effective_permission", {
    _uid: ctx.userId,
    _perm: perm,
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden");
}

/** Write a single admin_activity_log row synchronously; throws on failure. */
async function writeAudit(
  ctx: Ctx,
  entry: {
    action: string;
    area?: string;
    target_type?: string;
    target_id?: string;
    success: boolean;
    reason?: string;
    reference?: string;
  },
) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: acct } = await supabaseAdmin
    .from("admin_accounts")
    .select("account_email")
    .eq("user_id", ctx.userId)
    .maybeSingle();
  const { data: role } = await supabaseAdmin
    .from("user_roles")
    .select("is_super_admin")
    .eq("user_id", ctx.userId)
    .eq("role", "admin")
    .maybeSingle();
  const { error } = await supabaseAdmin.from("admin_activity_log").insert({
    actor_user_id: ctx.userId,
    actor_email: acct?.account_email ?? null,
    actor_role: role?.is_super_admin ? "super_admin" : "admin",
    ...entry,
  });
  if (error) {
    // Sensitive-action rule: audit failure aborts.
    throw new Error("Action could not be recorded — no change was made. " + error.message);
  }
}

/**
 * Arbitrary-user session revocation is unavailable here.
 * Supabase sign-out revokes sessions using the user's JWT; this admin surface
 * stores only the user UUID and intentionally does not persist staff JWTs.
 */
async function detectCanEndSessions(): Promise<boolean> {
  return false;
}

/* ---------- getMyAdminContext ---------- */

export const getMyAdminContext = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: role } = await supabaseAdmin
      .from("user_roles")
      .select("is_active, is_super_admin")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .maybeSingle();
    const isActive = !!role && role.is_active !== false;
    const { data: acct } = await supabaseAdmin
      .from("admin_accounts")
      .select("role_key")
      .eq("user_id", context.userId)
      .maybeSingle();
    const isActiveAdmin = isActive && !!acct;
    const isSuperAdmin = isActiveAdmin && !!role?.is_super_admin;
    const overrides: Record<string, boolean> = {};
    if (isActiveAdmin && !isSuperAdmin) {
      const { data: rows } = await supabaseAdmin
        .from("admin_permissions")
        .select("permission, granted")
        .eq("user_id", context.userId);
      for (const row of rows ?? []) overrides[row.permission] = !!row.granted;
    }
    const permissions = resolveEffectivePermissions({
      isActiveAdmin,
      isSuperAdmin,
      roleKey: (acct?.role_key as RoleKey | null) ?? null,
      overrides,
    });
    const canEndSessions = await detectCanEndSessions();
    return {
      isAdmin: isActiveAdmin,
      isSuperAdmin,
      roleKey: (acct?.role_key as RoleKey | null) ?? null,
      permissions,
      capabilities: { canEndSessions },
    };
  });

/* ---------- listStaff ---------- */

export const listStaff = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertSuperAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: accounts, error } = await supabaseAdmin
      .from("admin_accounts")
      .select("user_id, account_email, full_name, role_key, created_at")
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    const ids = (accounts ?? []).map((a) => a.user_id);
    let roles: Record<string, UserRoleRow> = {};
    const overrides: Record<string, Record<string, boolean>> = {};
    const invitations: Record<string, AdminInvitationRow> = {};
    const lastSignInMap: Record<string, string | null> = {};
    const mustChangeMap: Record<string, boolean> = {};

    if (ids.length) {
      const { data: rows } = await supabaseAdmin
        .from("user_roles")
        .select("id, user_id, is_active, is_super_admin")
        .eq("role", "admin")
        .in("user_id", ids);
      roles = Object.fromEntries((rows ?? []).map((r) => [r.user_id, r]));

      const { data: permRows } = await supabaseAdmin
        .from("admin_permissions")
        .select("user_id, permission, granted")
        .in("user_id", ids);
      for (const row of permRows ?? []) {
        overrides[row.user_id] ??= {};
        overrides[row.user_id][row.permission] = !!row.granted;
      }

      const { data: invRows } = await supabaseAdmin
        .from("admin_invitations")
        .select("id, email, auth_user_id, status, expires_at, accepted_at, created_at")
        .in("auth_user_id", ids)
        .order("created_at", { ascending: false });
      for (const row of invRows ?? []) {
        if (row.auth_user_id && !invitations[row.auth_user_id]) {
          invitations[row.auth_user_id] = row;
        }
      }

      for (const uid of ids) {
        try {
          const { data } = await supabaseAdmin.auth.admin.getUserById(uid);
          const u = data?.user;
          lastSignInMap[uid] = u?.last_sign_in_at ?? null;
          mustChangeMap[uid] = !!u?.user_metadata?.must_change_password;
          const emailConfirmed = !!u?.email_confirmed_at;
          const inv = invitations[uid];
          if (inv && inv.status === "pending" && emailConfirmed) {
            await supabaseAdmin
              .from("admin_invitations")
              .update({ status: "accepted", accepted_at: new Date().toISOString() })
              .eq("id", inv.id);
            inv.status = "accepted";
            inv.accepted_at = new Date().toISOString();
          } else if (
            inv &&
            inv.status === "pending" &&
            inv.expires_at &&
            new Date(inv.expires_at).getTime() < Date.now()
          ) {
            await supabaseAdmin
              .from("admin_invitations")
              .update({ status: "expired" })
              .eq("id", inv.id);
            inv.status = "expired";
          }
        } catch {
          lastSignInMap[uid] = null;
        }
      }
    }

    return {
      admins: (accounts ?? []).map((a) => {
        const role = roles[a.user_id];
        const isActive = !!role && role.is_active !== false;
        const isSuperAdmin = !!role?.is_super_admin;
        const perms = resolveEffectivePermissions({
          isActiveAdmin: isActive,
          isSuperAdmin,
          roleKey: (a.role_key as RoleKey | null) ?? null,
          overrides: overrides[a.user_id] ?? {},
        });
        return {
          userId: a.user_id,
          email: a.account_email,
          fullName: a.full_name,
          roleKey: a.role_key as RoleKey | null,
          isActive,
          isSuperAdmin,
          permissions: perms,
          overrides: overrides[a.user_id] ?? {},
          invitation: invitations[a.user_id]
            ? {
                id: invitations[a.user_id].id,
                status: invitations[a.user_id].status,
                expiresAt: invitations[a.user_id].expires_at,
              }
            : null,
          lastSignInAt: lastSignInMap[a.user_id] ?? null,
          mustChangePassword: !!mustChangeMap[a.user_id],
        };
      }),
    };
  });

/* ---------- createStaff (single invitation flow) ---------- */

export const createStaff = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        email: z.string().email().transform(normalizeEmail),
        fullName: z.string().trim().max(120).optional(),
        roleKey: z.enum(ROLE_KEYS as [RoleKey, ...RoleKey[]]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Reject if email already belongs to a customer
    const { data: existingCustomer } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("email", data.email)
      .maybeSingle();

    // Existing admin account for this email → idempotent update
    const { data: existingAdmin } = await supabaseAdmin
      .from("admin_accounts")
      .select("user_id")
      .eq("account_email", data.email)
      .maybeSingle();

    if (existingAdmin) {
      // Ensure role_key is set; ensure role row active; do NOT send a second email
      await supabaseAdmin
        .from("admin_accounts")
        .update({ role_key: data.roleKey, full_name: data.fullName ?? null })
        .eq("user_id", existingAdmin.user_id);
      const { data: roleRow } = await supabaseAdmin
        .from("user_roles")
        .select("id")
        .eq("user_id", existingAdmin.user_id)
        .eq("role", "admin")
        .maybeSingle();
      if (roleRow) {
        await supabaseAdmin
          .from("user_roles")
          .update({ is_active: true })
          .eq("id", roleRow.id);
      } else {
        await supabaseAdmin.from("user_roles").insert({
          user_id: existingAdmin.user_id,
          role: "admin",
          is_active: true,
          is_super_admin: false,
        });
      }
      await writeAudit(context, {
        action: "staff.updated",
        area: "staff",
        target_type: "admin",
        target_id: existingAdmin.user_id,
        success: true,
        reason: `role=${data.roleKey}`,
      });
      return { ok: true, userId: existingAdmin.user_id, invited: false };
    }

    if (existingCustomer) {
      await writeAudit(context, {
        action: "staff.invite_rejected",
        area: "staff",
        success: false,
        reason: "email_is_customer",
      });
      throw new Error(
        "This email is already registered as a customer. Please use a different email address for the Admin account.",
      );
    }

    // Idempotent: existing pending invitation returned without resending.
    const { data: pending } = await supabaseAdmin
      .from("admin_invitations")
      .select("id, auth_user_id, status")
      .ilike("email", data.email)
      .eq("status", "pending")
      .maybeSingle();
    if (pending?.auth_user_id) {
      return { ok: true, userId: pending.auth_user_id, invited: false };
    }

    // Fresh invitation
    const { data: invited, error: inviteErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(data.email, {
      data: data.fullName ? { full_name: data.fullName } : undefined,
    });
    if (inviteErr || !invited?.user) {
      throw new Error(inviteErr?.message ?? "Could not send invitation");
    }
    const uid = invited.user.id;

    await supabaseAdmin.from("admin_accounts").insert({
      user_id: uid,
      account_email: data.email,
      email: data.email,
      full_name: data.fullName ?? null,
      role_key: data.roleKey,
      invited_by: context.userId,
    });
    await supabaseAdmin.from("user_roles").insert({
      user_id: uid,
      role: "admin",
      is_active: true,
      is_super_admin: false,
    });
    const expiresAt = new Date(Date.now() + 72 * 3600 * 1000).toISOString();
    await supabaseAdmin.from("admin_invitations").insert({
      email: data.email,
      role_key: data.roleKey,
      invited_by: context.userId,
      auth_user_id: uid,
      status: "pending",
      expires_at: expiresAt,
    });
    await writeAudit(context, {
      action: "staff.invited",
      area: "staff",
      target_type: "admin",
      target_id: uid,
      success: true,
      reason: `role=${data.roleKey}`,
    });
    return { ok: true, userId: uid, invited: true };
  });

/* ---------- resendInvitation ---------- */

export const resendInvitation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ userId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: acct } = await supabaseAdmin
      .from("admin_accounts")
      .select("account_email")
      .eq("user_id", data.userId)
      .maybeSingle();
    if (!acct?.account_email) throw new Error("Admin account not found");
    const { error } = await supabaseAdmin.auth.admin.inviteUserByEmail(acct.account_email);
    if (error) throw new Error(error.message);
    const expiresAt = new Date(Date.now() + 72 * 3600 * 1000).toISOString();
    await supabaseAdmin
      .from("admin_invitations")
      .update({ status: "pending", expires_at: expiresAt })
      .eq("auth_user_id", data.userId);
    await writeAudit(context, {
      action: "staff.invite_resent",
      area: "staff",
      target_type: "admin",
      target_id: data.userId,
      success: true,
    });
    return { ok: true };
  });

/* ---------- revokeInvitation ---------- */

export const revokeInvitation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ userId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("admin_invitations")
      .update({ status: "revoked" })
      .eq("auth_user_id", data.userId)
      .eq("status", "pending");
    // Best-effort: disable the auth user if still unaccepted
    try {
      const { data: userWrap } = await supabaseAdmin.auth.admin.getUserById(data.userId);
      if (!userWrap?.user?.email_confirmed_at) {
        await supabaseAdmin.auth.admin.updateUserById(data.userId, {
          ban_duration: "876000h",
        });
      }
    } catch {
      // Best-effort cleanup/audit path; the primary admin action has already completed.
    }
    await writeAudit(context, {
      action: "staff.invite_revoked",
      area: "staff",
      target_type: "admin",
      target_id: data.userId,
      success: true,
    });
    return { ok: true };
  });

/* ---------- updateStaffRole ---------- */

export const updateStaffRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        userId: z.string().uuid(),
        roleKey: z.enum(ROLE_KEYS as [RoleKey, ...RoleKey[]]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Super admins keep their status; role_key does not apply to them.
    const { data: role } = await supabaseAdmin
      .from("user_roles")
      .select("is_super_admin")
      .eq("user_id", data.userId)
      .eq("role", "admin")
      .maybeSingle();
    if (role?.is_super_admin) {
      throw new Error("Super Admins do not use role defaults.");
    }
    await writeAudit(context, {
      action: "staff.role_changed",
      area: "staff",
      target_type: "admin",
      target_id: data.userId,
      success: true,
      reason: `role=${data.roleKey}`,
    });
    const { error } = await supabaseAdmin
      .from("admin_accounts")
      .update({ role_key: data.roleKey })
      .eq("user_id", data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ---------- setStaffPermission ---------- */

export const setStaffPermission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        userId: z.string().uuid(),
        permission: z.enum(ALL_PERMISSIONS as unknown as [string, ...string[]]),
        granted: z.boolean().nullable(), // null = clear override (revert to role default)
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await writeAudit(context, {
      action: "staff.permission_changed",
      area: "staff",
      target_type: "admin",
      target_id: data.userId,
      success: true,
      reason: `${data.permission}=${data.granted === null ? "default" : data.granted}`,
    });
    if (data.granted === null) {
      await supabaseAdmin
        .from("admin_permissions")
        .delete()
        .eq("user_id", data.userId)
        .eq("permission", data.permission);
    } else {
      await supabaseAdmin.from("admin_permissions").upsert(
        {
          user_id: data.userId,
          permission: data.permission,
          granted: data.granted,
          updated_by: context.userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,permission" },
      );
    }
    return { ok: true };
  });

/* ---------- resetStaffToRoleDefaults ---------- */

export const resetStaffToRoleDefaults = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ userId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await writeAudit(context, {
      action: "staff.permissions_reset",
      area: "staff",
      target_type: "admin",
      target_id: data.userId,
      success: true,
    });
    await supabaseAdmin.from("admin_permissions").delete().eq("user_id", data.userId);
    return { ok: true };
  });

/* ---------- disableStaff / restoreStaff ---------- */

export const setStaffActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ userId: z.string().uuid(), isActive: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context);
    if (data.userId === context.userId && !data.isActive) {
      throw new Error("You cannot disable your own admin account.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await writeAudit(context, {
      action: data.isActive ? "staff.restored" : "staff.disabled",
      area: "staff",
      target_type: "admin",
      target_id: data.userId,
      success: true,
    });
    const { error } = await supabaseAdmin
      .from("user_roles")
      .update({ is_active: data.isActive })
      .eq("user_id", data.userId)
      .eq("role", "admin");
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ---------- requirePasswordReset ---------- */

export const requirePasswordReset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ userId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await writeAudit(context, {
      action: "staff.password_reset_required",
      area: "staff",
      target_type: "admin",
      target_id: data.userId,
      success: true,
    });
    const { data: userWrap } = await supabaseAdmin.auth.admin.getUserById(data.userId);
    const currentMeta = userWrap?.user?.user_metadata ?? {};
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      user_metadata: { ...currentMeta, must_change_password: true },
    });
    if (error) throw new Error(error.message);
    // Trigger a password-reset email so they can set a new one.
    try {
      if (userWrap?.user?.email) {
        await supabaseAdmin.auth.admin.inviteUserByEmail(userWrap.user.email);
      }
    } catch {
      // Best-effort cleanup/audit path; the primary admin action has already completed.
    }
    return { ok: true };
  });

/* ---------- endStaffSessions ---------- */

export const endStaffSessions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ userId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertSuperAdmin(context);
    await writeAudit(context, {
      action: "staff.end_sessions",
      area: "staff",
      target_type: "admin",
      target_id: data.userId,
      success: false,
      reason: "jwt_required_for_arbitrary_user_revocation",
    });
    throw new Error(
      "Ending another admin's sessions is not supported by the current authentication integration.",
    );
  });
