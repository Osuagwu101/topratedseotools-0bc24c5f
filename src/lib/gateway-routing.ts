/**
 * Gateway capability helpers (client-safe).
 *
 * There is NO automatic currency-based provider routing. Exactly one gateway
 * is active at a time (`payment_providers.is_active`) and it is selected
 * explicitly by a Super Admin in Admin → Settings → Payment providers.
 * Paystack is active by default. Customers may select any enabled display
 * currency; if Paystack cannot settle it directly, the existing charge-plan
 * pipeline converts the displayed total to the merchant settlement currency
 * (NGN for the current account) without changing gateway.
 *
 * Capability data is not duplicated here: name, recurring support and direct
 * settlement currencies come from `@/lib/gateways/metadata`, the same
 * declarations the server-side adapters use.
 */
import {
  CURRENCY_UNAVAILABLE_MESSAGE,
  DEFAULT_GATEWAY,
  GATEWAY_METADATA,
  gatewaySupportsCurrency,
  normalizeCurrency,
} from "@/lib/gateways/metadata";
import type { GatewaySlug } from "@/lib/gateways/types";

export type RoutedGatewaySlug = GatewaySlug;

export { CURRENCY_UNAVAILABLE_MESSAGE, normalizeCurrency };

/** Derived view of the shared metadata — kept for existing callers. */
export const GATEWAY_DISPLAY: Record<GatewaySlug, { name: string; supportsRecurring: boolean }> = {
  paystack: {
    name: GATEWAY_METADATA.paystack.displayName,
    supportsRecurring: GATEWAY_METADATA.paystack.supportsRecurring,
  },
  flutterwave: {
    name: GATEWAY_METADATA.flutterwave.displayName,
    supportsRecurring: GATEWAY_METADATA.flutterwave.supportsRecurring,
  },
  monnify: {
    name: GATEWAY_METADATA.monnify.displayName,
    supportsRecurring: GATEWAY_METADATA.monnify.supportsRecurring,
  },
};

function slugOrDefault(slug: string | null | undefined): GatewaySlug {
  const s = String(slug ?? "").toLowerCase();
  return (s in GATEWAY_METADATA ? s : DEFAULT_GATEWAY) as GatewaySlug;
}

export function gatewayName(slug: string | null | undefined): string {
  return GATEWAY_DISPLAY[slugOrDefault(slug)].name;
}

export function gatewaySupportsRecurring(slug: string | null | undefined): boolean {
  return GATEWAY_DISPLAY[slugOrDefault(slug)].supportsRecurring;
}

/** Can the given gateway settle this currency directly? */
export function gatewayCanCharge(
  slug: string | null | undefined,
  currency: string | null | undefined,
): boolean {
  return gatewaySupportsCurrency(slugOrDefault(slug), currency);
}
