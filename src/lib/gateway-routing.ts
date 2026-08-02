/**
 * Automatic payment-gateway routing (client-safe).
 *
 * The gateway is never chosen by an admin or shown to the customer — it is
 * derived from the currency the customer pays in:
 *
 *   NGN            → Paystack     (one-time OR recurring)
 *   anything else  → Flutterwave  (one-time only)
 *
 * Capability data is NOT duplicated here: name, recurring support and
 * chargeable currencies all come from `@/lib/gateways/metadata`, the same
 * declarations the server-side adapters use.
 */
import {
  CURRENCY_UNAVAILABLE_MESSAGE,
  GATEWAY_METADATA,
  gatewaySupportsCurrency,
  normalizeCurrency,
} from "@/lib/gateways/metadata";

export type RoutedGatewaySlug = "paystack" | "flutterwave";

export { CURRENCY_UNAVAILABLE_MESSAGE };

/** Derived view of the shared metadata — kept for existing callers. */
export const GATEWAY_DISPLAY: Record<RoutedGatewaySlug, { name: string; supportsRecurring: boolean }> = {
  paystack: {
    name: GATEWAY_METADATA.paystack.displayName,
    supportsRecurring: GATEWAY_METADATA.paystack.supportsRecurring,
  },
  flutterwave: {
    name: GATEWAY_METADATA.flutterwave.displayName,
    supportsRecurring: GATEWAY_METADATA.flutterwave.supportsRecurring,
  },
};

/** NGN is settled by Paystack; every other currency routes to Flutterwave. */
export function gatewayForCurrency(currency: string | null | undefined): RoutedGatewaySlug {
  return normalizeCurrency(currency) === "NGN" ? "paystack" : "flutterwave";
}

/** Recurring billing is only available on the NGN (Paystack) route. */
export function supportsRecurringForCurrency(currency: string | null | undefined): boolean {
  return GATEWAY_DISPLAY[gatewayForCurrency(currency)].supportsRecurring;
}

export function gatewayNameForCurrency(currency: string | null | undefined): string {
  return GATEWAY_DISPLAY[gatewayForCurrency(currency)].name;
}

/** Can the routed gateway actually charge this currency at all? */
export function isCurrencyRoutable(currency: string | null | undefined): boolean {
  return gatewaySupportsCurrency(gatewayForCurrency(currency), currency);
}
