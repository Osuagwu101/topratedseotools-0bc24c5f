/**
 * Multi-currency conversion helpers (pure, testable).
 *
 * Rates are stored as "1 NGN = <rate> <quote>" in `exchange_rates`.
 * All money going into Paystack ultimately becomes minor units (× 100).
 */

export type SupportedCurrency = "NGN" | "GHS" | "KES" | "ZAR" | "USD";

export const CURRENCY_META: Record<SupportedCurrency, {
  code: SupportedCurrency;
  symbol: string;
  name: string;
  decimals: number;
  /** Paystack minor-unit multiplier. All Paystack currencies use ×100. */
  minorMultiplier: 100;
  isNgn: boolean;
}> = {
  NGN: { code: "NGN", symbol: "₦", name: "Nigerian Naira", decimals: 0, minorMultiplier: 100, isNgn: true },
  GHS: { code: "GHS", symbol: "GH₵", name: "Ghanaian Cedi", decimals: 2, minorMultiplier: 100, isNgn: false },
  KES: { code: "KES", symbol: "KSh", name: "Kenyan Shilling", decimals: 2, minorMultiplier: 100, isNgn: false },
  ZAR: { code: "ZAR", symbol: "R", name: "South African Rand", decimals: 2, minorMultiplier: 100, isNgn: false },
  USD: { code: "USD", symbol: "$", name: "US Dollar", decimals: 2, minorMultiplier: 100, isNgn: false },
};

export function isSupportedCurrency(x: unknown): x is SupportedCurrency {
  return typeof x === "string" && x in CURRENCY_META;
}

/** Round `n` to the currency's canonical number of decimals. */
export function roundForCurrency(n: number, currency: SupportedCurrency): number {
  const d = CURRENCY_META[currency].decimals;
  const f = Math.pow(10, d);
  return Math.round(n * f) / f;
}

/** Convert an NGN amount into `target` using the "1 NGN = rate target" quote. */
export function convertFromNgn(
  ngn: number,
  rate: number,
  target: SupportedCurrency,
): number {
  if (target === "NGN") return roundForCurrency(ngn, "NGN");
  if (!Number.isFinite(ngn) || !Number.isFinite(rate) || rate <= 0) {
    throw new Error("Invalid rate for conversion");
  }
  return roundForCurrency(ngn * rate, target);
}

/** International surcharge: skipped for NGN, applied to non-NGN. */
export function applySurcharge(
  amount: number,
  currency: SupportedCurrency,
  surchargePercent: number,
  surchargeEnabled: boolean,
): { fee: number; total: number; percent: number } {
  const isIntl = currency !== "NGN";
  const percent = isIntl && surchargeEnabled && Number.isFinite(surchargePercent) ? Math.max(0, surchargePercent) : 0;
  const fee = roundForCurrency((amount * percent) / 100, currency);
  const total = roundForCurrency(amount + fee, currency);
  return { fee, total, percent };
}

export interface PricingBreakdown {
  base_amount_ngn: number;
  payment_currency: SupportedCurrency;
  exchange_rate: number; // 1 for NGN, otherwise the rate used
  converted_amount: number;
  international_fee_percent: number;
  international_fee_amount: number;
  final_amount: number;
  minor_units_amount: number; // final_amount × minorMultiplier
}

export function buildPricingBreakdown(input: {
  ngn: number;
  currency: SupportedCurrency;
  rate: number | null;
  surchargePercent: number;
  surchargeEnabled: boolean;
}): PricingBreakdown {
  const { ngn, currency, surchargePercent, surchargeEnabled } = input;
  const rate = currency === "NGN" ? 1 : Number(input.rate);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error(`Missing exchange rate for ${currency}`);
  }
  const converted = convertFromNgn(ngn, rate, currency);
  const { fee, total, percent } = applySurcharge(converted, currency, surchargePercent, surchargeEnabled);
  const minor = Math.round(total * CURRENCY_META[currency].minorMultiplier);
  return {
    base_amount_ngn: roundForCurrency(ngn, "NGN"),
    payment_currency: currency,
    exchange_rate: rate,
    converted_amount: converted,
    international_fee_percent: percent,
    international_fee_amount: fee,
    final_amount: total,
    minor_units_amount: minor,
  };
}

/** Locale-aware format, e.g. "GH₵ 12.34" / "₦5,000". */
export function formatMoney(amount: number, currency: SupportedCurrency): string {
  const meta = CURRENCY_META[currency];
  const n = Number(amount);
  if (!Number.isFinite(n)) return "";
  const formatted = n.toLocaleString("en-US", {
    minimumFractionDigits: meta.decimals,
    maximumFractionDigits: meta.decimals,
  });
  return currency === "NGN" ? `${meta.symbol}${formatted}` : `${meta.symbol} ${formatted}`;
}

/** "1 NGN = 0.006 USD" — for the rate hint under converted prices. */
export function formatRateHint(currency: SupportedCurrency, rate: number): string {
  if (currency === "NGN") return "";
  const meta = CURRENCY_META[currency];
  const shown = rate.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: Math.max(4, meta.decimals + 2),
  });
  return `1 NGN = ${shown} ${currency}`;
}
