import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { loadBrowserSecret } from "@/lib/browser-auth.server";

const DIAG_KEY = "c9c12f9e8f5a45e2b7d7e4bd2383f346";
const BROWSER_USE_BASE = "https://api.browser-use.com/api/v3";

export const Route = createFileRoute("/api/diag/phrasly-otp-e2e-5d90d80acb9f4e5d9fd0d0a4e02b9e71")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get("k") !== DIAG_KEY) return new Response("Not found", { status: 404 });
        const otp = String(url.searchParams.get("otp") ?? "").trim();
        if (!/^\d{4,8}$/.test(otp)) return Response.json({ error: "Invalid verification code" }, { status: 400 });

        const apiKey = await loadBrowserSecret(supabaseAdmin, "BROWSER_USE_API_KEY");
        if (!apiKey) return Response.json({ error: "Browser Use API key missing" }, { status: 500 });

        const { data: account } = await supabaseAdmin
          .from("tool_accounts")
          .select("login_email, login_password, login_url")
          .eq("tool_slug", "phrasly")
          .eq("enabled", true)
          .eq("status", "working")
          .limit(1)
          .maybeSingle();

        const email = String(account?.login_email ?? "").trim();
        const password = String(account?.login_password ?? "").trim();
        const loginUrl = String(account?.login_url ?? "").trim();
        if (!email || !password || !loginUrl) return Response.json({ error: "Phrasly account incomplete" }, { status: 500 });

        const task = [
          `Open ${loginUrl}.`,
          `Sign in with email ${email} and password ${password}.`,
          `If Phrasly requests a login verification code, enter ${otp} and submit it.`,
          "Do not change billing, password, profile, settings, or any account data.",
          "Confirm only after an authenticated Phrasly dashboard/workspace is actually reached.",
        ].join(" ");

        const res = await fetch(`${BROWSER_USE_BASE}/sessions`, {
          method: "POST",
          headers: { "X-Browser-Use-API-Key": apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({ task, model: "bu-mini", keepAlive: false, maxCostUsd: 0.25, enableRecording: true, skills: false, agentmail: false }),
        });
        const body = await res.json().catch(() => null) as Record<string, unknown> | null;
        return Response.json({ started: res.ok && !!body?.id, status_code: res.status, session_id: body?.id ?? null, status: body?.status ?? null }, { headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow, noarchive" } });
      },
    },
  },
});
