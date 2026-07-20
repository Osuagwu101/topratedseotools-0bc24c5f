/**
 * Pure Paystack webhook handler, extracted for testability.
 *
 * The TanStack route in `src/routes/api.public.webhooks.paystack.ts` is a
 * thin wrapper that injects `process.env.PAYSTACK_SECRET_KEY` and the real
 * `supabaseAdmin` client. Tests import this module directly and pass an
 * in-memory mock client with the same surface.
 *
 * Environment detection is strict:
 *   sk_test_* → "test"
 *   sk_live_* → "live"
 *   anything else → configuration failure (503, no DB writes)
 * The historical "legacy" value is only used for pre-existing DB rows.
 *
 * Processing statuses (unchanged): pending | processing | processed | failed | skipped
 */
import { createHash, createHmac, timingSafeEqual } from "crypto";

export type Env = "test" | "live";

export interface WebhookDeps {
  secret: string | undefined;
  supabaseAdmin: any;
}

export function detectEnvironmentStrict(secret: string): Env | null {
  if (secret.startsWith("sk_test_")) return "test";
  if (secret.startsWith("sk_live_")) return "live";
  return null;
}

export function buildIdempotencyKey(input: {
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

export async function handlePaystackWebhook(
  request: Request,
  deps: WebhookDeps,
): Promise<Response> {
  const { secret, supabaseAdmin } = deps;

  if (!secret) {
    console.error("[paystack-webhook] PAYSTACK_SECRET_KEY not configured");
    return new Response("not configured", { status: 503 });
  }

  const env = detectEnvironmentStrict(secret);
  if (!env) {
    // Unrecognised secret-key prefix — do NOT record, do NOT process, do NOT
    // touch orders. Log a safe server configuration error and surface 503.
    console.error(
      "[paystack-webhook] server configuration error: unrecognised PAYSTACK_SECRET_KEY prefix",
    );
    return new Response("server configuration error", { status: 503 });
  }

  // --- 1. Signature verification ---
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

  if (eventType !== "charge.success") {
    return new Response("ignored", { status: 200 });
  }

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
      return new Response("ok", { status: 200 });
    }

    if (existing.processing_status === "processing") {
      return new Response("ok", { status: 200 });
    }

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
    return new Response("ok", { status: 200 });
  }

  // --- 5. charge.success business logic ---
  try {
    const query = supabaseAdmin
      .from("tool_orders")
      .select("id, status, duration_days, grace_days");
    const { data: order } = orderId
      ? await query.eq("id", orderId).maybeSingle()
      : await query.eq("paystack_reference", reference!).maybeSingle();

    if (!order) {
      // Validly signed event but no matching order. Record it as failed for
      // Admin reconciliation and ACK with 200 so Paystack stops retrying.
      await supabaseAdmin
        .from("paystack_webhook_events")
        .update({
          processing_status: "failed",
          last_error: "No matching tool order found",
        })
        .eq("id", eventId);
      console.warn("[paystack-webhook] unknown order recorded for reconciliation", {
        key: idempotencyKey.slice(0, 12),
      });
      return new Response("ok", { status: 200 });
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
        .neq("status", "approved");
    }

    await supabaseAdmin
      .from("paystack_webhook_events")
      .update({
        processing_status: "processed",
        processed_at: new Date().toISOString(),
        last_error: null,
      })
      .eq("id", eventId);

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
}
