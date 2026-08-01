/**
 * Monnify adapter (bank transfer, card, USSD, account transfer).
 *
 * Secrets: MONNIFY_API_KEY, MONNIFY_SECRET_KEY. Contract code and base URL
 * come from the admin-managed provider config (payment_providers.config).
 *
 * Monnify works in MAJOR currency units, converted at the boundary.
 */
import { createHmac, timingSafeEqual } from "crypto";
import type {
  GatewayAdapter,
  GatewayConfig,
  GatewayInitInput,
  GatewayInitResult,
  GatewayTransaction,
  GatewayWebhookEvent,
} from "./types";
import { majorToMinor, minorToMajor } from "./types";

const DEFAULT_BASE = "https://api.monnify.com";

function creds() {
  const apiKey = process.env.MONNIFY_API_KEY;
  const secretKey = process.env.MONNIFY_SECRET_KEY;
  if (!apiKey || !secretKey) throw new Error("Monnify is not configured yet. Contact support.");
  return { apiKey, secretKey };
}

function mapStatus(raw: string | undefined): GatewayTransaction["status"] {
  const s = String(raw ?? "").toUpperCase();
  if (s === "PAID" || s === "SUCCESS" || s === "SUCCESSFUL" || s === "COMPLETED") return "success";
  if (s === "FAILED" || s === "CANCELLED" || s === "EXPIRED" || s === "REVERSED") return "failed";
  return "pending";
}

export function createMonnifyAdapter(config: GatewayConfig = {}): GatewayAdapter {
  const base = (config.base_url as string) || DEFAULT_BASE;
  const contractCode = (config.contract_code as string) || process.env.MONNIFY_CONTRACT_CODE || "";

  async function token(): Promise<string> {
    const { apiKey, secretKey } = creds();
    const basic = Buffer.from(`${apiKey}:${secretKey}`).toString("base64");
    const res = await fetch(`${base}/api/v1/auth/login`, {
      method: "POST",
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/json" },
    });
    const json = (await res.json()) as {
      requestSuccessful?: boolean;
      responseMessage?: string;
      responseBody?: { accessToken?: string };
    };
    const t = json.responseBody?.accessToken;
    if (!res.ok || !json.requestSuccessful || !t) {
      throw new Error(json.responseMessage || `Monnify auth error (${res.status})`);
    }
    return t;
  }

  async function api<T>(path: string, init?: RequestInit): Promise<T> {
    const bearer = await token();
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${bearer}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
    const json = (await res.json()) as {
      requestSuccessful?: boolean;
      responseMessage?: string;
      responseBody?: T;
    };
    if (!res.ok || !json.requestSuccessful || !json.responseBody) {
      throw new Error(json.responseMessage || `Monnify error (${res.status})`);
    }
    return json.responseBody;
  }

  return {
    slug: "monnify",
    displayName: "Monnify",
    supportsRecurring: false,
    chargeCurrencies: ["NGN"],

    isConfigured() {
      return !!process.env.MONNIFY_API_KEY && !!process.env.MONNIFY_SECRET_KEY && !!contractCode;
    },

    environment() {
      const k = process.env.MONNIFY_API_KEY;
      if (!k) return null;
      return /sandbox|test/i.test(`${k}${base}`) ? "test" : "live";
    },

    async initialize(input: GatewayInitInput): Promise<GatewayInitResult> {
      if (!contractCode) throw new Error("Monnify contract code is not configured.");
      const data = await api<{ checkoutUrl: string; transactionReference: string; paymentReference: string }>(
        "/api/v1/merchant/transactions/init-transaction",
        {
          method: "POST",
          body: JSON.stringify({
            amount: minorToMajor(input.amountMinor),
            customerName: input.customerName || input.email,
            customerEmail: input.email,
            paymentReference: input.reference,
            paymentDescription: (input.description ?? "Tool access").slice(0, 60),
            currencyCode: input.currency,
            contractCode,
            redirectUrl: input.callbackUrl,
            paymentMethods: ["CARD", "ACCOUNT_TRANSFER", "USSD", "PHONE_NUMBER"],
            metaData: input.metadata,
          }),
        },
      );
      return {
        authorization_url: data.checkoutUrl,
        reference: input.reference,
        gateway_reference: data.transactionReference ?? null,
        raw: data,
      };
    },

    async verify(reference: string): Promise<GatewayTransaction> {
      const tx = await api<{
        paymentStatus?: string;
        amountPaid?: number;
        amount?: number;
        currencyCode?: string;
        currency?: string;
        paymentReference?: string;
        transactionReference?: string;
        paymentMethod?: string;
        paidOn?: string;
        metaData?: Record<string, unknown>;
        customer?: { email?: string };
      }>(`/api/v2/merchant/transactions/query?paymentReference=${encodeURIComponent(reference)}`);
      return {
        status: mapStatus(tx.paymentStatus),
        reference: tx.paymentReference ?? reference,
        amount: majorToMinor(Number(tx.amountPaid ?? tx.amount ?? 0)),
        currency: String(tx.currencyCode ?? tx.currency ?? "NGN").toUpperCase(),
        metadata: (tx.metaData ?? {}) as GatewayTransaction["metadata"],
        customer: tx.customer?.email ? { email: tx.customer.email } : undefined,
        channel: tx.paymentMethod ?? null,
        id: tx.transactionReference ?? null,
        paid_at: tx.paidOn ?? null,
        raw: tx,
      };
    },

    verifyWebhook(raw: string, headers: Headers): boolean {
      const secretKey = process.env.MONNIFY_SECRET_KEY;
      if (!secretKey) return false;
      const got = headers.get("monnify-signature") ?? "";
      const expected = createHmac("sha512", secretKey).update(raw).digest("hex");
      const a = Buffer.from(got);
      const b = Buffer.from(expected);
      return a.length === b.length && timingSafeEqual(a, b);
    },

    normalizeWebhook(payload: unknown): GatewayWebhookEvent | null {
      const p = payload as
        | {
            eventType?: string;
            eventData?: {
              paymentReference?: string;
              paymentStatus?: string;
              amountPaid?: number;
              currency?: string;
              currencyCode?: string;
              metaData?: Record<string, unknown>;
              paymentMethod?: string;
              transactionReference?: string;
            };
          }
        | null;
      const d = p?.eventData;
      if (!d?.paymentReference) return null;
      const type = String(p?.eventType ?? "").toUpperCase();
      const status =
        type === "SUCCESSFUL_TRANSACTION" ? "success" : mapStatus(d.paymentStatus);
      if (status === "pending") return null;
      return {
        event: status === "success" ? "charge.success" : "charge.failed",
        data: {
          reference: d.paymentReference,
          status: status === "success" ? "success" : "failed",
          amount: majorToMinor(Number(d.amountPaid ?? 0)),
          currency: String(d.currencyCode ?? d.currency ?? "NGN").toUpperCase(),
          metadata: d.metaData ?? {},
          channel: d.paymentMethod ?? null,
          id: d.transactionReference ?? null,
          customer: undefined,
        },
      };
    },
  };
}
