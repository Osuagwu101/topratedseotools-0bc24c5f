/* Admin-only proactive authentication/refresh for shared tool accounts. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { launchBrowserUse, launchCloudflare, reconnectBrowserUseSession, reconnectCloudflareSession, type BrowserAuthProvider } from "@/lib/browser-auth.server";
import { captureSessionStateThroughCdp } from "@/lib/browser-auth-otp.server";
import { attachBrowserUsePage, waitForAuthOrOtp } from "@/lib/browser-auth-session.server";

function validProvider(v: unknown): BrowserAuthProvider | null { return v === "browser_use" || v === "cloudflare" ? v : null; }

export const adminRefreshAccountAuthentication = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ account_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const isAdmin = await (admin as any).rpc("has_role", { _user_id: context.userId, _role: "admin" }).then((r: any) => r.data);
    if (!isAdmin) throw new Error("Only admins can refresh tool authentication.");

    const { data: account, error: accountError } = await (admin as any).from("tool_accounts")
      .select("id, tool_slug, login_email, login_password, login_url, enabled, status")
      .eq("id", data.account_id).maybeSingle();
    if (accountError) throw new Error("Could not load the tool account for authentication.");
    if (!account?.enabled) throw new Error("This tool account is disabled.");
    const username = String(account.login_email ?? "").trim();
    const password = String(account.login_password ?? "").trim();
    if (!username || !password) throw new Error("Configure the account email and password first.");

    const { data: global } = await (admin as any).from("browser_auth_settings")
      .select("enabled, default_provider, session_timeout_minutes").eq("id", true).maybeSingle();
    if (!global?.enabled) throw new Error("One-Click Login is disabled in Browser Auth settings.");
    const { data: toolSetting } = await (admin as any).from("tool_settings")
      .select("official_login_url, auth_provider").eq("tool_slug", account.tool_slug).maybeSingle();
    const provider = validProvider(toolSetting?.auth_provider) ?? validProvider(global.default_provider) ?? "browser_use";
    const timeoutMinutes = Math.max(5, Math.min(60, Number(global.session_timeout_minutes ?? 30)));
    const loginUrl = String(account.login_url ?? toolSetting?.official_login_url ?? "").trim();
    try {
      if (!loginUrl || new URL(loginUrl).protocol !== "https:") throw new Error();
    } catch {
      throw new Error("Configure a valid HTTPS login URL first.");
    }

    const { data: row, error: rowError } = await (admin as any).from("browser_auth_sessions").insert({
      user_id: context.userId, order_id: null, tool_slug: account.tool_slug, provider, status: "starting",
      otp_context: { account_id: account.id, purpose: "admin_refresh", attempt_count: 0 },
      expires_at: new Date(Date.now() + timeoutMinutes * 60000).toISOString(),
    }).select("id").single();
    if (rowError) throw new Error("Could not start the admin authentication session.");

    await (admin as any).from("browser_auth_otp_audit").insert({ session_id: row.id, account_id: account.id, event: "admin_refresh_started", otp_type: "admin_refresh", submitted_by: context.userId });

    const markAwaitingOtp = async (
      providerSessionId: string,
      expiresAt: string,
      type?: string,
      fieldSelector?: string,
    ) => {
      const detectedType = type || "unknown";
      const { error: otpStateError } = await (admin as any)
        .from("browser_auth_sessions")
        .update({
          status: "awaiting_otp",
          provider_session_id: providerSessionId,
          otp_context: {
            account_id: account.id,
            purpose: "admin_refresh",
            detected_type: detectedType,
            detected_at: new Date().toISOString(),
            field_selector: fieldSelector,
            attempt_count: 0,
          },
          expires_at: expiresAt,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      if (otpStateError) {
        throw new Error("Phrasly requested OTP, but the verification session could not be saved.");
      }

      await (admin as any).from("browser_auth_otp_audit").insert({
        session_id: row.id,
        account_id: account.id,
        event: "admin_refresh_otp_required",
        otp_type: detectedType,
        submitted_by: context.userId,
      });
      return { status: "awaiting_otp" as const, session_id: row.id, expires_at: expiresAt };
    };

    try {
      const launched = provider === "cloudflare"
        ? await launchCloudflare(admin, { loginUrl, username, password, timeoutMinutes })
        : await launchBrowserUse(admin, { loginUrl, username, password, timeoutMinutes });

      if (launched.otp_status?.detected) {
        return await markAwaitingOtp(
          launched.providerSessionId,
          launched.expiresAt,
          launched.otp_status.type,
          launched.otp_status.field_selector,
        );
      }

      const cdp = provider === "cloudflare"
        ? await reconnectCloudflareSession(admin, launched.providerSessionId)
        : await reconnectBrowserUseSession(admin, launched.providerSessionId);
      if (!cdp) throw new Error("Login completed but the authenticated browser could not be reconnected for capture.");
      try {
        const pageSessionId = provider === "browser_use" ? await attachBrowserUsePage(cdp) : undefined;
        const outcome = await waitForAuthOrOtp(cdp, pageSessionId, 15_000);
        if (outcome.status === "otp") {
          return await markAwaitingOtp(
            launched.providerSessionId,
            launched.expiresAt,
            outcome.type,
            outcome.fieldSelector,
          );
        }
        if (outcome.status !== "authenticated") {
          throw new Error("Phrasly login was not confirmed. Authentication state was not saved.");
        }

        const state = await captureSessionStateThroughCdp(cdp, pageSessionId);
        if (!state.authenticated_cookies.length) {
          throw new Error("Phrasly authenticated but no reusable session cookies were captured.");
        }
        const { error: saveError } = await (admin as any).from("tool_account_sessions").upsert({
          account_id: account.id,
          provider,
          provider_session_id: launched.providerSessionId,
          authenticated_cookies: state.authenticated_cookies,
          session_tokens: state.session_tokens,
          auth_headers: state.auth_headers,
          last_verified_at: new Date().toISOString(),
          verification_status: "active",
          expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
          created_by: context.userId,
        }, { onConflict: "account_id,provider" });
        if (saveError) {
          throw new Error("Phrasly authenticated successfully, but the reusable session could not be saved.");
        }
      } finally { cdp.close(); }

      const { error: readyError } = await (admin as any)
        .from("browser_auth_sessions")
        .update({
          status: "ready",
          provider_session_id: launched.providerSessionId,
          expires_at: launched.expiresAt,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      if (readyError) {
        await (admin as any)
          .from("tool_account_sessions")
          .update({ verification_status: "invalid" })
          .eq("account_id", account.id)
          .eq("provider", provider);
        throw new Error("Phrasly authenticated state was saved, but the admin session could not transition to ready.");
      }

      await (admin as any).from("browser_auth_otp_audit").insert({
        session_id: row.id,
        account_id: account.id,
        event: "admin_refresh_succeeded",
        otp_type: "admin_refresh",
        submitted_by: context.userId,
      });
      return { status: "ready" as const, session_id: row.id, expires_at: launched.expiresAt };
    } catch (e) {
      await (admin as any).from("browser_auth_sessions").update({ status: "failed", error_code: e instanceof Error ? e.message.slice(0, 120) : "admin_refresh_failed", updated_at: new Date().toISOString() }).eq("id", row.id);
      throw e;
    }
  });
