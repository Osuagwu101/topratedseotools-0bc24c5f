/*
 * QuillBot authorised-session vault — admin only.
 *
 * Mirrors grammarly-session.functions.ts, adapted to QuillBot's
 * per-account table (quillbot_provider_accounts, keyed by account_key)
 * instead of the generic tool_authorized_sessions table, since QuillBot's
 * design supports more than one shared provider account.
 *
 * - Super Admin can paste/replace/revoke the shared QuillBot login
 * - values are normalised and AES-256-GCM encrypted before storage
 * - the Admin UI receives metadata only; decrypted state is never returned
 * - saving does not switch on one-click launch; an admin enables that
 *   separately once the session is confirmed working
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { logAdminActivity } from "@/lib/admin-audit.server";
import { encryptQuillBotSession, normaliseQuillBotSession } from "@/lib/quillbot-session.server";

const TOOL_SLUG = "quillbot";
const DEFAULT_ACCOUNT_KEY = "account_1";

async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin" });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

async function assertSuperAdmin(ctx: { supabase: any; userId: string }) {
  const admin = await assertAdmin(ctx);
  const { data, error } = await ctx.supabase.rpc("is_super_admin", { _user_id: ctx.userId });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Only a Super Admin can replace or revoke the QuillBot authorised session.");
  return admin;
}

export const adminGetQuillBotSessionStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const admin = await assertAdmin(context);
    const { data: row, error } = await admin
      .from("quillbot_provider_accounts")
      .select("account_key, status, session_format, updated_at, rotated_at")
      .eq("account_key", DEFAULT_ACCOUNT_KEY)
      .maybeSingle();
    if (error) throw new Error(error.message);

    const { data: isSuper, error: superError } = await context.supabase.rpc("is_super_admin", {
      _user_id: context.userId,
    });
    if (superError) throw new Error(superError.message);

    const { data: setting } = await admin
      .from("tool_settings")
      .select("one_click_auth_enabled")
      .eq("tool_slug", TOOL_SLUG)
      .maybeSingle();

    return {
      account_key: DEFAULT_ACCOUNT_KEY,
      configured: row?.status === "stored",
      status: row?.status ?? "not_configured",
      session_format: row?.session_format ?? "cookie_useridtoken_json",
      updated_at: row?.updated_at ?? null,
      rotated_at: row?.rotated_at ?? null,
      one_click_enabled: !!setting?.one_click_auth_enabled,
      can_manage: !!isSuper,
    };
  });

const saveInput = z.object({
  session_data: z.string().min(2).max(500000),
});

export const adminSaveQuillBotSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => saveInput.parse(input))
  .handler(async ({ data, context }) => {
    const admin = await assertSuperAdmin(context);
    const normalised = normaliseQuillBotSession(data.session_data);
    const encrypted = encryptQuillBotSession(normalised);
    const now = new Date().toISOString();

    const { error } = await admin
      .from("quillbot_provider_accounts")
      .update({
        encrypted_payload: encrypted,
        status: "stored",
        rotated_at: now,
        updated_at: now,
      })
      .eq("account_key", DEFAULT_ACCOUNT_KEY);
    if (error) throw new Error(error.message);

    // Revoke in-flight launch tickets/sessions so no writer is mid-launch
    // against a session we're about to replace.
    await admin.from("quillbot_proxy_sessions").update({ status: "revoked" }).in("status", ["issued", "active"]);

    await logAdminActivity(context, {
      action: "quillbot.authorized_session_replace",
      area: "tools",
      target_type: "tool_authorized_session",
      target_id: TOOL_SLUG,
      details: "Authorised QuillBot session replaced; cookie/token values were not logged.",
    });

    return { ok: true, status: "stored", updated_at: now };
  });

export const adminRevokeQuillBotSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const admin = await assertSuperAdmin(context);
    const now = new Date().toISOString();

    const { error } = await admin
      .from("quillbot_provider_accounts")
      .update({ status: "disabled", encrypted_payload: null, updated_at: now })
      .eq("account_key", DEFAULT_ACCOUNT_KEY);
    if (error) throw new Error(error.message);

    await admin.from("quillbot_proxy_sessions").update({ status: "revoked" }).in("status", ["issued", "active"]);
    await admin.from("tool_settings").update({ one_click_auth_enabled: false }).eq("tool_slug", TOOL_SLUG);

    await logAdminActivity(context, {
      action: "quillbot.authorized_session_revoke",
      area: "tools",
      target_type: "tool_authorized_session",
      target_id: TOOL_SLUG,
      details: "Authorised QuillBot session revoked; secret values were not logged.",
    });

    return { ok: true, status: "disabled", updated_at: now };
  });
