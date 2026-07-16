/**
 * Paystack webhook — external endpoint at `/api/public/webhooks/paystack`.
 *
 * Verifies HMAC-SHA512 signature over the raw body using the live secret key,
 * then on `charge.success` marks the referenced order as approved and stamps
 * `paid_at` + `expires_at = paid_at + duration + grace`. Idempotent — a
 * repeat delivery for an already-approved order returns 200 without changes.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";

export const Route = createFileRoute("/api/public/webhooks/paystack")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.PAYSTACK_SECRET_KEY;
        if (!secret) return new Response("not configured", { status: 503 });

        const signature = request.headers.get("x-paystack-signature") ?? "";
        const raw = await request.text();
        const expected = createHmac("sha512", secret).update(raw).digest("hex");

        const sig = Buffer.from(signature);
        const exp = Buffer.from(expected);
        if (sig.length !== exp.length || !timingSafeEqual(sig, exp)) {
          return new Response("invalid signature", { status: 401 });
        }

        let payload: any;
        try {
          payload = JSON.parse(raw);
        } catch {
          return new Response("bad json", { status: 400 });
        }

        if (payload?.event !== "charge.success") {
          return new Response("ignored", { status: 200 });
        }

        const orderId = payload?.data?.metadata?.order_id as string | undefined;
        const reference = payload?.data?.reference as string | undefined;
        if (!orderId && !reference) {
          return new Response("no order ref", { status: 400 });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const query = supabaseAdmin
          .from("tool_orders")
          .select("id, status, duration_days, grace_days");
        const { data: order } = orderId
          ? await query.eq("id", orderId).maybeSingle()
          : await query.eq("paystack_reference", reference!).maybeSingle();

        if (!order) return new Response("order not found", { status: 404 });
        if (order.status === "approved") return new Response("ok", { status: 200 });

        const paidAt = new Date();
        const dur = (order.duration_days as number) ?? 28;
        const grace = (order.grace_days as number) ?? 0;
        const expiresAt = new Date(paidAt.getTime() + (dur + grace) * 86400_000);

        await supabaseAdmin
          .from("tool_orders")
          .update({
            status: "approved",
            approved_at: paidAt.toISOString(),
            paid_at: paidAt.toISOString(),
            expires_at: expiresAt.toISOString(),
            paystack_reference: reference ?? null,
          })
          .eq("id", order.id);

        return new Response("ok", { status: 200 });
      },
    },
  },
});
