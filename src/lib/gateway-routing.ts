/**
 * Automatic payment-gateway routing (client-safe).
 *
 * The gateway is never chosen by an admin or shown to the customer — it is
 * derived from the currency the customer pays in:
 *
 *   NGN            → Paystack     (one-time OR recurring)
 *   anything else  → Flutterwave  (one-time only)
 *
 * Keep this module free of server-only imports: both the checkout UI and the
 * server-side registry read from it so the two can never disagree.
 */

export type RoutedGatewaySlug = "paystack" | "flutterwave";

export const GATEWAY_DISPLAY: Record<RoutedGatewaySlug, { name: string; supportsRecurring: boolean }> = {
  paystack: { name: "Paystack", supportsRecurring: true },
  flutterwave: { name: "Flutterwave", supportsRecurring: false },
};

/** NGN is settled by Paystack; every other currency routes to Flutterwave. */
export function gatewayForCurrency(currency: string | null | undefined): RoutedGatewaySlug {
  return String(currency ?? "NGN").toUpperCase() === "NGN" ? "paystack" : "flutterwave";
}

/** Recurring billing is only available on the NGN (Paystack) route. */
export function supportsRecurringForCurrency(currency: string | null | undefined): boolean {
  return GATEWAY_DISPLAY[gatewayForCurrency(currency)].supportsRecurring;
}

export function gatewayNameForCurrency(currency: string | null | undefined): string {
  return GATEWAY_DISPLAY[gatewayForCurrency(currency)].name;
}
