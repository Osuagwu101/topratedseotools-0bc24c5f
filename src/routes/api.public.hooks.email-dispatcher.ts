/**
 * Cron endpoint — drives the email pipeline. Runs every few minutes.
 *
 * 1) Scans pending tool_orders older than the configured abandoned-checkout
 *    delay and queues one reminder each (idempotent per order).
 * 2) Dispatches every queue row whose scheduled_for <= now (pending + retrying).
 *
 * Same shared-secret protection as auto-fulfil-private.
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

        const envSecret = process.env.CRON_SECRET ?? "";
        const { data: row } = await supabaseAdmin
          .from("internal_secrets")
          .select("value")
          .eq("name", "cron_secret")
          .maybeSingle();
        const dbSecret = ((row as { value?: string } | null)?.value as string | undefined) ?? "";
        const provided = request.headers.get("x-cron-secret") ?? "";
        const ok =
          !!provided &&
          ((!!envSecret && safeEqual(provided, envSecret)) ||
            (!!dbSecret && safeEqual(provided, dbSecret)));
        if (!ok) {
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
