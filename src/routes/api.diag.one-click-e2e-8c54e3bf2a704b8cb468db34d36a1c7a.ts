import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { loadBrowserSecret } from "@/lib/browser-auth.server";

const DIAG_KEY = "30f2935ce1be4bdca414cd23b848db13";
const TOOL_SLUGS = ["phrasly", "stealthwriter", "sneakwrite"] as const;
const BROWSER_USE_BASE = "https://api.browser-use.com/api/v3";

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
    },
  });
}

function safeOutput(raw: unknown) {
  if (!raw || typeof raw !== "object") return raw ?? null;
  const obj = raw as Record<string, unknown>;
  return {
    success: Boolean(obj.success),
    final_url: typeof obj.final_url === "string" ? obj.final_url : "",
    evidence: typeof obj.evidence === "string" ? obj.evidence : "",
    blocker: typeof obj.blocker === "string" ? obj.blocker : "",
  };
}

async function startTests() {
  const apiKey = await loadBrowserSecret(supabaseAdmin, "BROWSER_USE_API_KEY");
  if (!apiKey) return json({ error: "Browser Use API key missing" }, 500);

  const { data: accounts, error } = await supabaseAdmin
    .from("tool_accounts")
    .select("tool_slug, login_email, login_password, login_url, enabled, status")
    .in("tool_slug", [...TOOL_SLUGS])
    .eq("enabled", true)
    .eq("status", "working");
  if (error) return json({ error: "Could not load tool accounts" }, 500);

  const bySlug = new Map((accounts ?? []).map((a) => [a.tool_slug, a]));
  const results = await Promise.all(
    TOOL_SLUGS.map(async (toolSlug) => {
      const account = bySlug.get(toolSlug);
      const email = String(account?.login_email ?? "").trim();
      const password = String(account?.login_password ?? "").trim();
      const loginUrl = String(account?.login_url ?? "").trim();
      if (!email || !password || !loginUrl) {
        return { tool_slug: toolSlug, started: false, error: "Saved account is incomplete" };
      }

      const task = [
        `Open ${loginUrl}.`,
        `Sign in with email ${email} and password ${password}.`,
        "Do not change billing, password, profile, settings, or any account data.",
        "After submitting the login form, verify whether an authenticated account/dashboard/workspace page is actually reached.",
        "If CAPTCHA, 2FA, email verification, invalid credentials, anti-bot protection, or another blocker appears, report it exactly.",
        "Return only the requested structured result.",
      ].join(" ");

      try {
        const res = await fetch(`${BROWSER_USE_BASE}/sessions`, {
          method: "POST",
          headers: {
            "X-Browser-Use-API-Key": apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            task,
            model: "bu-mini",
            keepAlive: false,
            maxCostUsd: 0.25,
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
        if (!res.ok || !body?.id) {
          return { tool_slug: toolSlug, started: false, status_code: res.status, error: "Browser Use did not start the test" };
        }
        return {
          tool_slug: toolSlug,
          started: true,
          session_id: String(body.id),
          status: String(body.status ?? "created"),
        };
      } catch {
        return { tool_slug: toolSlug, started: false, error: "Browser Use request failed" };
      }
    }),
  );

  return json({ started_at: new Date().toISOString(), results });
}

async function pollTests(url: URL) {
  const apiKey = await loadBrowserSecret(supabaseAdmin, "BROWSER_USE_API_KEY");
  if (!apiKey) return json({ error: "Browser Use API key missing" }, 500);

  const items = url.searchParams.getAll("s")
    .map((v) => {
      const i = v.indexOf(":");
      return i > 0 ? { tool_slug: v.slice(0, i), session_id: v.slice(i + 1) } : null;
    })
    .filter((v): v is { tool_slug: string; session_id: string } => !!v);

  if (!items.length) return json({ error: "No session IDs supplied" }, 400);

  const results = await Promise.all(items.map(async ({ tool_slug, session_id }) => {
    try {
      const res = await fetch(`${BROWSER_USE_BASE}/sessions/${encodeURIComponent(session_id)}`, {
        headers: { "X-Browser-Use-API-Key": apiKey },
      });
      const body = await res.json().catch(() => null) as Record<string, unknown> | null;
      if (!res.ok || !body) return { tool_slug, session_id, status: "fetch_error", status_code: res.status };
      return {
        tool_slug,
        session_id,
        status: String(body.status ?? "unknown"),
        successful: body.isTaskSuccessful === true,
        output: safeOutput(body.output),
        step_count: Number(body.stepCount ?? 0),
        last_step: typeof body.lastStepSummary === "string" ? body.lastStepSummary : null,
        total_cost_usd: typeof body.totalCostUsd === "string" ? body.totalCostUsd : null,
        screenshot_url: typeof body.screenshotUrl === "string" ? body.screenshotUrl : null,
      };
    } catch {
      return { tool_slug, session_id, status: "fetch_error" };
    }
  }));

  return json({ checked_at: new Date().toISOString(), results });
}

export const Route = createFileRoute("/api/diag/one-click-e2e-8c54e3bf2a704b8cb468db34d36a1c7a")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get("k") !== DIAG_KEY) return new Response("Not found", { status: 404 });
        return url.searchParams.get("mode") === "poll" ? pollTests(url) : startTests();
      },
    },
  },
});
