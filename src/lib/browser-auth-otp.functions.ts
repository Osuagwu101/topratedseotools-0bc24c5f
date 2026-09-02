/**
 * One-Time Password (OTP) / 2FA submission during browser-based authentication.
 *
 * Admin receives OTP from tool and submits it here. System continues
 * the paused browser automation and captures authenticated session on success.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  submitOtpExpression,
  checkAuthenticationStatusExpression,
  captureSessionStateThroughCdp,
  type CapturedSessionState,
} from "@/lib/browser-auth-otp.server";
import {
  CdpClient,
  reconnectBrowserUseSession,
  reconnectCloudflareSession,
} from "@/lib/browser-auth.server";

class RetryableOtpError extends Error {}

/**
 * Admin submits OTP code for a paused browser session.
 * Resumes automation, waits for login to complete, captures session state.
 */
export const submitOtpForBrowserSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        session_id: z.string().uuid(),
        otp_code: z.string().trim().min(1).max(20),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");

    // Load the paused session
    const { data: session, error: sessionError } = await (admin as any)
      .from("browser_auth_sessions")
      .select(
        "id, user_id, order_id, tool_slug, provider, provider_session_id, status, expires_at, otp_context",
      )
      .eq("id", data.session_id)
      .eq("status", "awaiting_otp")
      .maybeSingle();

    if (sessionError) throw new Error("Could not load session.");
    if (!session) throw new Error("Session not found or no longer awaiting OTP.");

    const sess = session as any;
    const otpCtx = (sess.otp_context ?? {}) as any;

    if (new Date(sess.expires_at).getTime() <= Date.now()) {
      await (admin as any)
        .from("browser_auth_sessions")
        .update({ status: "expired", otp_submission_error: "OTP session expired" })
        .eq("id", data.session_id);
      throw new Error("The OTP session has expired. Please launch Phrasly again.");
    }

    // Verify admin is authorized (must be admin)
    const isAdmin = await (admin as any)
      .rpc("has_role", { _user_id: context.userId, _role: "admin" })
      .then((r: any) => r.data);

    if (!isAdmin) {
      throw new Error("Only admins can submit OTP codes.");
    }

    // Reconnect to Browser Use / Cloudflare session
    let cdp: CdpClient | null = null;
    try {
      // Reconnect to the paused browser session
      if (sess.provider === "browser_use") {
        cdp = await reconnectBrowserUseSession(admin, sess.provider_session_id);
      } else if (sess.provider === "cloudflare") {
        cdp = await reconnectCloudflareSession(admin, sess.provider_session_id);
      }

      if (!cdp) {
        throw new Error(
          `Could not reconnect to ${sess.provider} session. Session may have expired. Please try launching again.`,
        );
      }

      // Submit OTP code
      let submitResult: any;
      try {
        submitResult = await cdp.send("Runtime.evaluate", {
          expression: submitOtpExpression(data.otp_code, otpCtx.field_selector),
          returnByValue: true,
          awaitPromise: true,
        });
      } catch (e: any) {
        submitResult = {
          result: {
            value: { success: false, error: e.message },
          },
        };
      }

      if (!submitResult?.result?.value?.success) {
        throw new RetryableOtpError(
          `OTP submission failed: ${submitResult?.result?.value?.error || "Unknown error"}`,
        );
      }

      // Wait for login to complete (2 seconds, then check auth status)
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Verify login succeeded
      const authCheck = await cdp?.send("Runtime.evaluate", {
        expression: checkAuthenticationStatusExpression(),
        returnByValue: true,
        awaitPromise: true,
      });

      const authStatus = authCheck?.result?.value as any;
      if (!authStatus?.authenticated) {
        throw new RetryableOtpError("OTP was not accepted or login verification did not complete.");
      }

      // Capture authenticated session state
      const sessionState = await captureSessionStateThroughCdp(cdp);

      // Store authenticated session for reuse
      let accountId = otpCtx.account_id as string | undefined;
      if (!accountId && sess.order_id) {
        const { data: order } = await (admin as any)
          .from("tool_orders")
          .select("id")
          .eq("id", sess.order_id)
          .maybeSingle();

        if (order) {
          const { data: accountAssignment } = await (admin as any)
            .from("tool_account_assignments")
            .select("account_id")
            .eq("order_id", sess.order_id)
            .eq("status", "active")
            .maybeSingle();

          if (accountAssignment) {
            accountId = accountAssignment.account_id;
          }
        }
      }

      if (accountId) {
        // Save authenticated session for both paid-order and admin-grant flows.
        await (admin as any).from("tool_account_sessions").upsert(
          {
            account_id: accountId,
            provider: sess.provider,
            provider_session_id: sess.provider_session_id,
            authenticated_cookies: sessionState.authenticated_cookies,
            session_tokens: sessionState.session_tokens,
            auth_headers: sessionState.auth_headers,
            last_verified_at: new Date().toISOString(),
            verification_status: "active",
            expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days
            created_by: context.userId,
          },
          { onConflict: "account_id,provider" },
        );
      }

      // Mark session as ready
      await (admin as any)
        .from("browser_auth_sessions")
        .update({
          status: "ready",
          otp_submitted_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", data.session_id);

      // Audit success
      await (admin as any).from("browser_auth_otp_audit").insert({
        session_id: data.session_id,
        account_id: null,
        event: "otp_accepted",
        otp_type: otpCtx.detected_type,
        submitted_by: context.userId,
      });

      return {
        ok: true,
        message: "OTP accepted. Login successful. Session saved for future use.",
      };
    } catch (err) {
      const attempts = Number(otpCtx.attempt_count ?? 0) + 1;
      const canRetry =
        err instanceof RetryableOtpError &&
        attempts < 3 &&
        new Date(sess.expires_at).getTime() > Date.now();
      await (admin as any).from("browser_auth_otp_audit").insert({
        session_id: data.session_id,
        account_id: null,
        event: "otp_rejected",
        otp_type: otpCtx.detected_type,
        error_message: err instanceof Error ? err.message : "Unknown error",
        submitted_by: context.userId,
      });

      await (admin as any)
        .from("browser_auth_sessions")
        .update({
          status: canRetry ? "awaiting_otp" : "failed",
          otp_context: { ...otpCtx, attempt_count: attempts },
          otp_submission_error:
            err instanceof Error ? err.message.slice(0, 500) : "OTP submission failed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", data.session_id);

      if (canRetry) {
        throw new Error(`Verification failed. ${3 - attempts} attempt(s) remaining.`);
      }
      throw err instanceof Error ? err : new Error("OTP submission failed");
    } finally {
      cdp?.close();
    }
  });

/**
 * Get OTP status for a session (admin polling for updates).
 */
export const getOtpSessionStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ session_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");

    const { data: session } = await (admin as any)
      .from("browser_auth_sessions")
      .select(
        "id, user_id, order_id, status, otp_context, otp_submission_error, expires_at, created_at, updated_at",
      )
      .eq("id", data.session_id)
      .maybeSingle();

    if (!session) throw new Error("Session not found.");

    const sess = session as any;

    // Verify authorization: must be admin or session owner
    const isAdmin = await (admin as any)
      .rpc("has_role", { _user_id: context.userId, _role: "admin" })
      .then((r: any) => r.data);

    if (!isAdmin && sess.user_id !== context.userId) {
      throw new Error("Unauthorized to view this session.");
    }

    const otpCtx = (sess.otp_context ?? {}) as any;
    const timeoutMs = new Date(sess.expires_at).getTime() - Date.now();
    const timedOut = timeoutMs < 0;

    return {
      status: sess.status,
      otp_type: otpCtx.detected_type,
      otp_context: otpCtx,
      error: sess.otp_submission_error,
      timed_out: timedOut,
      timeout_seconds: Math.max(0, Math.floor(timeoutMs / 1000)),
    };
  });

/** Admin queue of OTP challenges waiting for action, optionally per tool. */
export const listAwaitingOtpSessions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ tool_slug: z.string().min(1).max(120).optional() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const isAdmin = await (admin as any)
      .rpc("has_role", { _user_id: context.userId, _role: "admin" })
      .then((r: any) => r.data);
    if (!isAdmin) throw new Error("Only admins can view OTP sessions.");

    let query = (admin as any)
      .from("browser_auth_sessions")
      .select("id, tool_slug, provider, status, otp_context, expires_at, created_at")
      .eq("status", "awaiting_otp")
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: true })
      .limit(50);
    if (data.tool_slug) query = query.eq("tool_slug", data.tool_slug);
    const { data: sessions, error } = await query;
    if (error) throw new Error("Could not load awaiting OTP sessions.");
    return { sessions: sessions ?? [] };
  });

/**
 * Admin cancels an OTP-waiting session (gives up on 2FA).
 */
export const cancelOtpSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ session_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");

    const isAdmin = await (admin as any)
      .rpc("has_role", { _user_id: context.userId, _role: "admin" })
      .then((r: any) => r.data);

    if (!isAdmin) throw new Error("Only admins can cancel OTP sessions.");

    await (admin as any)
      .from("browser_auth_sessions")
      .update({
        status: "failed",
        otp_submission_error: "Cancelled by admin",
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.session_id)
      .eq("status", "awaiting_otp");

    await (admin as any).from("browser_auth_otp_audit").insert({
      session_id: data.session_id,
      event: "otp_timeout",
      submitted_by: context.userId,
    });

    return { ok: true };
  });
