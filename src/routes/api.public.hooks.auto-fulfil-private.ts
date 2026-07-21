/**
 * Cron endpoint — auto-fulfil Private Access orders whose 6-hour window has
 * elapsed without admin action. Scheduled via pg_cron every 5 minutes.
 *
 * SECURITY
 * --------
 * Although the URL sits under /api/public/* (which bypasses Lovable's edge
 * auth), the handler requires a shared secret in the `x-cron-secret` header
 * that must match the CRON_SECRET environment variable. Requests without a
 * secret, with the wrong secret, or when the server is missing the secret
 * are rejected with HTTP 401. The secret is never exposed to the browser —
 * it is read from process.env inside the handler and injected server-side
 * by the pg_cron schedule.
 *
 * The six-hour fulfilment rule is unchanged: rows are only processed when
 * their `fulfilment_deadline_at` (set to purchase time + 6h) has elapsed.
 */
import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "crypto";

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export const Route = createFileRoute("/api/public/hooks/auto-fulfil-private")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // Accept a match against either the env-configured CRON_SECRET or
        // the service-role-only internal_secrets row that pg_cron uses.
        // Both are secret; the endpoint has no other way in.
        const envSecret = process.env.CRON_SECRET ?? "";
        const { data: row } = await supabaseAdmin
          .from("internal_secrets")
          .select("value")
          .eq("name", "cron_secret")
          .maybeSingle();
        const dbSecret = (row?.value as string | undefined) ?? "";
        const provided = request.headers.get("x-cron-secret") ?? "";
        const ok =
          !!provided &&
          ((!!envSecret && safeEqual(provided, envSecret)) ||
            (!!dbSecret && safeEqual(provided, dbSecret)));
        if (!ok) {
          console.warn("[auto-fulfil-private] rejected: missing or invalid cron secret");
          return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
            status: 401,
            headers: { "content-type": "application/json" },
          });
        }

        const now = new Date();
        const { data: due, error } = await supabaseAdmin
          .from("tool_orders")
          .select("id, duration_days, grace_days, fulfilment_deadline_at")
          .eq("access_type", "private")
          .eq("fulfilment_status", "pending")
          .lte("fulfilment_deadline_at", now.toISOString());
        if (error) {
          console.error("[auto-fulfil-private] query failed");
          return new Response(JSON.stringify({ ok: false, error: "query_failed" }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });
        }
        let processed = 0;
        const { queueOrderEmail } = await import("@/lib/email/order-emails");
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
          if (!upErr) {
            processed++;
            await queueOrderEmail(supabaseAdmin, {
              kind: "private_fulfilled",
              orderId: o.id as string,
              extraPayload: {
                fulfilled_at: now.toISOString(),
                expiry_date: expires.toISOString(),
              },
            });
          }
        }

        return new Response(
          JSON.stringify({ ok: true, processed, checked: (due ?? []).length }),
          { headers: { "content-type": "application/json" } },
        );
      },
    },
  },
});
