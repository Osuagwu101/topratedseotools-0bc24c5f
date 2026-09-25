/*
 * Phrasly authorised-session vault — admin only.
 *
 * Phase 2 scope:
 * - one Phrasly upstream account
 * - Super Admin can paste/replace authorised cookies + browser storage state
 * - raw values are normalised and AES-256-GCM encrypted before storage
 * - the Admin UI receives metadata only; decrypted state is never returned
 * - no customer proxy/launch is exposed in this phase
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { logAdminActivity } from "@/lib/admin-audit.server";
import {
  encryptPhraslySession,
  normalisePhraslySession,
} from "@/lib/phrasly-session.server";

const TOOL_SLUG = "phrasly";
export const PHRASLY_SESSION_FORMAT = "phrasly_session_state_json_v1";

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
      "Only a Super Admin can replace the Phrasly authorised session.",
    );
  }
  return admin;
}

export const adminGetPhraslySessionStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const admin = await assertAdmin(context);
    const { data: row, error } = await admin
      .from("tool_authorized_sessions")
      .select("tool_slug, status, session_format, updated_at")
      .eq("tool_slug", TOOL_SLUG)
      .maybeSingle();
    if (error) throw new Error(error.message);

    const { data: isSuper, error: superError } = await context.supabase.rpc(
      "is_super_admin",
      { _user_id: context.userId },
    );
    if (superError) throw new Error(superError.message);

    return {
      configured: row?.status === "stored",
      status: row?.status ?? "not_configured",
      session_format: row?.session_format ?? PHRASLY_SESSION_FORMAT,
      updated_at: row?.updated_at ?? null,
      can_manage: !!isSuper,
    };
  });

const saveInput = z.object({
  session_data: z.string().min(2).max(250000),
});

export const adminSavePhraslySession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => saveInput.parse(input))
  .handler(async ({ data, context }) => {
    const admin = await assertSuperAdmin(context);
    const normalised = normalisePhraslySession(data.session_data);
    const encrypted = encryptPhraslySession(normalised);
    const now = new Date().toISOString();

    const { error } = await admin
      .from("tool_authorized_sessions")
      .upsert(
        {
          tool_slug: TOOL_SLUG,
          encrypted_payload: encrypted,
          session_format: PHRASLY_SESSION_FORMAT,
          status: "stored",
          updated_by: context.userId,
          updated_at: now,
        },
        { onConflict: "tool_slug" },
      );
    if (error) throw new Error(error.message);

    await logAdminActivity(context, {
      action: "phrasly.authorized_session_replace",
      area: "tools",
      target_type: "tool_authorized_session",
      target_id: TOOL_SLUG,
      details:
        "Authorised Phrasly session replaced; cookie/token values were not logged.",
    });

    return { ok: true, status: "stored", updated_at: now };
  });
