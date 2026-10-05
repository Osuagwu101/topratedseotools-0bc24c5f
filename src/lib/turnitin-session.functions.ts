/*
 * Admin-only Originality Reports authorised-session management for Turnitin.
 * Session values are never returned after storage.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { logAdminActivity } from "@/lib/admin-audit.server";
import {
  encryptOriginalitySession,
  normaliseOriginalitySession,
  parseOriginalitySession,
} from "@/lib/turnitin-originality-session.server";
import {
  testStoredOriginalitySession,
  validateOriginalitySessionState,
} from "@/lib/turnitin-originality.server";

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
      "Only a Super Admin can replace the Originality Reports authorised session.",
    );
  }
  return admin;
}

export const adminGetTurnitinOriginalitySessionStatus = createServerFn({
  method: "GET",
})
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const admin = await assertAdmin(context);
    const { data: row, error } = await admin
      .from("turnitin_originality_authorized_session")
      .select("id, status, session_format, updated_at")
      .eq("id", "primary")
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
      session_format: row?.session_format ?? "originality_cookie_json",
      updated_at: row?.updated_at ?? null,
      can_manage: !!isSuper,
    };
  });

const saveInput = z.object({
  session_data: z.string().min(2).max(200000),
});

export const adminSaveTurnitinOriginalitySession = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => saveInput.parse(input))
  .handler(async ({ data, context }) => {
    const admin = await assertSuperAdmin(context);

    const normalised = normaliseOriginalitySession(data.session_data);
    const parsed = parseOriginalitySession(normalised);

    // Validate from the application server before storing. This proves the
    // direct no-browser-engine path can reach the authenticated dashboard.
    const validated = await validateOriginalitySessionState(parsed);
    const encrypted = encryptOriginalitySession(
      JSON.stringify(validated.sessionState),
    );
    const now = new Date().toISOString();

    const { error } = await admin
      .from("turnitin_originality_authorized_session")
      .upsert(
        {
          id: "primary",
          encrypted_payload: encrypted,
          session_format: "originality_cookie_json",
          status: "stored",
          updated_by: context.userId,
          updated_at: now,
        },
        { onConflict: "id" },
      );
    if (error) throw new Error(error.message);

    await logAdminActivity(context, {
      action: "turnitin.originality_session_replace",
      area: "tools",
      target_type: "tool_authorized_session",
      target_id: "turnitin",
      details:
        "Originality Reports authorised session validated and replaced; secret values were not logged.",
    });

    return {
      ok: true,
      status: "stored",
      updated_at: now,
      available_slots: validated.availableSlots,
    };
  });

export const adminTestTurnitinOriginalitySession = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const admin = await assertAdmin(context);
    const result = await testStoredOriginalitySession(admin);
    return {
      ok: true,
      available_slots: result.availableSlots,
    };
  });

export const adminRevokeTurnitinOriginalitySession = createServerFn({
  method: "POST",
})
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const admin = await assertSuperAdmin(context);
    const now = new Date().toISOString();
    const { data: row, error } = await admin
      .from("turnitin_originality_authorized_session")
      .update({
        status: "revoked",
        updated_by: context.userId,
        updated_at: now,
      })
      .eq("id", "primary")
      .select("id")
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!row) throw new Error("No stored Originality Reports session was found.");

    await logAdminActivity(context, {
      action: "turnitin.originality_session_revoke",
      area: "tools",
      target_type: "tool_authorized_session",
      target_id: TOOL_SLUG,
      details:
        "Originality Reports authorised session revoked; secret values were not logged.",
    });

    return { ok: true, status: "revoked", updated_at: now };
  });
