/**
 * Intercepts Custom Payment charge events before the normal tool-order webhook
 * pipeline. The selected gateway is persisted on the link and must match the
 * signed webhook source before a bill can be finalized.
 */
import {
  customPaymentMinorUnits,
  normalizeCustomPaymentCurrency,
  roundCustomPaymentAmount,
  type CustomPaymentGateway,
} from "@/lib/custom-payment-currency";
import type { GatewayAdapter } from "@/lib/gateways/types";

function metadataOf(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object") return value as Record<string, unknown>;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return {};
}

export async function tryHandleCustomPaymentWebhook(
  request: Request,
  deps: { gateway: CustomPaymentGateway; adapter: GatewayAdapter; supabaseAdmin: any },
): Promise<Response | null> {
  const raw = await request.text();
  let payload: any;
  try {
    payload = JSON.parse(raw);
  } catch {
    return null;
  }

  // Normalize first only to determine whether this event belongs to Custom
  // Payments. No value is trusted until the gateway signature is verified.
  const normalized = deps.adapter.normalizeWebhook(payload);
  if (!normalized) return null;
  const metadata = metadataOf(normalized.data.metadata);
  if (metadata.kind !== "custom_payment" || !metadata.custom_payment_link_id) return null;

  if (!deps.adapter.verifyWebhook(raw, request.headers)) {
    return new Response("invalid signature", { status: 401 });
  }

  const reference = String(normalized.data.reference ?? "");
  const linkId = String(metadata.custom_payment_link_id ?? "");
  if (!reference || !linkId) return new Response("bad custom payment event", { status: 400 });

  const admin = deps.supabaseAdmin as any;
  const { data: link } = await admin
    .from("custom_payment_links")
    .select("id, amount, amount_ngn, currency, payment_gateway, status, paid_reference")
    .eq("id", linkId)
    .maybeSingle();
  if (!link) return new Response("ok", { status: 200 });

  const linkGateway: CustomPaymentGateway =
    link.payment_gateway === "flutterwave" ? "flutterwave" : "paystack";
  if (linkGateway !== deps.gateway) {
    return new Response("gateway mismatch", { status: 400 });
  }

  const { data: attempt } = await admin
    .from("custom_payment_transactions")
    .select(
      "id, reference, merchant_reference, gateway_reference, payer_name, payer_email, payment_gateway, status",
    )
    .eq("link_id", link.id)
    .or(
      `merchant_reference.eq.${reference},gateway_reference.eq.${reference},reference.eq.${reference}`,
    )
    .maybeSingle();

  if (attempt?.payment_gateway && attempt.payment_gateway !== deps.gateway) {
    return new Response("gateway mismatch", { status: 400 });
  }

  if (normalized.event === "charge.failed") {
    if (attempt && attempt.status !== "successful") {
      await admin
        .from("custom_payment_transactions")
        .update({
          status: "failed",
          last_error: `${deps.gateway} charge.failed webhook`,
          updated_at: new Date().toISOString(),
        })
        .eq("id", attempt.id);
    }
    return new Response("ok", { status: 200 });
  }

  const currency = normalizeCustomPaymentCurrency(link.currency ?? "NGN");
  const amount = roundCustomPaymentAmount(Number(link.amount ?? link.amount_ngn), currency);
  const expectedMinor = customPaymentMinorUnits(amount, currency);
  const actualMinor = Number(normalized.data.amount ?? 0);
  const actualCurrency = String(normalized.data.currency ?? "").toUpperCase();
  if (actualMinor !== expectedMinor || actualCurrency !== currency) {
    if (attempt) {
      await admin
        .from("custom_payment_transactions")
        .update({
          status: "failed",
          last_error: "Webhook amount or currency mismatch",
          updated_at: new Date().toISOString(),
        })
        .eq("id", attempt.id);
    }
    return new Response("ok", { status: 200 });
  }

  // Gateway-authoritative re-verification before any finalization.
  let verifiedId: string | null = normalized.data.id == null ? null : String(normalized.data.id);
  let verifiedReference = reference;
  try {
    const verified =
      deps.gateway === "flutterwave" &&
      verifiedId &&
      typeof deps.adapter.verifyByTransactionId === "function"
        ? await deps.adapter.verifyByTransactionId(verifiedId)
        : await deps.adapter.verify(reference);
    if (verified.status !== "success") return new Response("ok", { status: 200 });
    if (
      Number(verified.amount) !== expectedMinor ||
      String(verified.currency ?? "").toUpperCase() !== currency
    ) {
      return new Response("ok", { status: 200 });
    }
    const verifiedMeta = metadataOf(verified.metadata);
    if (String(verifiedMeta.custom_payment_link_id ?? "") !== String(link.id)) {
      return new Response("ok", { status: 200 });
    }
    verifiedId = verified.id == null ? verifiedId : String(verified.id);
    verifiedReference = String(verified.reference ?? reference);
  } catch {
    return new Response("verification unavailable", { status: 503 });
  }

  const rawData = payload?.data ?? {};
  const rawCustomer = rawData?.customer ?? {};
  const gatewayEnvironment = deps.adapter.environment() ?? "live";
  if (!attempt) {
    await admin.from("custom_payment_transactions").insert({
      link_id: link.id,
      reference,
      merchant_reference: deps.gateway === "flutterwave" ? verifiedReference : reference,
      gateway_reference: deps.gateway === "paystack" ? reference : null,
      amount,
      amount_ngn: currency === "NGN" ? amount : null,
      currency,
      payer_name: rawCustomer?.name ?? null,
      payer_email: String(rawCustomer?.email ?? "unknown@topratedseotools.com"),
      payment_gateway: deps.gateway,
      gateway_environment: gatewayEnvironment,
      paystack_environment: gatewayEnvironment,
      gateway_transaction_id: normalized.data.id == null ? null : String(normalized.data.id),
      status: "initiated",
    });
  }

  const { data: currentAttempt } = await admin
    .from("custom_payment_transactions")
    .select("payer_name, payer_email, merchant_reference, reference")
    .eq("link_id", link.id)
    .or(
      `merchant_reference.eq.${reference},gateway_reference.eq.${reference},reference.eq.${reference}`,
    )
    .maybeSingle();

  const paidAtRaw = rawData?.paid_at ?? rawData?.created_at;
  const paidAt = paidAtRaw ? new Date(paidAtRaw).toISOString() : new Date().toISOString();
  const { error } = await admin.rpc("finalize_custom_payment_v2", {
    _link_id: link.id,
    _merchant_reference: String(
      currentAttempt?.merchant_reference ?? currentAttempt?.reference ?? verifiedReference,
    ),
    _gateway_reference: deps.gateway === "paystack" ? reference : null,
    _gateway_transaction_id: verifiedId,
    _payer_name: currentAttempt?.payer_name ?? rawCustomer?.name ?? null,
    _payer_email: currentAttempt?.payer_email ?? String(rawCustomer?.email ?? ""),
    _paid_at: paidAt,
  });

  if (error) return new Response("processing failed", { status: 500 });
  return new Response("ok", { status: 200 });
}

/** Backward-compatible name for any older imports during the rollout. */
export async function tryHandleCustomPaystackWebhook(
  request: Request,
  deps: { secret?: string; supabaseAdmin: any },
): Promise<Response | null> {
  const { paystackAdapter } = await import("@/lib/gateways/paystack");
  return tryHandleCustomPaymentWebhook(request, {
    gateway: "paystack",
    adapter: paystackAdapter,
    supabaseAdmin: deps.supabaseAdmin,
  });
}
