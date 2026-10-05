import {
  TURNITIN_CREDIT_UNIT_PRICE_NGN,
  turnitinCreditTotalNgn,
} from "@/lib/turnitin-pricing";
import { majorToMinor, type GatewayAdapter, type GatewaySlug } from "@/lib/gateways/types";

function metadataOf(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object") {
    return value as Record<string, unknown>;
  }
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

function isTurnitinCreditMetadata(metadata: Record<string, unknown>): boolean {
  return (
    metadata.kind === "turnitin_credit_purchase" &&
    typeof metadata.turnitin_purchase_id === "string"
  );
}

export async function tryHandleTurnitinCreditWebhook(
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
  if (!isTurnitinCreditMetadata(metadata)) return null;

  if (!deps.adapter.verifyWebhook(raw, request.headers)) {
    return new Response("invalid signature", { status: 401 });
  }

  const purchaseId = String(metadata.turnitin_purchase_id);
  const admin = deps.supabaseAdmin as any;

  const { data: purchase, error } = await admin
    .from("turnitin_credit_purchases")
    .select(
      "id, user_id, quantity, unit_amount_ngn, total_amount_ngn, status, payment_gateway, payment_reference, gateway_transaction_id",
    )
    .eq("id", purchaseId)
    .maybeSingle();

  if (error) return new Response("processing failed", { status: 500 });
  if (!purchase) return new Response("ok", { status: 200 });

  if (purchase.payment_gateway !== deps.gateway) {
    return new Response("gateway mismatch", { status: 400 });
  }

  if (normalized.event === "charge.failed") {
    if (purchase.status !== "paid") {
      await admin
        .from("turnitin_credit_purchases")
        .update({
          status: "failed",
          verified_at: new Date().toISOString(),
          last_error: `${deps.gateway} charge.failed webhook`,
        })
        .eq("id", purchase.id)
        .neq("status", "paid");
    }
    return new Response("ok", { status: 200 });
  }

  const expectedMinor = majorToMinor(
    turnitinCreditTotalNgn(Number(purchase.quantity)),
  );
  if (
    Number(normalized.data.amount) !== expectedMinor ||
    String(normalized.data.currency ?? "").toUpperCase() !== "NGN"
  ) {
    await admin
      .from("turnitin_credit_purchases")
      .update({
        last_error: "Webhook amount or currency mismatch.",
        verified_at: new Date().toISOString(),
      })
      .eq("id", purchase.id)
      .neq("status", "paid");
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
  if (
    !isTurnitinCreditMetadata(verifiedMetadata) ||
    String(verifiedMetadata.turnitin_purchase_id) !== String(purchase.id) ||
    String(verifiedMetadata.user_id ?? "") !== String(purchase.user_id) ||
    Number(verifiedMetadata.quantity) !== Number(purchase.quantity) ||
    Number(verifiedMetadata.unit_amount_ngn) !==
      TURNITIN_CREDIT_UNIT_PRICE_NGN ||
    Number(verified.amount) !== expectedMinor ||
    String(verified.currency ?? "").toUpperCase() !== "NGN"
  ) {
    await admin
      .from("turnitin_credit_purchases")
      .update({
        last_error: "Authoritative gateway verification mismatch.",
        verified_at: new Date().toISOString(),
      })
      .eq("id", purchase.id)
      .neq("status", "paid");
    return new Response("ok", { status: 200 });
  }

  const purchaseReference = String(purchase.payment_reference ?? "");
  if (!purchaseReference) {
    return new Response("purchase reference missing", { status: 500 });
  }

  const { error: finalizeError } = await admin.rpc(
    "turnitin_finalize_credit_purchase",
    {
      _purchase_id: purchase.id,
      _reference: purchaseReference,
      _gateway_transaction_id:
        verified.id == null ? null : String(verified.id),
      _paid_at: verified.paid_at ?? new Date().toISOString(),
    },
  );

  if (finalizeError) {
    return new Response("processing failed", { status: 500 });
  }

  return new Response("ok", { status: 200 });
}
