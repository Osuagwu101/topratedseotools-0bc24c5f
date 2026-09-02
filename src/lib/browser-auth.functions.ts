/*
 * Browser-based one-click authentication — server functions.
 *
 * Admin functions manage provider configuration without exposing API keys.
 * Customer launch verifies a successful, unexpired paid order, resolves that
 * order's assigned credentials server-side, performs the login in a remote
 * browser, and returns only the provider's signed interactive Live View URL.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { logAdminActivity } from "@/lib/admin-audit.server";
import {
  browserAuthSecretNames,
  configuredBrowserSecrets,
  launchBrowserUse,
  launchCloudflare,
  testBrowserProvider,
  type BrowserAuthProvider,
} from "@/lib/browser-auth.server";
import { LEGACY_CREDENTIAL_CUTOFF_ISO } from "@/lib/access.functions";

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
  const { data, error } = await ctx.supabase.rpc("is_super_admin", { _user_id: ctx.userId });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Only a Super Admin can change browser authentication settings.");
  return admin;
}

const providerSchema = z.enum(["browser_use", "cloudflare"]);

export const adminGetBrowserAuthSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const admin = await assertAdmin(context);
    const { data: row } = await admin
      .from("browser_auth_settings")
      .select("enabled, default_provider, session_timeout_minutes, updated_at")
      .eq("id", true)
      .maybeSingle();

    const providers = await Promise.all(
      (["browser_use", "cloudflare"] as BrowserAuthProvider[]).map(async (provider) => {
        const configured = await configuredBrowserSecrets(admin, provider);
        const required = browserAuthSecretNames(provider);
        return {
          provider,
          display_name: provider === "browser_use" ? "Browser Use" : "Cloudflare Browser Run",
          configured_secrets: configured,
          missing_secrets: required.filter((n) => !configured.includes(n)),
          configured: required.every((n) => configured.includes(n)),
        };
      }),
    );
    const { data: isSuper } = await context.supabase.rpc("is_super_admin", {
      _user_id: context.userId,
    });
    return {
      settings: {
        enabled: !!row?.enabled,
        default_provider: (row?.default_provider ?? "browser_use") as BrowserAuthProvider,
        session_timeout_minutes: Number(row?.session_timeout_minutes ?? 30),
        updated_at: row?.updated_at ?? null,
      },
      providers,
      is_super_admin: !!isSuper,
    };
  });

export const adminUpdateBrowserAuthSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        enabled: z.boolean(),
        default_provider: providerSchema,
        session_timeout_minutes: z.number().int().min(5).max(60),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const admin = await assertSuperAdmin(context);
    const { error } = await admin.from("browser_auth_settings").upsert(
      {
        id: true,
        enabled: data.enabled,
        default_provider: data.default_provider,
        session_timeout_minutes: data.session_timeout_minutes,
        updated_by: context.userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );
    if (error) throw new Error(error.message);
    await logAdminActivity(context, {
      action: "browser_auth.settings_update",
      area: "api_keys",
      target_type: "browser_auth",
      target_id: data.default_provider,
      details: `enabled=${data.enabled} timeout=${data.session_timeout_minutes}m`,
    });
    return { ok: true };
  });

export const adminSaveBrowserAuthSecrets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        provider: providerSchema,
        secrets: z.record(z.string(), z.string().min(1).max(1000)),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const admin = await assertSuperAdmin(context);
    const allowed = new Set(browserAuthSecretNames(data.provider));
    const rows: { name: string; value: string; updated_at: string }[] = [];
    for (const [name, raw] of Object.entries(data.secrets)) {
      if (!allowed.has(name)) throw new Error(`Unexpected browser credential field: ${name}`);
      const value = raw.trim();
      if (!value) continue;
      rows.push({ name, value, updated_at: new Date().toISOString() });
    }
    if (!rows.length) throw new Error("Enter at least one credential.");
    const { error } = await admin.from("internal_secrets").upsert(rows, { onConflict: "name" });
    if (error) throw new Error(error.message);
    const test = await testBrowserProvider(admin, data.provider);
    await logAdminActivity(context, {
      action: "browser_auth.secrets_update",
      area: "api_keys",
      target_type: "browser_auth_provider",
      target_id: data.provider,
      success: test.ok,
      details: `${rows.map((r) => r.name).join(", ")} · ${test.message}`,
    });
    return { saved: rows.map((r) => r.name), ...test };
  });

export const adminTestBrowserAuthProvider = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ provider: providerSchema }).parse(input))
  .handler(async ({ data, context }) => {
    const admin = await assertAdmin(context);
    const result = await testBrowserProvider(admin, data.provider);
    await logAdminActivity(context, {
      action: "browser_auth.connection_test",
      area: "api_keys",
      target_type: "browser_auth_provider",
      target_id: data.provider,
      success: result.ok,
      details: result.message,
    });
    return result;
  });

function validProvider(raw: unknown): BrowserAuthProvider | null {
  return raw === "browser_use" || raw === "cloudflare" ? raw : null;
}

function isUnexpired(expiresAt: string | null | undefined) {
  return !expiresAt || new Date(expiresAt).getTime() > Date.now();
}

async function resolvePaidOrderAndCredentials(admin: any, userId: string, toolSlug: string) {
  const { data: rows, error } = await admin
    .from("tool_orders")
    .select(
      "id, user_id, tool_slug, status, payment_status, access_type, fulfilment_status, expires_at, created_at",
    )
    .eq("user_id", userId)
    .eq("tool_slug", toolSlug)
    .eq("status", "approved")
    .eq("payment_status", "successful")
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw new Error(error.message);
  const order = (rows ?? []).find((o: any) => {
    if (!isUnexpired(o.expires_at)) return false;
    if (o.access_type === "private" && o.fulfilment_status !== "active") return false;
    return true;
  });
  if (!order) throw new Error("A successful active subscription is required for One-Click Login.");

  const { data: assignment } = await admin
    .from("tool_account_assignments")
    .select("account_id")
    .eq("order_id", order.id)
    .eq("status", "active")
    .maybeSingle();

  let credentials: any = null;
  if (assignment?.account_id) {
    const { data: account } = await admin
      .from("tool_accounts")
      .select(
        "id, login_email, login_password, login_url, login_notes, enabled, status, expires_at",
      )
      .eq("id", assignment.account_id)
      .maybeSingle();
    if (account?.enabled && account.status === "working" && isUnexpired(account.expires_at)) {
      credentials = account;
    }
  }

  // Legacy shared access remains valid only for subscriptions created before
  // the account-pool migration cutoff.
  if (
    !credentials &&
    order.access_type !== "private" &&
    order.created_at < LEGACY_CREDENTIAL_CUTOFF_ISO
  ) {
    const { data: legacy } = await admin
      .from("tool_credentials")
      .select("login_email, login_password, login_url, login_notes")
      .eq("tool_slug", toolSlug)
      .maybeSingle();
    credentials = legacy ?? null;
  }

  const username = String(credentials?.login_email ?? "").trim();
  const password = String(credentials?.login_password ?? "").trim();
  if (!username || !password) {
    throw new Error(
      "Login credentials are not active yet. Contact Admin on WhatsApp to complete access.",
    );
  }
  return { order, credentials, username, password };
}

export const startOneClickAuth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ tool_slug: z.string().min(1).max(120) }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");

    const { data: global } = await admin
      .from("browser_auth_settings")
      .select("enabled, default_provider, session_timeout_minutes")
      .eq("id", true)
      .maybeSingle();
    if (!global?.enabled) throw new Error("One-Click Login is not enabled yet. Contact Admin.");

    const { data: toolSetting } = await admin
      .from("tool_settings")
      .select("enabled, one_click_auth_enabled, official_login_url, auth_provider")
      .eq("tool_slug", data.tool_slug)
      .maybeSingle();
    if (toolSetting?.enabled === false || !toolSetting?.one_click_auth_enabled) {
      throw new Error("One-Click Login is not enabled for this tool.");
    }

    const provider =
      validProvider(toolSetting.auth_provider) ??
      validProvider(global.default_provider) ??
      "browser_use";
    const timeoutMinutes = Math.max(5, Math.min(60, Number(global.session_timeout_minutes ?? 30)));

    const fiveMinutesAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    const { count } = await admin
      .from("browser_auth_sessions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", context.userId)
      .gte("created_at", fiveMinutesAgo);
    if ((count ?? 0) >= 3) {
      throw new Error(
        "Too many One-Click Login attempts. Please wait a few minutes and try again.",
      );
    }

    const resolved = await resolvePaidOrderAndCredentials(admin, context.userId, data.tool_slug);
    const loginUrlRaw = String(
      resolved.credentials?.login_url ?? toolSetting.official_login_url ?? "",
    ).trim();
    if (!loginUrlRaw) throw new Error("The login URL is not configured yet. Contact Admin.");
    let loginUrl: URL;
    try {
      loginUrl = new URL(loginUrlRaw);
    } catch {
      throw new Error("The configured login URL is invalid. Contact Admin.");
    }
    if (loginUrl.protocol !== "https:") throw new Error("The configured login URL must use HTTPS.");

    const { data: auditRow, error: insertError } = await admin
      .from("browser_auth_sessions")
      .insert({
        user_id: context.userId,
        order_id: resolved.order.id,
        tool_slug: data.tool_slug,
        provider,
        status: "starting",
        expires_at: new Date(Date.now() + timeoutMinutes * 60_000).toISOString(),
      })
      .select("id")
      .single();
    if (insertError) throw new Error("Could not start One-Click Login. Please try again.");

    try {
      // Try to load captured session from a previous admin OTP login
      let capturedCookies: Array<{ name: string; value: string }> | undefined;
      const { data: existingSession } = await admin
        .from("tool_account_sessions")
        .select("authenticated_cookies, verification_status, expires_at, created_by")
        .eq("account_id", (resolved as any).credentials?.id || "")
        .eq("provider", provider)
        .eq("verification_status", "active")
        .maybeSingle();

      if (
        existingSession?.authenticated_cookies &&
        existingSession?.verification_status === "active"
      ) {
        const sessionExpiry = existingSession.expires_at
          ? new Date(existingSession.expires_at).getTime()
          : Number.NaN;

        if (!Number.isFinite(sessionExpiry) || sessionExpiry <= Date.now()) {
          // Session has expired - deny access and notify admin
          await admin.from("browser_auth_otp_audit").insert({
            session_id: auditRow.id,
            event: "session_expired_on_reuse",
            otp_type: "session_reuse",
            error_message: "Captured session expired",
            submitted_by: existingSession.created_by,
          });

          throw new Error(
            "The admin's captured session has expired. Please contact the administrator to re-authenticate and capture a new session.",
          );
        }

        // Session still valid, use captured cookies
        if (!Array.isArray(existingSession.authenticated_cookies)) {
          throw new Error(
            "The admin's captured session is invalid. Please contact the administrator to re-authenticate and capture a new session.",
          );
        }

        capturedCookies = existingSession.authenticated_cookies.slice(0, 10).flatMap((cookie) => {
          if (
            typeof cookie !== "object" ||
            cookie === null ||
            Array.isArray(cookie) ||
            typeof cookie.name !== "string" ||
            typeof cookie.value !== "string"
          ) {
            return [];
          }
          return [{ name: cookie.name, value: cookie.value }];
        });
      }

      const launched =
        provider === "cloudflare"
          ? await launchCloudflare(admin, {
              loginUrl: loginUrl.toString(),
              username: resolved.username,
              password: resolved.password,
              timeoutMinutes,
              capturedCookies,
            })
          : await launchBrowserUse(admin, {
              loginUrl: loginUrl.toString(),
              username: resolved.username,
              password: resolved.password,
              timeoutMinutes,
              capturedCookies,
            });

      if (!launched.automationSubmitted) {
        await admin
          .from("browser_auth_sessions")
          .update({
            status: "failed",
            provider_session_id: launched.providerSessionId,
            error_code: "login_form_not_submitted",
            updated_at: new Date().toISOString(),
          })
          .eq("id", auditRow.id);
        throw new Error("Automatic login could not be completed for this tool. Contact Admin.");
      }

      // Check if OTP/2FA is required
      if (launched.otp_status?.detected) {
        // Audit OTP detection
        await admin.from("browser_auth_otp_audit").insert({
          session_id: auditRow.id,
          account_id: null,
          event: "otp_detected",
          otp_type: launched.otp_status.type || "unknown",
          submitted_by: context.userId,
        });

        await admin
          .from("browser_auth_sessions")
          .update({
            status: "awaiting_otp",
            provider_session_id: launched.providerSessionId,
            otp_context: {
              detected_type: launched.otp_status.type || "unknown",
              detected_at: new Date().toISOString(),
              field_selector: launched.otp_status.field_selector,
              attempt_count: 0,
              account_id: (resolved as any).credentials?.id ?? null,
            },
            expires_at: launched.expiresAt,
            updated_at: new Date().toISOString(),
          })
          .eq("id", auditRow.id);

        return {
          ok: false,
          status: "awaiting_otp",
          session_id: auditRow.id,
          otp_type: launched.otp_status.type || "unknown",
          message: `${launched.otp_status.type || "OTP"} verification required. Please enter the code.`,
          expires_at: launched.expiresAt,
        };
      }

      await admin
        .from("browser_auth_sessions")
        .update({
          status: "ready",
          provider_session_id: launched.providerSessionId,
          expires_at: launched.expiresAt,
          updated_at: new Date().toISOString(),
        })
        .eq("id", auditRow.id);

      // Best-effort usage record; no secret/session URL is stored here.
      await admin.from("tool_usage").insert({ tool_slug: data.tool_slug, user_id: context.userId });

      return {
        ok: true,
        provider: launched.provider,
        launch_url: launched.liveUrl,
        expires_at: launched.expiresAt,
      };
    } catch (err) {
      await admin
        .from("browser_auth_sessions")
        .update({
          status: "failed",
          error_code: err instanceof Error ? err.message.slice(0, 120) : "launch_failed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", auditRow.id);
      throw err instanceof Error ? err : new Error("One-Click Login failed. Please try again.");
    }
  });
