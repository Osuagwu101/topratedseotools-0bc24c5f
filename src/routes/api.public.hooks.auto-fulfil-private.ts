/**
 * Cron endpoint — auto-fulfil Private Access orders whose 6-hour window has
 * elapsed without admin action. Scheduled via pg_cron every 5 minutes.
 *
 * For each matching order:
 *   - subscription_started_at = fulfilment_deadline_at
 *   - fulfilment_status       = "active"
 *   - subscription_status     = "active"
 *   - auto_fulfilled_at       = now()
 *   - current_period_end / next_payment_at / expires_at derived from start
 *
 * The endpoint is under /api/public/* which bypasses auth; it's rate-limited
 * by pg_cron cadence and simply idempotent — running twice for the same row
 * is a no-op because the WHERE clause filters to `fulfilment_status='pending'`.
 */
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/auto-fulfil-private")({
  server: {
    handlers: {
      POST: async () => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const now = new Date();
        const { data: due, error } = await supabaseAdmin
          .from("tool_orders")
          .select("id, duration_days, grace_days, fulfilment_deadline_at")
          .eq("access_type", "private")
          .eq("fulfilment_status", "pending")
          .lte("fulfilment_deadline_at", now.toISOString());
        if (error) {
          return new Response(JSON.stringify({ ok: false, error: error.message }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });
        }
        let processed = 0;
        for (const o of due ?? []) {
          const start = new Date(o.fulfilment_deadline_at as string);
          const dur = (o.duration_days as number) ?? 28;
          const grace = (o.grace_days as number) ?? 0;
          const nextPayment = new Date(start.getTime() + dur * 86400_000);
          const expires = new Date(start.getTime() + (dur + grace) * 86400_000);
          const { error: upErr } = await supabaseAdmin
            .from("tool_orders")
            .update({
              fulfilment_status: "active",
              subscription_status: "active",
              auto_fulfilled_at: now.toISOString(),
              subscription_started_at: start.toISOString(),
              current_period_start: start.toISOString(),
              current_period_end: nextPayment.toISOString(),
              paid_through_at: nextPayment.toISOString(),
              next_payment_at: nextPayment.toISOString(),
              expires_at: expires.toISOString(),
            })
            .eq("id", o.id)
            .eq("fulfilment_status", "pending"); // race guard
          if (!upErr) processed++;
        }
        return new Response(
          JSON.stringify({ ok: true, processed, checked: (due ?? []).length }),
          { headers: { "content-type": "application/json" } },
        );
      },
    },
  },
});
