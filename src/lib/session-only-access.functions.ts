/* Writer/customer one-click access. This module NEVER reads or submits tool passwords. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  launchBrowserUseSessionOnly,
  launchCloudflareSessionOnly,
  SharedAuthStateRejectedError,
  WRITER_REAUTH_MESSAGE,
  WRITER_TEMPORARY_MESSAGE,
} from "@/lib/shared-session-launch.server";
import type { BrowserAuthProvider } from "@/lib/browser-auth.server";

function validProvider(v: unknown): BrowserAuthProvider | null { return v === "browser_use" || v === "cloudflare" ? v : null; }
function unexpired(v: string | null | undefined) { return !v || new Date(v).getTime() > Date.now(); }

export const startSessionOnlyOneClickAuth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ tool_slug: z.string().min(1).max(120), grant_access: z.boolean().optional() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
    const { data: global } = await (admin as any).from("browser_auth_settings").select("enabled, default_provider, session_timeout_minutes").eq("id", true).maybeSingle();
    if (!global?.enabled) throw new Error("One-Click Login is not enabled yet. Contact Admin.");
    const { data: toolSetting } = await (admin as any).from("tool_settings").select("enabled, one_click_auth_enabled, official_login_url, auth_provider").eq("tool_slug", data.tool_slug).maybeSingle();
    if (toolSetting?.enabled === false || !toolSetting?.one_click_auth_enabled) throw new Error("One-Click Login is not enabled for this tool.");

    let accountId: string | null = null;
    let grantId: string | null = null;
    let orderId: string | null = null;
    if (data.grant_access) {
      const { data: grants } = await (admin as any).from("tool_access_grants").select("id, account_id, expires_at").eq("user_id", context.userId).eq("tool_slug", data.tool_slug).eq("status", "active").order("granted_at", { ascending: false }).limit(10);
      const grant = (grants ?? []).find((g: any) => unexpired(g.expires_at));
      if (!grant) throw new Error("An active access grant is required for this tool.");
      accountId = grant.account_id; grantId = grant.id;
    } else {
      const { data: orders } = await (admin as any).from("tool_orders").select("id, expires_at, access_type, fulfilment_status").eq("user_id", context.userId).eq("tool_slug", data.tool_slug).eq("status", "approved").eq("payment_status", "successful").order("created_at", { ascending: false }).limit(20);
      const order = (orders ?? []).find((o: any) => unexpired(o.expires_at) && (o.access_type !== "private" || o.fulfilment_status === "active"));
      if (!order) throw new Error("A successful active subscription is required for One-Click Login.");
      orderId = order.id;
      const { data: assignment } = await (admin as any).from("tool_account_assignments").select("account_id").eq("order_id", order.id).eq("status", "active").maybeSingle();
      accountId = assignment?.account_id ?? null;
    }
    if (!accountId) throw new Error(WRITER_REAUTH_MESSAGE);

    const { data: account } = await (admin as any).from("tool_accounts").select("id, login_url, enabled, status, expires_at").eq("id", accountId).maybeSingle();
    if (!account?.enabled || account.status !== "working" || !unexpired(account.expires_at)) throw new Error(WRITER_REAUTH_MESSAGE);
    const loginUrl = String(account.login_url ?? toolSetting.official_login_url ?? "").trim();
    if (!loginUrl) throw new Error(WRITER_REAUTH_MESSAGE);
    try { if (new URL(loginUrl).protocol !== "https:") throw new Error(); } catch { throw new Error(WRITER_REAUTH_MESSAGE); }

    const provider = validProvider(toolSetting.auth_provider) ?? validProvider(global.default_provider) ?? "browser_use";
    const timeoutMinutes = Math.max(5, Math.min(60, Number(global.session_timeout_minutes ?? 30)));
    const { data: saved } = await (admin as any).from("tool_account_sessions")
      .select("authenticated_cookies, session_tokens, verification_status, expires_at, created_by")
      .eq("account_id", accountId).eq("provider", provider).maybeSingle();
    if (!saved || saved.verification_status !== "active" || !Array.isArray(saved.authenticated_cookies) || !saved.authenticated_cookies.length) throw new Error(WRITER_REAUTH_MESSAGE);
    if (!saved.expires_at || new Date(saved.expires_at).getTime() <= Date.now()) {
      await (admin as any).from("tool_account_sessions").update({ verification_status: "expired" }).eq("account_id", accountId).eq("provider", provider);
      throw new Error(WRITER_REAUTH_MESSAGE);
    }

    const fiveMinutesAgo = new Date(Date.now() - 5 * 60000).toISOString();
    const { count } = await (admin as any).from("browser_auth_sessions").select("id", { count: "exact", head: true }).eq("user_id", context.userId).gte("created_at", fiveMinutesAgo);
    if ((count ?? 0) >= 3) throw new Error("Too many One-Click Login attempts. Please wait a few minutes and try again.");
    const { data: auditRow, error: insertError } = await (admin as any).from("browser_auth_sessions").insert({
      user_id: context.userId, order_id: orderId, grant_id: grantId, tool_slug: data.tool_slug, provider, status: "starting",
      expires_at: new Date(Date.now() + timeoutMinutes * 60000).toISOString(),
    }).select("id").single();
    if (insertError) throw new Error("Could not start One-Click Login. Please try again.");

    try {
      const state = { authenticated_cookies: saved.authenticated_cookies, session_tokens: saved.session_tokens };
      const launched = provider === "cloudflare"
        ? await launchCloudflareSessionOnly(admin, { loginUrl, timeoutMinutes, state })
        : await launchBrowserUseSessionOnly(admin, { loginUrl, timeoutMinutes, state });
      await (admin as any).from("browser_auth_sessions").update({ status: "ready", provider_session_id: launched.providerSessionId, expires_at: launched.expiresAt, updated_at: new Date().toISOString() }).eq("id", auditRow.id);
      await (admin as any).from("tool_usage").insert({ tool_slug: data.tool_slug, user_id: context.userId });
      return { ok: true, status: "ready" as const, provider: launched.provider, launch_url: launched.liveUrl, expires_at: launched.expiresAt };
    } catch (e) {
      if (e instanceof SharedAuthStateRejectedError) {
        await (admin as any)
          .from("tool_account_sessions")
          .update({ verification_status: "invalid" })
          .eq("account_id", accountId)
          .eq("provider", provider);
        await (admin as any)
          .from("browser_auth_sessions")
          .update({
            status: "failed",
            error_code: "admin_reauth_required",
            updated_at: new Date().toISOString(),
          })
          .eq("id", auditRow.id);
        await (admin as any).from("browser_auth_otp_audit").insert({
          session_id: auditRow.id,
          account_id: accountId,
          event: "shared_session_rejected",
          otp_type: "session_reuse",
          error_message: "Saved authentication rejected by upstream",
          submitted_by: saved.created_by,
        });
        throw new Error(WRITER_REAUTH_MESSAGE);
      }

      await (admin as any)
        .from("browser_auth_sessions")
        .update({
          status: "failed",
          error_code: "browser_provider_unavailable",
          updated_at: new Date().toISOString(),
        })
        .eq("id", auditRow.id);
      throw new Error(WRITER_TEMPORARY_MESSAGE);
    }
  });
