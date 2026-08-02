import { DEFAULT_GATEWAY } from "@/lib/gateways/metadata";
/**
 * Transaction transparency helpers (presentation only).
 *
 * NGN stays the internal accounting + analytics currency. These helpers only
 * decide *what to show* for a single payment record so a customer who paid via
 * Flutterwave Ghana Mobile Money sees GH₵ — never a fabricated NGN charge.
 *
 * No revenue, verification, webhook or conversion logic lives here.
 */
import { formatAnyMoney } from "@/lib/currency-convert";

export const PAYMENT_GATEWAYS = ["paystack", "flutterwave", "monnify", "offline"] as const;
export type PaymentGatewayKey = (typeof PAYMENT_GATEWAYS)[number];

export const GATEWAY_LABELS: Record<string, string> = {
  paystack: "Paystack",
  flutterwave: "Flutterwave",
  monnify: "Monnify",
  offline: "Offline / manual",
};

export const PAYMENT_CURRENCIES = ["NGN", "GHS", "KES", "USD", "ZAR"] as const;

/** Shape of the fields these helpers read — a subset of `tool_payments`. */
export interface TxDisplaySource {
  source?: string | null;
  payment_gateway?: string | null;
  payment_method?: string | null;
  payment_currency?: string | null;
  display_currency?: string | null;
  display_amount?: number | null;
  final_amount?: number | null;
  converted_amount?: number | null;
  base_amount_ngn?: number | null;
  exchange_rate?: number | null;
  amount?: number | null;
  currency?: string | null;
}

/** Canonical gateway key for a payment row (offline records win over gateway). */
export function gatewayKey(t: TxDisplaySource): string {
  if ((t.source ?? "") === "offline") return "offline";
  return (t.payment_gateway || t.source || DEFAULT_GATEWAY).toLowerCase();
}

/** Human label: "Flutterwave", "Offline / manual (bank_transfer)". */
export function gatewayLabel(t: TxDisplaySource): string {
  const key = gatewayKey(t);
  const base = GATEWAY_LABELS[key] ?? key;
  if (key === "offline" && t.payment_method) return `${base} (${t.payment_method})`;
  return base;
}

/** Currency the customer was actually charged in. */
export function paidCurrency(t: TxDisplaySource): string {
  return (t.payment_currency || t.display_currency || "NGN").toUpperCase();
}

/** Amount the customer actually paid, in `paidCurrency`. */
export function paidAmount(t: TxDisplaySource): number | null {
  const cur = paidCurrency(t);
  if (t.display_currency && t.display_currency.toUpperCase() === cur && t.display_amount != null) {
    return Number(t.display_amount);
  }
  if (t.final_amount != null) return Number(t.final_amount);
  if (t.converted_amount != null) return Number(t.converted_amount);
  return t.amount != null ? Number(t.amount) : null;
}

/** NGN accounting equivalent — unchanged from what analytics uses. */
export function accountingNgn(t: TxDisplaySource): number | null {
  if (t.base_amount_ngn != null) return Number(t.base_amount_ngn);
  return t.amount != null ? Number(t.amount) : null;
}

export function formatPaid(t: TxDisplaySource): string {
  return formatAnyMoney(paidAmount(t), paidCurrency(t));
}

export function formatAccounting(t: TxDisplaySource): string {
  return formatAnyMoney(accountingNgn(t), "NGN");
}

/** True when the charged currency differs from the accounting currency. */
export function isForeignCharge(t: TxDisplaySource): boolean {
  return paidCurrency(t) !== "NGN";
}

/** "1 NGN = 0.008563 GHS" style hint, or null for NGN charges. */
export function rateHint(t: TxDisplaySource): string | null {
  if (!isForeignCharge(t) || !t.exchange_rate) return null;
  return `1 NGN = ${Number(t.exchange_rate)} ${paidCurrency(t)}`;
}
