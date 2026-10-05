import { majorToMinor, type GatewayAdapter, type GatewaySlug } from "@/lib/gateways/types";

function metadataOf(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object") return value as Record<string, unknown>;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object"
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  return {};
}

function isSettlementMetadata(metadata: Record<string, unknown>): boolean {
  return (
    metadata.kind === "turnitin_postpaid_settlement" &&
    typeof metadata.turnitin_settlement_id === "string"
  );
}

export async function tryHandleTurnitinPostpaidSettlementWebhook(
  request: Request,
  deps: {
    gateway: GatewaySlug;
    adapter: GatewayAdapter;
    supabaseAdmin: any;
  },
): Promise<Response | null> {
  const raw = await request.text();
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return null;
  }

  const normalized = deps.adapter.normalizeWebhook(payload);
  if (!normalized) return null;

  const metadata = metadataOf(normalized.data.metadata);
  if (!isSettlementMetadata(metadata)) return null;

  if (!deps.adapter.verifyWebhook(raw, request.headers)) {
    return new Response("invalid signature", { status: 401 });
  }

  const admin = deps.supabaseAdmin as any;
  const settlementId = String(metadata.turnitin_settlement_id);

  const { data: settlement, error } = await admin
    .from("turnitin_postpaid_settlements")
    .select(
      "id, user_id, amount_ngn, allocated_amount_ngn, method, status, payment_gateway, payment_reference, gateway_transaction_id",
    )
    .eq("id", settlementId)
    .maybeSingle();

  if (error) return new Response("processing failed", { status: 500 });
  if (!settlement) return new Response("ok", { status: 200 });

  if (settlement.payment_gateway !== deps.gateway) {
    return new Response("gateway mismatch", { status: 400 });
  }

  if (normalized.event === "charge.failed") {
    if (settlement.status !== "confirmed") {
      await admin
        .from("turnitin_postpaid_settlements")
        .update({
          status: "failed",
          failed_at: new Date().toISOString(),
        })
        .eq("id", settlement.id)
        .neq("status", "confirmed");
    }
    return new Response("ok", { status: 200 });
  }

  let verified;
  try {
    const transactionId =
      normalized.data.id == null ? null : String(normalized.data.id);
    verified =
      transactionId && typeof deps.adapter.verifyByTransactionId === "function"
        ? await deps.adapter.verifyByTransactionId(transactionId)
        : await deps.adapter.verify(String(normalized.data.reference ?? ""));
  } catch {
    return new Response("verification unavailable", { status: 503 });
  }

  if (verified.status !== "success") {
    return new Response("ok", { status: 200 });
  }

  const verifiedMetadata = metadataOf(verified.metadata);
  const verifiedProductAmount =
    verified.requested_amount == null
      ? Number(verified.amount)
      : Number(verified.requested_amount);
  const expectedMinor = majorToMinor(Number(settlement.amount_ngn));

  if (
    !isSettlementMetadata(verifiedMetadata) ||
    String(verifiedMetadata.turnitin_settlement_id) !== String(settlement.id) ||
    String(verifiedMetadata.user_id ?? "") !== String(settlement.user_id) ||
    Number(verifiedMetadata.amount_ngn) !== Number(settlement.amount_ngn) ||
    String(verified.currency ?? "").toUpperCase() !== "NGN" ||
    verifiedProductAmount < expectedMinor
  ) {
    return new Response("verification mismatch", { status: 400 });
  }

  const { error: finalizeError } = await admin.rpc(
    "turnitin_finalize_postpaid_settlement",
    {
      _settlement_id: settlement.id,
      _reference: String(settlement.payment_reference),
      _gateway_transaction_id:
        verified.id == null
          ? settlement.gateway_transaction_id
          : String(verified.id),
      _paid_at: verified.paid_at ?? new Date().toISOString(),
    },
  );

  if (finalizeError) {
    return new Response("processing failed", { status: 500 });
  }

  return new Response("ok", { status: 200 });
}
