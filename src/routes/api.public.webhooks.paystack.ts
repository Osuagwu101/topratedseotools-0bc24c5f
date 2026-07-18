/**
 * Paystack webhook — external endpoint at `/api/public/webhooks/paystack`.
 *
 * Phase 1C: idempotent processing via `paystack_webhook_events`.
 *
 *  1. Verify HMAC-SHA512 signature over the raw body (unchanged).
 *  2. Compute a deterministic idempotency key from event type, environment,
 *     transaction reference, and final tx status.
 *  3. Atomically claim the event by inserting `paystack_webhook_events` on
 *     the unique `idempotency_key`. If a prior row is already `processed`
 *     or currently `processing`, exit early (duplicate/concurrent).
 *  4. Run existing `charge.success` order approval, then mark `processed`.
 *  5. On failure, mark `failed` with a safe error and let Paystack retry.
 *
 * Status mapping to the DB check constraint:
 *   received          → 'pending'
 *   processing        → 'processing'
 *   processed         → 'processed'
 *   failed            → 'failed'
 *   ignored_duplicate → 'skipped'
 */
import { createFileRoute } from "@tanstack/react-router";
import { createHash, createHmac, timingSafeEqual } from "crypto";

type Env = "test" | "live" | "legacy";

function detectEnvironment(secret: string): Env {
  if (secret.startsWith("sk_test_")) return "test";
  if (secret.startsWith("sk_live_")) return "live";
  return "legacy";
}

function buildIdempotencyKey(input: {
  event: string;
  env: Env;
  reference: string;
  status: string;
}): string {
  const raw = `${input.event}:${input.env}:${input.reference}:${input.status}`;
  return createHash("sha256").update(raw).digest("hex");
}

function safeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.slice(0, 500);
}

export const Route = createFileRoute("/api/public/webhooks/paystack")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.PAYSTACK_SECRET_KEY;
        if (!secret) return new Response("not configured", { status: 503 });

        // --- 1. Signature verification (unchanged) ---
        const signature = request.headers.get("x-paystack-signature") ?? "";
        const raw = await request.text();
        const expected = createHmac("sha512", secret).update(raw).digest("hex");

        const sig = Buffer.from(signature);
        const exp = Buffer.from(expected);
        if (sig.length !== exp.length || !timingSafeEqual(sig, exp)) {
          console.warn("[paystack-webhook] invalid signature rejected");
          return new Response("invalid signature", { status: 401 });
        }

        let payload: any;
        try {
          payload = JSON.parse(raw);
        } catch {
          return new Response("bad json", { status: 400 });
        }

        const eventType: string = payload?.event ?? "";

        // Only charge.success is handled in this phase. Other events are
        // acknowledged without being recorded (recurring events belong to
        // a later phase).
        if (eventType !== "charge.success") {
          return new Response("ignored", { status: 200 });
        }

        const env = detectEnvironment(secret);
        const reference: string | undefined = payload?.data?.reference;
        const txStatus: string = payload?.data?.status ?? "unknown";
        const orderId: string | undefined = payload?.data?.metadata?.order_id;

        if (!reference && !orderId) {
          return new Response("no order ref", { status: 400 });
        }

        const idempotencyKey = buildIdempotencyKey({
          event: eventType,
          env,
          reference: reference ?? `order:${orderId}`,
          status: txStatus,
        });

        const payloadHash = createHash("sha256").update(raw).digest("hex");

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // --- 3. Atomic claim on unique idempotency_key ---
        const insertRes = await supabaseAdmin
          .from("paystack_webhook_events")
          .insert({
            idempotency_key: idempotencyKey,
            event_type: eventType,
            transaction_reference: reference ?? null,
            paystack_environment: env,
            processing_status: "pending",
            payload_hash: payloadHash,
          })
          .select("id, processing_status")
          .maybeSingle();

        let eventId: string | null = insertRes.data?.id ?? null;

        if (insertRes.error) {
          // Unique-violation → an event with this key already exists.
          // Load it and decide whether to skip or retry.
          const { data: existing } = await supabaseAdmin
            .from("paystack_webhook_events")
            .select("id, processing_status, processing_attempts")
            .eq("idempotency_key", idempotencyKey)
            .maybeSingle();

          if (!existing) {
            console.error("[paystack-webhook] insert failed", safeError(insertRes.error));
            return new Response("db error", { status: 500 });
          }

          if (
            existing.processing_status === "processed" ||
            existing.processing_status === "skipped"
          ) {
            console.info("[paystack-webhook] duplicate ignored", {
              key: idempotencyKey.slice(0, 12),
              status: existing.processing_status,
            });
            return new Response("ok", { status: 200 });
          }

          if (existing.processing_status === "processing") {
            // Concurrent duplicate — the other request is running the
            // approval logic. Exit safely; Paystack will retry if needed.
            console.info("[paystack-webhook] concurrent duplicate skipped", {
              key: idempotencyKey.slice(0, 12),
            });
            return new Response("ok", { status: 200 });
          }

          // status is 'pending' or 'failed' → allow retry
          eventId = existing.id;
        }

        if (!eventId) {
          return new Response("db error", { status: 500 });
        }

        // --- 4. Claim as processing (atomic transition from pending/failed) ---
        const { data: current } = await supabaseAdmin
          .from("paystack_webhook_events")
          .select("processing_attempts")
          .eq("id", eventId)
          .maybeSingle();
        const nextAttempts = ((current?.processing_attempts as number) ?? 0) + 1;

        const { data: claimed, error: claimError } = await supabaseAdmin
          .from("paystack_webhook_events")
          .update({
            processing_status: "processing",
            processing_attempts: nextAttempts,
          })
          .eq("id", eventId)
          .in("processing_status", ["pending", "failed"])
          .select("id")
          .maybeSingle();

        if (claimError || !claimed) {
          console.info("[paystack-webhook] claim lost", {
            key: idempotencyKey.slice(0, 12),
          });
          return new Response("ok", { status: 200 });
        }

        // --- 5. Preserved charge.success business logic ---
        try {
          const query = supabaseAdmin
            .from("tool_orders")
            .select("id, status, duration_days, grace_days");
          const { data: order } = orderId
            ? await query.eq("id", orderId).maybeSingle()
            : await query.eq("paystack_reference", reference!).maybeSingle();

          if (!order) {
            await supabaseAdmin
              .from("paystack_webhook_events")
              .update({
                processing_status: "failed",
                last_error: "No matching tool order found",
              })
              .eq("id", eventId);
            console.warn("[paystack-webhook] unknown order", {
              key: idempotencyKey.slice(0, 12),
            });
            return new Response("order not found", { status: 404 });
          }

          if (order.status !== "approved") {
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
              .eq("id", order.id)
              .neq("status", "approved"); // second safety layer
          }

          await supabaseAdmin
            .from("paystack_webhook_events")
            .update({
              processing_status: "processed",
              processed_at: new Date().toISOString(),
              last_error: null,
            })
            .eq("id", eventId);

          console.info("[paystack-webhook] processed", {
            key: idempotencyKey.slice(0, 12),
          });
          return new Response("ok", { status: 200 });
        } catch (err) {
          await supabaseAdmin
            .from("paystack_webhook_events")
            .update({
              processing_status: "failed",
              last_error: safeError(err),
            })
            .eq("id", eventId);
          console.error("[paystack-webhook] processing failed", {
            key: idempotencyKey.slice(0, 12),
            error: safeError(err),
          });
          return new Response("processing failed", { status: 500 });
        }
      },
    },
  },
});
