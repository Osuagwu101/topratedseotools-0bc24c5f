/*
 * Claude authorised-session vault — admin only.
 *
 * - Super Admin can paste/replace/revoke the shared Claude login (cookies)
 * - values are normalised and AES-256-GCM encrypted before storage
 * - the Admin UI receives metadata only; decrypted state is never returned
 * - replacing the session disables launch until verification is repeated
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { logAdminActivity } from "@/lib/admin-audit.server";
import { encryptClaudeSession, normaliseClaudeSession } from "@/lib/claude-session.server";

const TOOL_SLUG = "claude";
export const CLAUDE_SESSION_FORMAT = "claude_session_state_json_v2";

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
    throw new Error("Only a Super Admin can replace or revoke the Claude authorised session.");
  }
  return admin;
}

async function setClaudeOneClickEnabled(admin: any, enabled: boolean) {
  const { error } = await admin
    .from("tool_settings")
    .update({ one_click_auth_enabled: enabled })
    .eq("tool_slug", TOOL_SLUG);
  if (error) throw new Error(error.message);
}

export const adminGetClaudeSessionStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const admin = await assertAdmin(context);
    const { data: row, error } = await admin
      .from("tool_authorized_sessions")
      .select("tool_slug, status, session_format, updated_at")
      .eq("tool_slug", TOOL_SLUG)
      .maybeSingle();
    if (error) throw new Error(error.message);

    const { data: isSuper, error: superError } = await context.supabase.rpc("is_super_admin", {
      _user_id: context.userId,
    });
    if (superError) throw new Error(superError.message);

    return {
      configured: row?.status === "stored",
      status: row?.status ?? "not_configured",
      session_format: row?.session_format ?? CLAUDE_SESSION_FORMAT,
      updated_at: row?.updated_at ?? null,
      can_manage: !!isSuper,
    };
  });

const saveInput = z.object({
  session_data: z.string().min(2).max(500000),
});

export const adminSaveClaudeSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => saveInput.parse(input))
  .handler(async ({ data, context }) => {
    const admin = await assertSuperAdmin(context);
    const normalised = normaliseClaudeSession(data.session_data);
    const encrypted = encryptClaudeSession(normalised);
    const now = new Date().toISOString();

    const { error } = await admin.from("tool_authorized_sessions").upsert(
      {
        tool_slug: TOOL_SLUG,
        encrypted_payload: encrypted,
        session_format: CLAUDE_SESSION_FORMAT,
        status: "stored",
        updated_by: context.userId,
        updated_at: now,
      },
      { onConflict: "tool_slug" },
    );
    if (error) throw new Error(error.message);

    // Keep launch disabled until the authenticated proxy has passed verification.
    await setClaudeOneClickEnabled(admin, false);
    const { error: revokeError } = await admin
      .from("claude_proxy_sessions")
      .update({ status: "revoked" })
      .in("status", ["issued", "active"]);
    if (revokeError) throw new Error("Could not revoke existing Claude launches.");

    await logAdminActivity(context, {
      action: "claude.authorized_session_replace",
      area: "tools",
      target_type: "tool_authorized_session",
      target_id: TOOL_SLUG,
      details: "Authorised Claude session replaced; cookie/storage values were not logged.",
    });

    return { ok: true, status: "stored", updated_at: now };
  });

export const adminRevokeClaudeSession = createServerFn({ method: "POST" })
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
      await setClaudeOneClickEnabled(admin, false);
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

    const { error: revokeError } = await admin
      .from("claude_proxy_sessions")
      .update({ status: "revoked" })
      .in("status", ["issued", "active"]);
    if (revokeError) throw new Error("Could not revoke existing Claude launches.");
    await setClaudeOneClickEnabled(admin, false);

    await logAdminActivity(context, {
      action: "claude.authorized_session_revoke",
      area: "tools",
      target_type: "tool_authorized_session",
      target_id: TOOL_SLUG,
      details: "Authorised Claude session revoked; secret values were not logged.",
    });

    return { ok: true, status: "revoked", updated_at: now };
  });

export const adminTestClaudeSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertSuperAdmin(context);
    const { testClaudeUpstream } = await import("@/lib/claude-proxy.server");
    return testClaudeUpstream();
  });
