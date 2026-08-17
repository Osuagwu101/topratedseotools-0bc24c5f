/**
 * Intercepts Paystack charge events for Custom Payments before the normal
 * tool-order webhook pipeline. Returns null for ordinary tool payments.
 */
import { createHmac, timingSafeEqual } from "crypto";
import {
  customPaymentMinorUnits,
  normalizePaystackCurrency,
  roundCustomPaymentAmount,
} from "@/lib/custom-payment-currency";

function safeEqualHex(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

function metadataOf(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object") return value as Record<string, unknown>;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
  return {};
}

export async function tryHandleCustomPaystackWebhook(
  request: Request,
  deps: { secret: string | undefined; supabaseAdmin: any },
): Promise<Response | null> {
  const raw = await request.text();
  let payload: any;
  try {
    payload = JSON.parse(raw);
  } catch {
    return null;
  }

  const metadata = metadataOf(payload?.data?.metadata);
  if (metadata.kind !== "custom_payment" || !metadata.custom_payment_link_id) return null;

  const secret = deps.secret ?? "";
  if (!secret) return new Response("not configured", { status: 503 });
  const got = request.headers.get("x-paystack-signature") ?? "";
  const expected = createHmac("sha512", secret).update(raw).digest("hex");
  if (!safeEqualHex(got, expected)) return new Response("invalid signature", { status: 401 });

  const event = String(payload?.event ?? "");
  if (event !== "charge.success" && event !== "charge.failed") return new Response("ignored", { status: 200 });

  const data = payload?.data ?? {};
  const reference = String(data.reference ?? "");
  const linkId = String(metadata.custom_payment_link_id ?? "");
  if (!reference || !linkId) return new Response("bad custom payment event", { status: 400 });

  const admin = deps.supabaseAdmin as any;
  const { data: link } = await admin
    .from("custom_payment_links")
    .select("id, amount, amount_ngn, currency, status, paid_reference")
    .eq("id", linkId)
    .maybeSingle();
  if (!link) return new Response("ok", { status: 200 });

  const { data: attempt } = await admin
    .from("custom_payment_transactions")
    .select("id, reference, payer_name, payer_email, status")
    .eq("link_id", link.id)
    .eq("reference", reference)
    .maybeSingle();

  if (event === "charge.failed") {
    if (attempt && attempt.status !== "successful") {
      await admin
        .from("custom_payment_transactions")
        .update({ status: "failed", last_error: "charge.failed webhook", updated_at: new Date().toISOString() })
        .eq("id", attempt.id);
    }
    return new Response("ok", { status: 200 });
  }

  const currency = normalizePaystackCurrency(link.currency ?? "NGN");
  const amount = roundCustomPaymentAmount(Number(link.amount ?? link.amount_ngn), currency);
  const expectedMinor = customPaymentMinorUnits(amount, currency);
  const actualMinor = Number(data.amount ?? 0);
  const actualCurrency = String(data.currency ?? "").toUpperCase();
  if (actualMinor !== expectedMinor || actualCurrency !== currency) {
    if (attempt) {
      await admin
        .from("custom_payment_transactions")
        .update({ status: "failed", last_error: "Webhook amount or currency mismatch", updated_at: new Date().toISOString() })
        .eq("id", attempt.id);
    }
    return new Response("ok", { status: 200 });
  }

  if (!attempt) {
    const email = String(data?.customer?.email ?? "unknown@paystack.local");
    await admin.from("custom_payment_transactions").insert({
      link_id: link.id,
      reference,
      amount,
      amount_ngn: currency === "NGN" ? amount : null,
      currency,
      payer_name: null,
      payer_email: email,
      payment_gateway: "paystack",
      paystack_environment: secret.startsWith("sk_test_") ? "test" : "live",
      gateway_transaction_id: data.id == null ? null : String(data.id),
      status: "initiated",
    });
  }

  const { data: currentAttempt } = await admin
    .from("custom_payment_transactions")
    .select("payer_name, payer_email")
    .eq("link_id", link.id)
    .eq("reference", reference)
    .maybeSingle();

  const paidAt = data.paid_at ? new Date(data.paid_at).toISOString() : new Date().toISOString();
  const { error } = await admin.rpc("finalize_custom_payment", {
    _link_id: link.id,
    _reference: reference,
    _gateway_transaction_id: data.id == null ? null : String(data.id),
    _payer_name: currentAttempt?.payer_name ?? null,
    _payer_email: currentAttempt?.payer_email ?? String(data?.customer?.email ?? ""),
    _paid_at: paidAt,
  });

  if (error) return new Response("processing failed", { status: 500 });
  return new Response("ok", { status: 200 });
}
