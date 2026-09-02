/**
 * Paystack adapter — wraps the existing, unchanged Paystack behaviour behind
 * the shared gateway interface. Secrets: PAYSTACK_SECRET_KEY.
 */
import { createHmac, timingSafeEqual } from "crypto";
import type {
  GatewayAdapter,
  GatewayInitInput,
  GatewayInitResult,
  GatewayTransaction,
  GatewayWebhookEvent,
} from "./types";
import { GATEWAY_METADATA } from "./metadata";

const BASE = "https://api.paystack.co";

function secret(): string {
  const k = process.env.PAYSTACK_SECRET_KEY;
  if (!k) throw new Error("Payments are not configured yet. Contact support.");
  return k;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${secret()}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const json = (await res.json()) as { status: boolean; message: string; data: T };
  if (!res.ok || !json.status) throw new Error(json.message || `Paystack error (${res.status})`);
  return json.data;
}

function mapStatus(raw: string | undefined): GatewayTransaction["status"] {
  const s = String(raw ?? "").toLowerCase();
  if (s === "success" || s === "successful") return "success";
  if (s === "failed" || s === "reversed" || s === "abandoned") return "failed";
  return "pending";
}

export const paystackAdapter: GatewayAdapter = {
  ...GATEWAY_METADATA.paystack,

  isConfigured() {
    return !!process.env.PAYSTACK_SECRET_KEY;
  },

  environment() {
    const k = process.env.PAYSTACK_SECRET_KEY;
    if (!k) return null;
    if (k.startsWith("sk_test_")) return "test";
    if (k.startsWith("sk_live_")) return "live";
    return null;
  },

  async initialize(input: GatewayInitInput): Promise<GatewayInitResult> {
    const body: Record<string, unknown> = {
      email: input.email,
      amount: input.amountMinor,
      currency: input.currency,
      callback_url: input.callbackUrl,
      metadata: input.metadata,
      ...(input.gatewayGeneratedReference ? {} : { reference: input.reference }),
      ...(input.extra ?? {}),
    };
    const data = await api<{ authorization_url: string; access_code: string; reference: string }>(
      "/transaction/initialize",
      { method: "POST", body: JSON.stringify(body) },
    );
    return {
      authorization_url: data.authorization_url,
      reference: data.reference,
      gateway_reference: data.access_code ?? null,
      raw: data,
    };
  },

  async verify(reference: string): Promise<GatewayTransaction> {
    const tx = await api<{
      status: string;
      reference: string;
      amount: number;
      currency: string;
      metadata?: Record<string, unknown>;
      customer?: { customer_code?: string; email?: string };
      channel?: string;
      id?: number | string;
      paid_at?: string;
    }>(`/transaction/verify/${encodeURIComponent(reference)}`);
    return {
      status: mapStatus(tx.status),
      reference: tx.reference,
      amount: tx.amount,
      currency: (tx.currency ?? "NGN").toUpperCase(),
      metadata: tx.metadata as GatewayTransaction["metadata"],
      customer: tx.customer,
      channel: tx.channel ?? null,
      id: tx.id ?? null,
      paid_at: tx.paid_at ?? null,
      raw: tx,
    };
  },

  verifyWebhook(raw: string, headers: Headers): boolean {
    const sig = headers.get("x-paystack-signature") ?? "";
    const expected = createHmac("sha512", secret()).update(raw).digest("hex");
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  },

  normalizeWebhook(payload: unknown): GatewayWebhookEvent | null {
    const p = payload as { event?: string; data?: Record<string, unknown> } | null;
    if (!p?.event || !p.data) return null;
    if (p.event !== "charge.success" && p.event !== "charge.failed") return null;
    const d = p.data as Record<string, unknown>;
    return {
      event: p.event,
      data: {
        reference: String(d.reference ?? ""),
        status: String(d.status ?? ""),
        amount: Number(d.amount ?? 0),
        currency: String(d.currency ?? "NGN").toUpperCase(),
        metadata: (d.metadata as Record<string, unknown>) ?? {},
        channel: (d.channel as string) ?? null,
        id: (d.id as string | number) ?? null,
        customer: d.customer as { customer_code?: string } | undefined,
      },
    };
  },
};
