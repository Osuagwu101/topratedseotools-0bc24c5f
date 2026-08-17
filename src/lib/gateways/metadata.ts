/**
 * Single source of truth for payment-gateway metadata.
 *
 * Client-safe by construction: this module has no server-only imports, so both
 * the checkout UI (via `@/lib/gateway-routing`) and the server-side adapters
 * read the same declarations. Adding a gateway means adding one entry here
 * plus an adapter — no checkout code needs to change.
 *
 * Gateway selection is NOT currency-driven. Exactly one provider is active
 * (`payment_providers.is_active`), chosen explicitly by a Super Admin, with
 * Paystack active by default.
 */
import type { GatewaySlug } from "./types";

/** Gateway used when no active provider row can be resolved. */
export const DEFAULT_GATEWAY: GatewaySlug = "paystack";

export interface GatewayMeta {
  slug: GatewaySlug;
  /** Human label shown to customers and admins. */
  displayName: string;
  /** Native recurring/subscription billing support. */
  supportsRecurring: boolean;
  /** Currencies the gateway can actually settle directly. */
  chargeCurrencies: string[];
  /** Gateway may be selected as the active checkout gateway by an admin. */
  selectable: boolean;
}

export const GATEWAY_METADATA: Record<GatewaySlug, GatewayMeta> = {
  paystack: {
    slug: "paystack",
    displayName: "Paystack",
    supportsRecurring: true,
    // This merchant account settles in NGN. Customers may still select another
    // display currency; checkout converts that total back to NGN before Paystack.
    chargeCurrencies: ["NGN"],
    selectable: true,
  },
  flutterwave: {
    slug: "flutterwave",
    displayName: "Flutterwave",
    // Recurring is handled by our own renewal flow; Flutterwave charges one-time.
    supportsRecurring: false,
    chargeCurrencies: ["NGN", "GHS", "KES", "ZAR", "USD"],
    // Dormant unless a Super Admin explicitly makes it the active gateway.
    selectable: true,
  },
  monnify: {
    slug: "monnify",
    displayName: "Monnify",
    supportsRecurring: false,
    chargeCurrencies: ["NGN"],
    selectable: true,
  },
};

export function normalizeCurrency(currency: string | null | undefined): string {
  return String(currency ?? "NGN").toUpperCase();
}

export function gatewaySupportsCurrency(slug: GatewaySlug, currency: string | null | undefined): boolean {
  return GATEWAY_METADATA[slug].chargeCurrencies.includes(normalizeCurrency(currency));
}

/** Customer-safe message when the active gateway cannot settle a checkout. */
export const CURRENCY_UNAVAILABLE_MESSAGE =
  "Payment is temporarily unavailable. Please try again or contact support.";
