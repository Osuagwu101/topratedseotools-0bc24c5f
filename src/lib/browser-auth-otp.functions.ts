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
import { CdpClient } from "@/lib/browser-auth.server";

/**
 * Admin submits OTP code for a paused browser session.
 * Resumes automation, waits for login to complete, captures session state.
 */
export const submitOtpForBrowserSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      session_id: z.string().uuid(),
      otp_code: z.string().trim().min(1).max(20),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");

    // Load the paused session
    const { data: session, error: sessionError } = await (admin as any)
      .from("browser_auth_sessions")
      .select("id, user_id, order_id, tool_slug, provider, provider_session_id, status, expires_at, otp_context")
      .eq("id", data.session_id)
      .eq("status", "awaiting_otp")
      .maybeSingle();

    if (sessionError) throw new Error("Could not load session.");
    if (!session) throw new Error("Session not found or no longer awaiting OTP.");

    const sess = session as any;
    const otpCtx = (sess.otp_context ?? {}) as any;

    // Verify admin is authorized (owns this order or is admin)
    const isAdmin = await (admin as any)
      .rpc("has_role", { _user_id: context.userId, _role: "admin" })
      .then((r: any) => r.data);

    if (!isAdmin && sess.user_id !== context.userId) {
      throw new Error("Unauthorized to submit OTP for this session.");
    }

    // Reconnect to Browser Use / Cloudflare session
    let cdp: CdpClient | null = null;
    try {
      // Note: This assumes we have access to the provider session URL
      // In real implementation, Browser Use API would provide a way to reconnect
      // For now, we'd need to extend this to support reconnecting to existing sessions

      // Submit OTP code
      const submitResult = await cdp?.send(
        "Runtime.evaluate",
        {
          expression: submitOtpExpression(data.otp_code, otpCtx.field_selector),
          returnByValue: true,
          awaitPromise: true,
        }
      ).catch((e: any) => ({
        result: {
          value: { success: false, error: e.message }
        }
      }));

      if (!submitResult?.result?.value?.success) {
        // Log failure
        await (admin as any)
          .from("browser_auth_otp_audit")
          .insert({
            session_id: data.session_id,
            account_id: null,
            event: "otp_rejected",
            otp_type: otpCtx.detected_type,
            error_message: submitResult?.result?.value?.error || "OTP submission failed",
            submitted_by: context.userId,
          });

        throw new Error(
          `OTP submission failed: ${submitResult?.result?.value?.error || "Unknown error"}`
        );
      }

      // Wait for login to complete (2 seconds, then check auth status)
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Verify login succeeded
      const authCheck = await cdp?.send(
        "Runtime.evaluate",
        {
          expression: checkAuthenticationStatusExpression(),
          returnByValue: true,
          awaitPromise: true,
        }
      );

      const authStatus = authCheck?.result?.value as any;
      if (!authStatus?.authenticated) {
        await (admin as any)
          .from("browser_auth_otp_audit")
          .insert({
            session_id: data.session_id,
            account_id: null,
            event: "otp_accepted",
            otp_type: otpCtx.detected_type,
            error_message: "OTP accepted but login verification failed",
            submitted_by: context.userId,
          });

        throw new Error("OTP accepted but login verification failed. Still on login page.");
      }

      // Capture authenticated session state
      const sessionState = await captureSessionStateThroughCdp(cdp);

      // Store authenticated session for reuse
      if (sess.order_id) {
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
            // Save authenticated session
            await (admin as any)
              .from("tool_account_sessions")
              .upsert({
                account_id: accountAssignment.account_id,
                provider: sess.provider,
                provider_session_id: sess.provider_session_id,
                authenticated_cookies: sessionState.authenticated_cookies,
                session_tokens: sessionState.session_tokens,
                auth_headers: sessionState.auth_headers,
                last_verified_at: new Date().toISOString(),
                verification_status: "active",
                expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days
                created_by: context.userId,
              }, {
                onConflict: "account_id"
              });
          }
        }
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
      await (admin as any)
        .from("browser_auth_otp_audit")
        .insert({
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
      await (admin as any)
        .from("browser_auth_otp_audit")
        .insert({
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
          status: "failed",
          otp_submission_error: err instanceof Error ? err.message.slice(0, 500) : "OTP submission failed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", data.session_id);

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
      .select("id, status, otp_context, otp_submission_error, expires_at, created_at, updated_at")
      .eq("id", data.session_id)
      .maybeSingle();

    if (!session) throw new Error("Session not found.");

    const sess = session as any;
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

    await (admin as any)
      .from("browser_auth_otp_audit")
      .insert({
        session_id: data.session_id,
        event: "otp_timeout",
        submitted_by: context.userId,
      });

    return { ok: true };
  });
