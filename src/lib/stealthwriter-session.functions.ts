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

const TOOL_SLUG = "stealthwriter";
const REQUIRED_KEYS = [
  "__Secure-better-auth.session_token",
  "__Secure-better-auth.session_data",
] as const;

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
    throw new Error("Only a Super Admin can replace the StealthWriter authorised session.");
  }
  return admin;
}

export function normaliseStealthWriterSession(raw: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Paste the StealthWriter session as the two-cookie JSON object shown in the admin guide.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("The StealthWriter session must be a JSON object.");
  }

  const source = parsed as Record<string, unknown>;
  const clean: Record<string, string> = {};
  for (const key of REQUIRED_KEYS) {
    const value = source[key];
    if (typeof value !== "string" || value.length < 1 || value.length > 32000) {
      throw new Error(`Missing or invalid session value for ${key}.`);
    }
    if (/PASTE_(TOKEN|DATA)_VALUE_HERE/i.test(value)) {
      throw new Error("Replace the placeholder values with the authorised StealthWriter session values first.");
    }
    clean[key] = value;
  }
  return JSON.stringify(clean);
}

function sessionEncryptionKey(): Buffer {
  const raw = String(process.env.STEALTHWRITER_SESSION_ENCRYPTION_KEY ?? "").trim();
  if (!raw) {
    throw new Error("StealthWriter session encryption is not configured on the server.");
  }

  const key = /^[0-9a-f]{64}$/i.test(raw)
    ? Buffer.from(raw, "hex")
    : Buffer.from(raw, "base64");

  if (key.length !== 32) {
    throw new Error("StealthWriter session encryption key must decode to exactly 32 bytes.");
  }
  return key;
}

async function encryptSession(plaintext: string): Promise<string> {
  const { createCipheriv, randomBytes } = await import("node:crypto");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", sessionEncryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    v: 1,
    alg: "A256GCM",
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ct: ciphertext.toString("base64"),
  });
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
      configured: !!row,
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
    const encrypted = await encryptSession(normalised);
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
