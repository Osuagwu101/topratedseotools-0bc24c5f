import { createFileRoute } from "@tanstack/react-router";

function response(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
    },
  });
}

export const Route = createFileRoute("/api/sso/sneakwrite-consume")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const ticket = (url.searchParams.get("ticket") ?? "").trim();
        if (!/^[A-Za-z0-9_-]{40,100}$/.test(ticket)) {
          return response({ ok: false, error: "Invalid or expired SSO ticket." }, 404);
        }

        const [{ supabaseAdmin }, { hashDirectSsoTicket }] = await Promise.all([
          import("@/integrations/supabase/client.server"),
          import("@/lib/direct-sso.server"),
        ]);
        const now = new Date().toISOString();
        const { data, error } = await supabaseAdmin
          .from("direct_sso_tickets")
          .update({ consumed_at: now })
          .eq("token_hash", hashDirectSsoTicket(ticket))
          .eq("tool_slug", "sneakwrite")
          .is("consumed_at", null)
          .gt("expires_at", now)
          .select("target_email")
          .maybeSingle();

        if (error || !data?.target_email) {
          return response({ ok: false, error: "Invalid or expired SSO ticket." }, 404);
        }

        return response({ ok: true, email: data.target_email });
      },
    },
  },
});
