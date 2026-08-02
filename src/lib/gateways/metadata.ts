/**
 * Single source of truth for payment-gateway metadata.
 *
 * Client-safe by construction: this module has no server-only imports, so both
 * the checkout UI (via `@/lib/gateway-routing`) and the server-side adapters
 * read the same declarations. Adding a gateway means adding one entry here
 * plus an adapter — no checkout or routing code needs to change.
 */
import type { GatewaySlug } from "./types";

/** Gateway assumed for legacy rows written before multi-gateway support. */
export const DEFAULT_GATEWAY: GatewaySlug = "paystack";

export interface GatewayMeta {
  slug: GatewaySlug;
  /** Human label shown to customers and admins. */
  displayName: string;
  /** Native recurring/subscription billing support. */
  supportsRecurring: boolean;
  /** Currencies the gateway can actually settle. */
  chargeCurrencies: string[];
  /** Gateways kept for compatibility but not part of automatic routing. */
  routable: boolean;
}

export const GATEWAY_METADATA: Record<GatewaySlug, GatewayMeta> = {
  paystack: {
    slug: "paystack",
    displayName: "Paystack",
    supportsRecurring: true,
    chargeCurrencies: ["NGN"],
    routable: true,
  },
  flutterwave: {
    slug: "flutterwave",
    displayName: "Flutterwave",
    // Recurring is handled by our own renewal flow; Flutterwave charges one-time.
    supportsRecurring: false,
    chargeCurrencies: ["NGN", "GHS", "KES", "ZAR", "USD"],
    routable: true,
  },
  monnify: {
    slug: "monnify",
    displayName: "Monnify",
    supportsRecurring: false,
    chargeCurrencies: ["NGN"],
    // Not selected by automatic routing; credentials/tests remain available.
    routable: false,
  },
};

export function normalizeCurrency(currency: string | null | undefined): string {
  return String(currency ?? "NGN").toUpperCase();
}

export function gatewaySupportsCurrency(slug: GatewaySlug, currency: string | null | undefined): boolean {
  return GATEWAY_METADATA[slug].chargeCurrencies.includes(normalizeCurrency(currency));
}

/** Customer-safe message when no gateway can charge the chosen currency. */
export const CURRENCY_UNAVAILABLE_MESSAGE =
  "Payment is temporarily unavailable for this currency. Please try another currency or contact support.";
