/**
 * Cron endpoint — auto-fulfil Private Access orders whose 6-hour window has
 * elapsed without admin action. Scheduled via pg_cron every 5 minutes.
 *
 * The service-role-only database secret is authoritative. CRON_SECRET is used
 * only when no database value exists, so database rotation invalidates any old
 * embedded credential immediately.
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
        const { data: row } = await supabaseAdmin
          .from("internal_secrets")
          .select("value")
          .eq("name", "cron_secret")
          .maybeSingle();
        const dbSecret = String(row?.value ?? "");
        const effectiveSecret = dbSecret || (process.env.CRON_SECRET ?? "");
        const provided = request.headers.get("x-cron-secret") ?? "";
        if (!provided || !effectiveSecret || !safeEqual(provided, effectiveSecret)) {
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
        const { queueReviewRequest } = await import("@/lib/email/review-request");
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
            .eq("fulfilment_status", "pending");
          if (!upErr) {
            processed++;
            await queueOrderEmail(supabaseAdmin, {
              kind: "private_fulfilled",
              orderId: o.id as string,
              extraPayload: { fulfilled_at: now.toISOString(), expiry_date: expires.toISOString() },
            });
            await queueReviewRequest(supabaseAdmin, { orderId: o.id as string });
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
