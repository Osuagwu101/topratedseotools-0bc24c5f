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
