/**
 * Cron endpoint — drives the email pipeline. Runs every few minutes.
 *
 * The service-role-only database secret is authoritative. CRON_SECRET is used
 * only as a fallback when no database secret exists, so rotating the database
 * value immediately invalidates any previously embedded cron credential.
 */
import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "crypto";

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export const Route = createFileRoute("/api/public/hooks/email-dispatcher")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: row } = await supabaseAdmin
          .from("internal_secrets")
          .select("value")
          .eq("name", "cron_secret")
          .maybeSingle();
        const dbSecret = String(row?.value ?? "");
        const effectiveSecret = dbSecret || (process.env.CRON_SECRET ?? "");
        const provided = request.headers.get("x-cron-secret") ?? "";
        if (!provided || !effectiveSecret || !safeEqual(provided, effectiveSecret)) {
          return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
            status: 401,
            headers: { "content-type": "application/json" },
          });
        }

        const { queueAbandonedReminders, dispatchDue } = await import("@/lib/email/queue");
        const scanned = await queueAbandonedReminders(supabaseAdmin);
        const dispatched = await dispatchDue(supabaseAdmin, 100);
        return new Response(
          JSON.stringify({ ok: true, abandoned_queued: scanned.queued, ...dispatched }),
          { headers: { "content-type": "application/json" } },
        );
      },
    },
  },
});
