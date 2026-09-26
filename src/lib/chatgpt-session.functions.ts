/*
 * ChatGPT authorised-session vault — admin only.
 *
 * Phase 2 scope:
 * - Super Admin can paste/replace/revoke authorised first-party session state
 * - raw values are normalised and AES-256-GCM encrypted before storage
 * - the Admin UI receives metadata only; decrypted state is never returned
 * - no writer launch path is exposed in this phase
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { logAdminActivity } from "@/lib/admin-audit.server";
import {
  encryptChatGptSession,
  normaliseChatGptSession,
} from "@/lib/chatgpt-session.server";

const TOOL_SLUG = "chatgpt";
export const CHATGPT_SESSION_FORMAT = "chatgpt_session_state_json_v1";

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
      "Only a Super Admin can replace or revoke the ChatGPT authorised session.",
    );
  }
  return admin;
}

export const adminGetChatGptSessionStatus = createServerFn({ method: "GET" })
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
      session_format: row?.session_format ?? CHATGPT_SESSION_FORMAT,
      updated_at: row?.updated_at ?? null,
      can_manage: !!isSuper,
    };
  });

const saveInput = z.object({
  session_data: z.string().min(2).max(500000),
});

export const adminSaveChatGptSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => saveInput.parse(input))
  .handler(async ({ data, context }) => {
    const admin = await assertSuperAdmin(context);
    const normalised = normaliseChatGptSession(data.session_data);
    const encrypted = encryptChatGptSession(normalised);
    const now = new Date().toISOString();

    const { error } = await admin
      .from("tool_authorized_sessions")
      .upsert(
        {
          tool_slug: TOOL_SLUG,
          encrypted_payload: encrypted,
          session_format: CHATGPT_SESSION_FORMAT,
          status: "stored",
          updated_by: context.userId,
          updated_at: now,
        },
        { onConflict: "tool_slug" },
      );
    if (error) throw new Error(error.message);

    const { error: revokeProxyError } = await admin
      .from("chatgpt_proxy_sessions")
      .update({ status: "revoked" })
      .in("status", ["issued", "active"]);
    if (revokeProxyError) throw new Error(revokeProxyError.message);

    await logAdminActivity(context, {
      action: "chatgpt.authorized_session_replace",
      area: "tools",
      target_type: "tool_authorized_session",
      target_id: TOOL_SLUG,
      details:
        "Authorised ChatGPT session replaced; cookie/storage values were not logged; existing ChatGPT proxy sessions were revoked.",
    });

    return { ok: true, status: "stored", updated_at: now };
  });

export const adminRevokeChatGptSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const admin = await assertSuperAdmin(context);
    const now = new Date().toISOString();

    const { data: existing, error: readError } = await admin
      .from("tool_authorized_sessions")
      .select("tool_slug")
      .eq("tool_slug", TOOL_SLUG)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    if (!existing) {
      return { ok: true, status: "not_configured", updated_at: null };
    }

    const { error } = await admin
      .from("tool_authorized_sessions")
      .update({
        status: "revoked",
        updated_by: context.userId,
        updated_at: now,
      })
      .eq("tool_slug", TOOL_SLUG);
    if (error) throw new Error(error.message);

    const { error: revokeProxyError } = await admin
      .from("chatgpt_proxy_sessions")
      .update({ status: "revoked" })
      .in("status", ["issued", "active"]);
    if (revokeProxyError) throw new Error(revokeProxyError.message);

    await logAdminActivity(context, {
      action: "chatgpt.authorized_session_revoke",
      area: "tools",
      target_type: "tool_authorized_session",
      target_id: TOOL_SLUG,
      details: "Authorised ChatGPT session revoked; secret values were not logged; existing ChatGPT proxy sessions were revoked.",
    });

    return { ok: true, status: "revoked", updated_at: now };
  });
