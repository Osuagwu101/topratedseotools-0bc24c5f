/* Admin-only proactive authentication/refresh for shared tool accounts. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  closeRemoteBrowserSession,
  launchBrowserUse,
  launchBrowserUseInteractive,
  launchCloudflare,
  launchCloudflareInteractive,
  reconnectBrowserUseSession,
  reconnectCloudflareSession,
  type BrowserAuthProvider,
} from "@/lib/browser-auth.server";
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
      .select("id, tool_slug, login_email, login_password, login_url, enabled, status, expires_at")
      .eq("id", data.account_id).maybeSingle();
    if (accountError) throw new Error("Could not load the tool account for authentication.");
    if (!account?.enabled || account.status !== "working") {
      throw new Error("This tool account is not active.");
    }
    if (account.expires_at && new Date(account.expires_at).getTime() <= Date.now()) {
      throw new Error("This tool account has expired.");
    }
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

    let launched: any = null;
    try {
      launched = provider === "cloudflare"
        ? await launchCloudflare(admin, { loginUrl, username, password, timeoutMinutes })
        : await launchBrowserUse(admin, { loginUrl, username, password, timeoutMinutes });

      await (admin as any)
        .from("browser_auth_sessions")
        .update({
          provider_session_id: launched.providerSessionId,
          expires_at: launched.expiresAt,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);

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
        const pageSessionId =
          provider === "browser_use"
            ? await attachBrowserUsePage(cdp, loginUrl)
            : undefined;
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
          if (outcome.status === "timeout" && outcome.humanVerification) {
            throw new Error(
              "Phrasly requires an interactive human-verification step before login can continue.",
            );
          }
          if (
            outcome.status === "timeout" &&
            outcome.onLoginPage &&
            outcome.hasError
          ) {
            throw new Error(
              "Phrasly rejected the account login. Check the saved email and password.",
            );
          }
          if (outcome.status === "timeout" && outcome.onLoginPage) {
            throw new Error(
              "Phrasly remained on the login page. Check the saved credentials and try again.",
            );
          }
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

      // No OTP is pending and reusable state is persisted, so close the
      // privileged admin browser rather than leaving it live until timeout.
      await closeRemoteBrowserSession(admin, provider, launched.providerSessionId);

      return { status: "ready" as const, session_id: row.id, expires_at: launched.expiresAt };
    } catch (e) {
      if (launched?.providerSessionId) {
        await closeRemoteBrowserSession(admin, provider, launched.providerSessionId);
      }
      await (admin as any)
        .from("browser_auth_sessions")
        .update({
          status: "failed",
          error_code:
            e instanceof Error ? e.message.slice(0, 120) : "admin_refresh_failed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      throw e;
    }
  });


export const adminStartManualAccountAuthentication = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ account_id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const isAdmin = await (admin as any)
      .rpc("has_role", { _user_id: context.userId, _role: "admin" })
      .then((r: any) => r.data);
    if (!isAdmin) throw new Error("Only admins can authenticate tool accounts.");

    const { data: account, error: accountError } = await (admin as any)
      .from("tool_accounts")
      .select("id, tool_slug, login_url, enabled, status, expires_at")
      .eq("id", data.account_id)
      .maybeSingle();
    if (accountError) throw new Error("Could not load the tool account.");
    if (!account?.enabled || account.status !== "working") {
      throw new Error("This tool account is not active.");
    }
    if (account.expires_at && new Date(account.expires_at).getTime() <= Date.now()) {
      throw new Error("This tool account has expired.");
    }

    const { data: global } = await (admin as any)
      .from("browser_auth_settings")
      .select("enabled, default_provider, session_timeout_minutes")
      .eq("id", true)
      .maybeSingle();
    if (!global?.enabled) {
      throw new Error("One-Click Login is disabled in Browser Auth settings.");
    }

    const { data: toolSetting } = await (admin as any)
      .from("tool_settings")
      .select("official_login_url, auth_provider")
      .eq("tool_slug", account.tool_slug)
      .maybeSingle();

    const provider =
      validProvider(toolSetting?.auth_provider) ??
      validProvider(global.default_provider) ??
      "browser_use";
    const timeoutMinutes = Math.max(
      5,
      Math.min(60, Number(global.session_timeout_minutes ?? 30)),
    );
    const loginUrl = String(
      account.login_url ?? toolSetting?.official_login_url ?? "",
    ).trim();
    try {
      if (!loginUrl || new URL(loginUrl).protocol !== "https:") throw new Error();
    } catch {
      throw new Error("Configure a valid HTTPS login URL first.");
    }

    const { data: row, error: rowError } = await (admin as any)
      .from("browser_auth_sessions")
      .insert({
        user_id: context.userId,
        order_id: null,
        tool_slug: account.tool_slug,
        provider,
        status: "starting",
        otp_context: {
          account_id: account.id,
          purpose: "admin_manual_refresh",
          attempt_count: 0,
        },
        expires_at: new Date(
          Date.now() + timeoutMinutes * 60_000,
        ).toISOString(),
      })
      .select("id")
      .single();
    if (rowError) {
      throw new Error("Could not start the manual authentication session.");
    }

    await (admin as any).from("browser_auth_otp_audit").insert({
      session_id: row.id,
      account_id: account.id,
      event: "admin_refresh_started",
      otp_type: "manual_handoff",
      submitted_by: context.userId,
    });

    let launched: any = null;
    try {
      launched =
        provider === "cloudflare"
          ? await launchCloudflareInteractive(admin, {
              loginUrl,
              timeoutMinutes,
            })
          : await launchBrowserUseInteractive(admin, {
              loginUrl,
              timeoutMinutes,
            });

      const { error: updateError } = await (admin as any)
        .from("browser_auth_sessions")
        .update({
          provider_session_id: launched.providerSessionId,
          expires_at: launched.expiresAt,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      if (updateError) {
        await closeRemoteBrowserSession(
          admin,
          provider,
          launched.providerSessionId,
        );
        throw new Error("The manual authentication browser could not be saved.");
      }

      return {
        status: "manual_login" as const,
        session_id: row.id,
        launch_url: launched.liveUrl,
        expires_at: launched.expiresAt,
      };
    } catch (error) {
      await (admin as any)
        .from("browser_auth_sessions")
        .update({
          status: "failed",
          error_code:
            error instanceof Error
              ? error.message.slice(0, 120)
              : "manual_auth_start_failed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      throw error;
    }
  });

export const adminCompleteManualAccountAuthentication = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ session_id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const isAdmin = await (admin as any)
      .rpc("has_role", { _user_id: context.userId, _role: "admin" })
      .then((r: any) => r.data);
    if (!isAdmin) throw new Error("Only admins can complete tool authentication.");

    const { data: session, error: sessionError } = await (admin as any)
      .from("browser_auth_sessions")
      .select(
        "id, tool_slug, provider, provider_session_id, status, expires_at, otp_context",
      )
      .eq("id", data.session_id)
      .maybeSingle();
    if (sessionError) throw new Error("Could not load the manual authentication session.");
    if (!session) throw new Error("Manual authentication session was not found.");
    if (session.status !== "starting") {
      if (session.status === "ready") {
        return {
          status: "ready" as const,
          message: "Authenticated session is already saved.",
        };
      }
      throw new Error("This manual authentication session is no longer active.");
    }

    const expiresAtMs = session.expires_at
      ? new Date(session.expires_at).getTime()
      : 0;
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
      await (admin as any)
        .from("browser_auth_sessions")
        .update({
          status: "expired",
          error_code: "manual_auth_expired",
          updated_at: new Date().toISOString(),
        })
        .eq("id", session.id);
      await closeRemoteBrowserSession(
        admin,
        session.provider,
        session.provider_session_id,
      );
      throw new Error("The secure login browser expired. Open a new one and try again.");
    }

    const otpContext = (session.otp_context ?? {}) as any;
    const accountId =
      typeof otpContext.account_id === "string" ? otpContext.account_id : "";
    if (!accountId) {
      throw new Error("This authentication session is not linked to a tool account.");
    }

    const { data: account } = await (admin as any)
      .from("tool_accounts")
      .select("id, tool_slug, login_url, enabled, status")
      .eq("id", accountId)
      .eq("tool_slug", session.tool_slug)
      .maybeSingle();
    if (!account?.enabled || account.status !== "working") {
      throw new Error("The linked tool account is no longer active.");
    }

    const { data: toolSetting } = await (admin as any)
      .from("tool_settings")
      .select("official_login_url")
      .eq("tool_slug", session.tool_slug)
      .maybeSingle();
    const loginUrl = String(
      account.login_url ?? toolSetting?.official_login_url ?? "",
    ).trim();

    if (!session.provider_session_id) {
      throw new Error("The secure login browser is unavailable. Open a new one.");
    }

    const cdp =
      session.provider === "cloudflare"
        ? await reconnectCloudflareSession(admin, session.provider_session_id)
        : await reconnectBrowserUseSession(admin, session.provider_session_id);
    if (!cdp) {
      throw new Error("Could not reconnect to the secure login browser. Open a new one.");
    }

    try {
      const pageSessionId =
        session.provider === "browser_use"
          ? await attachBrowserUsePage(cdp, loginUrl)
          : undefined;
      const outcome = await waitForAuthOrOtp(cdp, pageSessionId, 8_000);

      if (outcome.status === "otp") {
        return {
          status: "needs_completion" as const,
          message:
            "Phrasly is still waiting for the verification code in the secure login browser. Enter it there, then click Save authenticated session again.",
        };
      }
      if (outcome.status !== "authenticated") {
        if (outcome.status === "timeout" && outcome.humanVerification) {
          return {
            status: "needs_completion" as const,
            message:
              "Complete Phrasly's human-verification step in the secure login browser, then try saving again.",
          };
        }
        if (outcome.status === "timeout" && outcome.onLoginPage) {
          return {
            status: "needs_completion" as const,
            message:
              "Phrasly is still on the login page. Finish the login in the secure browser, including any OTP, then try saving again.",
          };
        }
        return {
          status: "needs_completion" as const,
          message:
            "Phrasly login is not complete yet. Finish the secure-browser login and try saving again.",
        };
      }

      const state = await captureSessionStateThroughCdp(cdp, pageSessionId);
      if (!state.authenticated_cookies.length) {
        return {
          status: "needs_completion" as const,
          message:
            "Phrasly appears logged in, but reusable session cookies are not available yet. Wait a moment in the secure browser and try saving again.",
        };
      }

      const { error: saveError } = await (admin as any)
        .from("tool_account_sessions")
        .upsert(
          {
            account_id: accountId,
            provider: session.provider,
            provider_session_id: session.provider_session_id,
            authenticated_cookies: state.authenticated_cookies,
            session_tokens: state.session_tokens,
            auth_headers: state.auth_headers,
            last_verified_at: new Date().toISOString(),
            verification_status: "active",
            expires_at: new Date(
              Date.now() + 30 * 24 * 60 * 60 * 1000,
            ).toISOString(),
            created_by: context.userId,
          },
          { onConflict: "account_id,provider" },
        );
      if (saveError) {
        throw new Error("Phrasly login succeeded, but the reusable session could not be saved.");
      }

      const { error: readyError } = await (admin as any)
        .from("browser_auth_sessions")
        .update({
          status: "ready",
          error_code: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", session.id);
      if (readyError) {
        await (admin as any)
          .from("tool_account_sessions")
          .update({ verification_status: "invalid" })
          .eq("account_id", accountId)
          .eq("provider", session.provider);
        throw new Error("Phrasly session was captured but could not transition to READY.");
      }

      await (admin as any).from("browser_auth_otp_audit").insert({
        session_id: session.id,
        account_id: accountId,
        event: "admin_refresh_succeeded",
        otp_type: "manual_handoff",
        submitted_by: context.userId,
      });

      await closeRemoteBrowserSession(
        admin,
        session.provider,
        session.provider_session_id,
      );

      return {
        status: "ready" as const,
        message:
          "Phrasly authentication is saved. Writers can now launch isolated sessions.",
      };
    } finally {
      cdp.close();
    }
  });
