/*
 * Non-payment admin tool grants.
 *
 * These grants are intentionally separate from payment/order records. They are
 * used for complimentary/lifetime access and are tied to an existing account
 * pool slot. Credentials stay server-side and are only injected into a remote
 * browser when One-Click Login starts.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  launchBrowserUse,
  launchCloudflare,
  type BrowserAuthProvider,
} from "@/lib/browser-auth.server";

function validProvider(raw: unknown): BrowserAuthProvider | null {
  return raw === "browser_use" || raw === "cloudflare" ? raw : null;
}

function isUnexpired(expiresAt: string | null | undefined) {
  return !expiresAt || new Date(expiresAt).getTime() > Date.now();
}

export interface GrantedToolAccess {
  grant_id: string;
  tool_slug: string;
  access_type: "shared" | "private";
  expires_at: string | null;
  granted_at: string;
}

/** Auth — current user's active complimentary/lifetime tool grants. */
export const getMyGrantedAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await (supabaseAdmin as any)
      .from("tool_access_grants")
      .select("id, tool_slug, access_type, expires_at, granted_at")
      .eq("user_id", context.userId)
      .eq("status", "active")
      .order("granted_at", { ascending: false });
    if (error) throw new Error(error.message);

    const grants = ((data ?? []) as any[])
      .filter((g) => isUnexpired(g.expires_at as string | null))
      .map((g) => ({
        grant_id: g.id as string,
        tool_slug: g.tool_slug as string,
        access_type: ((g.access_type as string) ?? "shared") as "shared" | "private",
        expires_at: (g.expires_at as string | null) ?? null,
        granted_at: g.granted_at as string,
      }));

    return { grants: grants as GrantedToolAccess[] };
  });

/**
 * Auth — start One-Click Login from an active admin grant.
 * This mirrors the normal paid-order launcher but authorizes against
 * tool_access_grants and its assigned account instead of payment state.
 */
export const startGrantedOneClickAuth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ tool_slug: z.string().min(1).max(120) }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");

    const { data: global } = await (admin as any)
      .from("browser_auth_settings")
      .select("enabled, default_provider, session_timeout_minutes")
      .eq("id", true)
      .maybeSingle();
    if (!global?.enabled) throw new Error("One-Click Login is not enabled yet. Contact Admin.");

    const { data: toolSetting } = await (admin as any)
      .from("tool_settings")
      .select("enabled, one_click_auth_enabled, official_login_url, auth_provider")
      .eq("tool_slug", data.tool_slug)
      .maybeSingle();
    if (toolSetting?.enabled === false || !toolSetting?.one_click_auth_enabled) {
      throw new Error("One-Click Login is not enabled for this tool.");
    }

    const { data: grantRows, error: grantError } = await (admin as any)
      .from("tool_access_grants")
      .select("id, account_id, access_type, expires_at, status")
      .eq("user_id", context.userId)
      .eq("tool_slug", data.tool_slug)
      .eq("status", "active")
      .order("granted_at", { ascending: false })
      .limit(10);
    if (grantError) throw new Error(grantError.message);
    const grant = ((grantRows ?? []) as any[]).find((g) => isUnexpired(g.expires_at));
    if (!grant) throw new Error("An active access grant is required for this tool.");

    const { data: account, error: accountError } = await (admin as any)
      .from("tool_accounts")
      .select("id, login_email, login_password, login_url, enabled, status, expires_at")
      .eq("id", grant.account_id)
      .maybeSingle();
    if (accountError) throw new Error(accountError.message);
    if (!account?.enabled || account.status !== "working" || !isUnexpired(account.expires_at)) {
      throw new Error("The assigned login account is not available. Contact Admin.");
    }

    const username = String(account.login_email ?? "").trim();
    const password = String(account.login_password ?? "").trim();
    if (!username || !password) {
      throw new Error("Login credentials are not active yet. Contact Admin.");
    }

    const loginUrlRaw = String(account.login_url ?? toolSetting.official_login_url ?? "").trim();
    if (!loginUrlRaw) throw new Error("The login URL is not configured yet. Contact Admin.");
    let loginUrl: URL;
    try {
      loginUrl = new URL(loginUrlRaw);
    } catch {
      throw new Error("The configured login URL is invalid. Contact Admin.");
    }
    if (loginUrl.protocol !== "https:") throw new Error("The configured login URL must use HTTPS.");

    const provider =
      validProvider(toolSetting.auth_provider) ??
      validProvider(global.default_provider) ??
      "browser_use";
    const timeoutMinutes = Math.max(5, Math.min(60, Number(global.session_timeout_minutes ?? 30)));

    const fiveMinutesAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    const { count } = await (admin as any)
      .from("browser_auth_sessions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", context.userId)
      .gte("created_at", fiveMinutesAgo);
    if ((count ?? 0) >= 3) {
      throw new Error(
        "Too many One-Click Login attempts. Please wait a few minutes and try again.",
      );
    }

    const { data: auditRow, error: insertError } = await (admin as any)
      .from("browser_auth_sessions")
      .insert({
        user_id: context.userId,
        order_id: null,
        grant_id: grant.id,
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
      const { data: existingSession } = await (admin as any)
        .from("tool_account_sessions")
        .select("authenticated_cookies, verification_status, expires_at, created_by")
        .eq("account_id", account.id)
        .eq("provider", provider)
        .eq("verification_status", "active")
        .maybeSingle();

      if (
        existingSession?.authenticated_cookies &&
        existingSession?.verification_status === "active"
      ) {
        const sessionExpiry = new Date(existingSession.expires_at).getTime();

        if (sessionExpiry <= Date.now()) {
          // Session has expired - deny access and notify admin
          await (admin as any).from("browser_auth_otp_audit").insert({
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
        capturedCookies = existingSession.authenticated_cookies
          .slice(0, 10)
          .map((c: any) => ({ name: c.name, value: c.value }));
      }

      const launched =
        provider === "cloudflare"
          ? await launchCloudflare(admin, {
              loginUrl: loginUrl.toString(),
              username,
              password,
              timeoutMinutes,
              capturedCookies,
            })
          : await launchBrowserUse(admin, {
              loginUrl: loginUrl.toString(),
              username,
              password,
              timeoutMinutes,
              capturedCookies,
            });

      if (!launched.automationSubmitted) {
        await (admin as any)
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
      if ((launched as any).otp_status?.detected) {
        // Audit OTP detection
        await (admin as any).from("browser_auth_otp_audit").insert({
          session_id: auditRow.id,
          account_id: null,
          event: "otp_detected",
          otp_type: (launched as any).otp_status.type || "unknown",
          submitted_by: context.userId,
        });

        await (admin as any)
          .from("browser_auth_sessions")
          .update({
            status: "awaiting_otp",
            provider_session_id: launched.providerSessionId,
            otp_context: {
              detected_type: (launched as any).otp_status.type || "unknown",
              detected_at: new Date().toISOString(),
              field_selector: (launched as any).otp_status.field_selector,
              attempt_count: 0,
              account_id: account.id,
            },
            expires_at: launched.expiresAt,
            updated_at: new Date().toISOString(),
          })
          .eq("id", auditRow.id);

        return {
          ok: false,
          status: "awaiting_otp",
          session_id: auditRow.id,
          otp_type: (launched as any).otp_status.type || "unknown",
          message: `${(launched as any).otp_status.type || "OTP"} verification required. Please enter the code.`,
          expires_at: launched.expiresAt,
        };
      }

      await (admin as any)
        .from("browser_auth_sessions")
        .update({
          status: "ready",
          provider_session_id: launched.providerSessionId,
          expires_at: launched.expiresAt,
          updated_at: new Date().toISOString(),
        })
        .eq("id", auditRow.id);

      await (admin as any)
        .from("tool_usage")
        .insert({ tool_slug: data.tool_slug, user_id: context.userId });

      return {
        ok: true,
        provider: launched.provider,
        launch_url: launched.liveUrl,
        expires_at: launched.expiresAt,
      };
    } catch (err) {
      await (admin as any)
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
