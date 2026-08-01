/**
 * Flutterwave adapter (v3 Standard checkout).
 *
 * Secrets: FLUTTERWAVE_SECRET_KEY (required), FLUTTERWAVE_WEBHOOK_HASH
 * (required for webhooks), FLUTTERWAVE_PUBLIC_KEY / FLUTTERWAVE_ENCRYPTION_KEY
 * (kept for client-side or encrypted-charge flows).
 *
 * Flutterwave works in MAJOR currency units, so amounts are converted at the
 * boundary — the rest of the platform keeps using minor units.
 */
import type {
  GatewayAdapter,
  GatewayInitInput,
  GatewayInitResult,
  GatewayTransaction,
  GatewayWebhookEvent,
} from "./types";
import { majorToMinor, minorToMajor } from "./types";

const BASE = "https://api.flutterwave.com/v3";

function secret(): string {
  const k = process.env.FLUTTERWAVE_SECRET_KEY;
  if (!k) throw new Error("Flutterwave is not configured yet. Contact support.");
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
  const text = await res.text();
  let json: { status?: string; message?: string; data?: T } = {};
  try {
    json = JSON.parse(text) as typeof json;
  } catch {
    throw new Error(`Flutterwave error (${res.status}): ${text.slice(0, 200)}`);
  }
  if (!res.ok || json.status !== "success" || !json.data) {
    throw new Error(json.message || `Flutterwave error (${res.status})`);
  }
  return json.data;
}

function mapStatus(raw: string | undefined): GatewayTransaction["status"] {
  const s = String(raw ?? "").toLowerCase();
  if (s === "successful" || s === "success" || s === "completed") return "success";
  if (s === "failed" || s === "cancelled" || s === "reversed") return "failed";
  return "pending";
}

export const flutterwaveAdapter: GatewayAdapter = {
  slug: "flutterwave",
  displayName: "Flutterwave",
  // Recurring is handled by our own renewal flow; Flutterwave charges one-time.
  supportsRecurring: false,

  isConfigured() {
    return !!process.env.FLUTTERWAVE_SECRET_KEY;
  },

  environment() {
    const k = process.env.FLUTTERWAVE_SECRET_KEY;
    if (!k) return null;
    return /test/i.test(k) ? "test" : "live";
  },

  async initialize(input: GatewayInitInput): Promise<GatewayInitResult> {
    const data = await api<{ link: string }>("/payments", {
      method: "POST",
      body: JSON.stringify({
        tx_ref: input.reference,
        amount: minorToMajor(input.amountMinor),
        currency: input.currency,
        redirect_url: input.callbackUrl,
        payment_options: "card,banktransfer,ussd,mobilemoneyghana,mpesa,account",
        customer: {
          email: input.email,
          name: input.customerName ?? undefined,
        },
        customizations: {
          title: "Top Rated SEO Tools",
          description: input.description ?? "Tool access",
        },
        meta: input.metadata,
      }),
    });
    return {
      authorization_url: data.link,
      reference: input.reference,
      gateway_reference: null,
      raw: data,
    };
  },

  async verify(reference: string): Promise<GatewayTransaction> {
    const tx = await api<{
      id?: number;
      tx_ref: string;
      status: string;
      amount: number;
      charged_amount?: number;
      currency: string;
      payment_type?: string;
      created_at?: string;
      meta?: Record<string, unknown>;
      customer?: { email?: string };
    }>(`/transactions/verify_by_reference?tx_ref=${encodeURIComponent(reference)}`);
    return {
      status: mapStatus(tx.status),
      reference: tx.tx_ref ?? reference,
      amount: majorToMinor(tx.amount),
      currency: (tx.currency ?? "NGN").toUpperCase(),
      metadata: (tx.meta ?? {}) as GatewayTransaction["metadata"],
      customer: tx.customer?.email ? { email: tx.customer.email } : undefined,
      channel: tx.payment_type ?? null,
      id: tx.id ?? null,
      paid_at: tx.created_at ?? null,
      raw: tx,
    };
  },

  verifyWebhook(_raw: string, headers: Headers): boolean {
    const hash = process.env.FLUTTERWAVE_WEBHOOK_HASH;
    if (!hash) return false;
    const got = headers.get("verif-hash") ?? "";
    // Flutterwave sends the shared secret verbatim (not an HMAC).
    return got.length === hash.length && got === hash;
  },

  normalizeWebhook(payload: unknown): GatewayWebhookEvent | null {
    const p = payload as
      | {
          event?: string;
          data?: {
            tx_ref?: string;
            status?: string;
            amount?: number;
            currency?: string;
            meta?: Record<string, unknown>;
            payment_type?: string;
            id?: number;
          };
        }
      | null;
    const d = p?.data;
    if (!d?.tx_ref) return null;
    const status = mapStatus(d.status);
    if (status === "pending") return null;
    return {
      event: status === "success" ? "charge.success" : "charge.failed",
      data: {
        reference: d.tx_ref,
        status: status === "success" ? "success" : "failed",
        amount: majorToMinor(Number(d.amount ?? 0)),
        currency: String(d.currency ?? "NGN").toUpperCase(),
        metadata: d.meta ?? {},
        channel: d.payment_type ?? null,
        id: d.id ?? null,
        customer: undefined,
      },
    };
  },
};
