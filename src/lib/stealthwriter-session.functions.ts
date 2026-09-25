/*
 * StealthWriter authorised-session vault — admin only.
 *
 * Phase 2 scope:
 * - Super Admin can paste/replace the two authorised Better Auth cookie values.
 * - Raw values are normalised and encrypted with AES-256-GCM before storage.
 * - The admin UI only receives metadata; stored session values are never read back.
 * - No customer/writer launch path is exposed here.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { logAdminActivity } from "@/lib/admin-audit.server";
import {
  encryptStealthWriterSession,
  normaliseStealthWriterSession,
} from "@/lib/stealthwriter-session.server";

const TOOL_SLUG = "stealthwriter";

async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase.rpc("has_role", {
    _user_id: ctx.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

async function assertSuperAdmin(ctx: { supabase: any; userId: string }) {
  const admin = await assertAdmin(ctx);
  const { data, error } = await ctx.supabase.rpc("is_super_admin", {
    _user_id: ctx.userId,
  });
  if (error) throw new Error(error.message);
  if (!data) {
    throw new Error(
      "Only a Super Admin can replace the StealthWriter authorised session.",
    );
  }
  return admin;
}
export const adminGetStealthWriterSessionStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const admin = await assertAdmin(context);
    const { data: row, error } = await admin
      .from("tool_authorized_sessions")
      .select("tool_slug, status, session_format, updated_at")
      .eq("tool_slug", TOOL_SLUG)
      .maybeSingle();
    if (error) throw new Error(error.message);

    const { data: isSuper } = await context.supabase.rpc("is_super_admin", {
      _user_id: context.userId,
    });

    return {
      configured: row?.status === "stored",
      status: row?.status ?? "not_configured",
      session_format: row?.session_format ?? "better_auth_cookie_json",
      updated_at: row?.updated_at ?? null,
      can_manage: !!isSuper,
    };
  });

const saveInput = z.object({
  session_data: z.string().min(2).max(70000),
});

export const adminSaveStealthWriterSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => saveInput.parse(input))
  .handler(async ({ data, context }) => {
    const admin = await assertSuperAdmin(context);
    const normalised = normaliseStealthWriterSession(data.session_data);
    const encrypted = encryptStealthWriterSession(normalised);
    const now = new Date().toISOString();

    const { error } = await admin
      .from("tool_authorized_sessions")
      .upsert(
        {
          tool_slug: TOOL_SLUG,
          encrypted_payload: encrypted,
          session_format: "better_auth_cookie_json",
          status: "stored",
          updated_by: context.userId,
          updated_at: now,
        },
        { onConflict: "tool_slug" },
      );
    if (error) throw new Error(error.message);

    await logAdminActivity(context, {
      action: "stealthwriter.authorized_session_replace",
      area: "tools",
      target_type: "tool_authorized_session",
      target_id: TOOL_SLUG,
      details: "Authorised StealthWriter session replaced; secret values were not logged.",
    });

    return { ok: true, status: "stored", updated_at: now };
  });


/* ---------------- Phase 2: provider-account admin management ---------------- */

export const STEALTHWRITER_PROVIDER_ACCOUNT_KEYS = [
  "account_1",
  "account_2",
] as const;

const providerAccountKey = z.enum(STEALTHWRITER_PROVIDER_ACCOUNT_KEYS);

export const adminListStealthWriterProviderAccounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const admin = await assertAdmin(context);
    const { data: rows, error } = await admin
      .from("stealthwriter_provider_accounts")
      .select(
        "account_key, display_name, sort_order, status, session_format, updated_at, rotated_at",
      )
      .in("account_key", STEALTHWRITER_PROVIDER_ACCOUNT_KEYS)
      .order("sort_order", { ascending: true });
    if (error) throw new Error(error.message);

    const { data: isSuper, error: superError } = await context.supabase.rpc(
      "is_super_admin",
      { _user_id: context.userId },
    );
    if (superError) throw new Error(superError.message);

    return {
      can_manage: !!isSuper,
      accounts: ((rows ?? []) as any[]).map((row) => ({
        account_key: String(row.account_key),
        display_name: String(row.display_name),
        sort_order: Number(row.sort_order),
        configured: row.status === "stored",
        status: String(row.status ?? "not_configured"),
        session_format: String(
          row.session_format ?? "better_auth_cookie_json",
        ),
        updated_at: row.updated_at ? String(row.updated_at) : null,
        rotated_at: row.rotated_at ? String(row.rotated_at) : null,
      })),
    };
  });

const providerSaveInput = z.object({
  account_key: providerAccountKey,
  session_data: z.string().min(2).max(70000),
});

export const adminSaveStealthWriterProviderSession = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => providerSaveInput.parse(input))
  .handler(async ({ data, context }) => {
    const admin = await assertSuperAdmin(context);
    const normalised = normaliseStealthWriterSession(data.session_data);
    const encrypted = encryptStealthWriterSession(normalised);
    const now = new Date().toISOString();

    if (data.account_key === "account_1") {
      // Account 1 is still the live production source in Phase 2.
      // Write through the proven legacy vault; the Phase 1 trigger mirrors it
      // into stealthwriter_provider_accounts automatically.
      const { error } = await admin
        .from("tool_authorized_sessions")
        .upsert(
          {
            tool_slug: TOOL_SLUG,
            encrypted_payload: encrypted,
            session_format: "better_auth_cookie_json",
            status: "stored",
            updated_by: context.userId,
            updated_at: now,
          },
          { onConflict: "tool_slug" },
        );
      if (error) throw new Error(error.message);
    } else {
      // Account 2 is stored independently but is not routed to customers yet.
      const { error } = await admin
        .from("stealthwriter_provider_accounts")
        .upsert(
          {
            account_key: "account_2",
            display_name: "Account 2",
            sort_order: 2,
            encrypted_payload: encrypted,
            session_format: "better_auth_cookie_json",
            status: "stored",
            updated_by: context.userId,
            updated_at: now,
          },
          { onConflict: "account_key" },
        );
      if (error) throw new Error(error.message);
    }

    const displayName =
      data.account_key === "account_1" ? "Account 1" : "Account 2";

    await logAdminActivity(context, {
      action: "stealthwriter.provider_session_replace",
      area: "tools",
      target_type: "stealthwriter_provider_account",
      target_id: data.account_key,
      details:
        `${displayName} authorised session replaced; secret values were not logged.`,
    });

    return {
      ok: true,
      account_key: data.account_key,
      status: "stored",
      updated_at: now,
    };
  });
