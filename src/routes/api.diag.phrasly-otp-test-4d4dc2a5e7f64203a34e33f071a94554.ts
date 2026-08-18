import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { loadBrowserSecret } from "@/lib/browser-auth.server";

const KEY = "b2d45d4375974e0ea02c0d2492104891";
const BASE = "https://api.browser-use.com/api/v3";

function out(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow, noarchive" } });
}

async function start() {
  const apiKey = await loadBrowserSecret(supabaseAdmin, "BROWSER_USE_API_KEY");
  const otp = await loadBrowserSecret(supabaseAdmin, "PHRASLY_E2E_OTP");
  if (!apiKey || !otp) return out({ error: "Missing Browser Use or temporary OTP secret" }, 500);

  const { data: account } = await supabaseAdmin
    .from("tool_accounts")
    .select("login_email,login_password,login_url")
    .eq("tool_slug", "phrasly")
    .eq("enabled", true)
    .eq("status", "working")
    .maybeSingle();

  const email = String(account?.login_email ?? "").trim();
  const password = String(account?.login_password ?? "").trim();
  const loginUrl = String(account?.login_url ?? "").trim();
  if (!email || !password || !loginUrl) return out({ error: "Phrasly account is incomplete" }, 500);

  const task = [
    `Open ${loginUrl}.`,
    `Sign in with email ${email} and password ${password}.`,
    `If Phrasly asks for an email verification code, enter ${otp} and submit it.`,
    "Do not change billing, password, profile, settings, or any account data.",
    "Verify whether an authenticated Phrasly dashboard/workspace is actually reached.",
    "If the verification code is rejected, expired, CAPTCHA appears, credentials are rejected, or another blocker occurs, report it exactly.",
    "Return only the requested structured result.",
  ].join(" ");

  const res = await fetch(`${BASE}/sessions`, {
    method: "POST",
    headers: { "X-Browser-Use-API-Key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      task,
      model: "bu-mini",
      keepAlive: false,
      maxCostUsd: 0.30,
      enableRecording: true,
      skills: false,
      agentmail: false,
      outputSchema: {
        type: "object",
        properties: {
          success: { type: "boolean" },
          final_url: { type: "string" },
          evidence: { type: "string" },
          blocker: { type: "string" },
        },
        required: ["success", "final_url", "evidence", "blocker"],
      },
    }),
  });
  const body = await res.json().catch(() => null) as Record<string, unknown> | null;
  if (!res.ok || !body?.id) return out({ started: false, status_code: res.status, error: "Browser Use rejected Phrasly test" }, 502);
  return out({ started: true, session_id: String(body.id), status: String(body.status ?? "created") });
}

async function poll(sessionId: string) {
  const apiKey = await loadBrowserSecret(supabaseAdmin, "BROWSER_USE_API_KEY");
  if (!apiKey) return out({ error: "Browser Use API key missing" }, 500);
  const res = await fetch(`${BASE}/sessions/${encodeURIComponent(sessionId)}`, { headers: { "X-Browser-Use-API-Key": apiKey } });
  const body = await res.json().catch(() => null) as Record<string, unknown> | null;
  if (!res.ok || !body) return out({ error: "Could not read Browser Use session" }, 502);
  return out({
    session_id: sessionId,
    status: String(body.status ?? "unknown"),
    successful: body.isTaskSuccessful === true,
    output: body.output ?? null,
    step_count: Number(body.stepCount ?? 0),
    last_step: typeof body.lastStepSummary === "string" ? body.lastStepSummary : null,
    total_cost_usd: typeof body.totalCostUsd === "string" ? body.totalCostUsd : null,
    screenshot_url: typeof body.screenshotUrl === "string" ? body.screenshotUrl : null,
  });
}

export const Route = createFileRoute("/api/diag/phrasly-otp-test-4d4dc2a5e7f64203a34e33f071a94554")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get("k") !== KEY) return new Response("Not found", { status: 404 });
        const sessionId = url.searchParams.get("session_id");
        return sessionId ? poll(sessionId) : start();
      },
    },
  },
});
