/**
 * Unified payment-gateway abstraction.
 *
 * Every gateway (Paystack, Flutterwave, Monnify) implements the same three
 * actions — initialize, verify, and webhook normalisation — so the pricing,
 * coupon, currency, order, access-assignment and email pipelines never need
 * to know which gateway processed a payment.
 *
 * Money crosses this boundary in MINOR units (kobo/cents) exactly like
 * Paystack, so the existing verification maths is unchanged.
 */

export type GatewaySlug = "paystack" | "flutterwave" | "monnify";

export const GATEWAY_SLUGS: GatewaySlug[] = ["paystack", "flutterwave", "monnify"];

export function isGatewaySlug(x: unknown): x is GatewaySlug {
  return typeof x === "string" && (GATEWAY_SLUGS as string[]).includes(x);
}

export interface GatewayInitInput {
  /** Our own canonical reference — stored on the order and payment rows. */
  reference: string;
  amountMinor: number;
  currency: string;
  email: string;
  callbackUrl: string;
  customerName?: string | null;
  description?: string | null;
  metadata: Record<string, unknown>;
  /** Gateway-specific extras (e.g. Paystack `plan` / `channels`). */
  extra?: Record<string, unknown>;
  /**
   * When true, the gateway is asked to generate its own transaction reference
   * instead of echoing ours (Paystack Custom Payments). `reference` is then
   * treated purely as an internal merchant correlation key.
   */
  gatewayGeneratedReference?: boolean;
}

export interface GatewayInitResult {
  authorization_url: string;
  /** Our reference, echoed back by the gateway when it supports it. */
  reference: string;
  /** The gateway's own transaction id/reference, when issued at init time. */
  gateway_reference: string | null;
  raw: unknown;
}

/** Paystack-shaped normalised transaction — amount is in minor units. */
export interface GatewayTransaction {
  status: "success" | "failed" | "pending";
  reference: string;
  amount: number;
  currency: string;
  metadata?: { order_id?: string; user_id?: string } & Record<string, unknown>;
  customer?: { customer_code?: string; email?: string } | undefined;
  channel?: string | null;
  id?: string | number | null;
  paid_at?: string | null;
  raw: unknown;
}

export interface GatewayWebhookEvent {
  /** Mapped onto the Paystack event vocabulary the pipeline already handles. */
  event: "charge.success" | "charge.failed";
  data: {
    reference: string;
    status: string;
    amount: number;
    currency: string;
    metadata?: Record<string, unknown>;
    channel?: string | null;
    id?: string | number | null;
    customer?: { customer_code?: string } | undefined;
  };
}

export interface GatewayAdapter {
  slug: GatewaySlug;
  displayName: string;
  supportsRecurring: boolean;
  /**
   * Currencies this gateway can actually charge. When omitted, the currencies
   * configured on `currency_settings.merchant_currencies` are used instead.
   */
  chargeCurrencies?: string[];
  /** True when every secret/credential this gateway needs is present. */
  isConfigured(): boolean;
  /** Which environment the configured secret belongs to. */
  environment(): "test" | "live" | null;
  initialize(input: GatewayInitInput): Promise<GatewayInitResult>;
  verify(reference: string): Promise<GatewayTransaction>;
  /**
   * Verify by the gateway-issued transaction id (Flutterwave). Optional — only
   * gateways that issue their own transaction ids implement it.
   */
  verifyByTransactionId?(transactionId: string): Promise<GatewayTransaction>;
  /** Verify the webhook signature over the raw body. */
  verifyWebhook(raw: string, headers: Headers): boolean;
  /** Map a gateway webhook payload to the shared event vocabulary. */
  normalizeWebhook(payload: unknown): GatewayWebhookEvent | null;
}

export interface GatewayConfig {
  contract_code?: string | null;
  base_url?: string | null;
  [k: string]: unknown;
}

export function minorToMajor(amountMinor: number): number {
  return Math.round(amountMinor) / 100;
}

export function majorToMinor(amountMajor: number): number {
  return Math.round(Number(amountMajor) * 100);
}
