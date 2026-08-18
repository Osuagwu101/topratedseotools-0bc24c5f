import { createFileRoute } from "@tanstack/react-router";

const ACCOUNT_ID = "f6546e03-92b2-4a7e-a028-0d9baf175377";
const ENDPOINT = "https://humanize-craft-52.lovable.app/api/sso/toprated-account-link";

export const Route = createFileRoute("/api/diag/sneakwrite-direct-sso-77d928c08eef4ca0a2431245c67042fd")({
  server: {
    handlers: {
      GET: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: account } = await supabaseAdmin
          .from("tool_accounts")
          .select("login_email, login_password, enabled, status")
          .eq("id", ACCOUNT_ID)
          .maybeSingle();
        if (!account?.enabled || account.status !== "working" || !account.login_email || !account.login_password) {
          return Response.json({ ok: false, stage: "account" }, { status: 500 });
        }

        try {
          const response = await fetch(ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({ email: account.login_email, password: account.login_password }),
            redirect: "manual",
          });
          const body = await response.json().catch(() => null) as
            | { ok?: boolean; launch_url?: string }
            | null;
          let host: string | null = null;
          if (body?.launch_url) {
            try { host = new URL(body.launch_url).host; } catch { host = null; }
          }
          return Response.json(
            { ok: response.ok && body?.ok === true && !!host, status_code: response.status, launch_host: host },
            { status: response.ok ? 200 : 502, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow, noarchive" } },
          );
        } catch (error) {
          return Response.json(
            { ok: false, stage: "fetch", detail: error instanceof Error ? error.message.slice(0, 120) : "fetch failed" },
            { status: 502, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow, noarchive" } },
          );
        }
      },
    },
  },
});
