export type CustomPaymentGateway = "paystack" | "flutterwave";

export interface CustomPaymentCurrencyOption {
  code: string;
  name: string;
  countries?: string[];
}

/** Custom Payment product policy: Paystack links are always charged in NGN. */
export const PAYSTACK_CUSTOM_PAYMENT_CURRENCIES = ["NGN"] as const;

/** Flutterwave's documented card-collection currencies. */
export const FLUTTERWAVE_CUSTOM_PAYMENT_CURRENCIES = [
  "GBP",
  "CAD",
  "XAF",
  "COP",
  "EGP",
  "EUR",
  "GHS",
  "KES",
  "INR",
  "NGN",
  "RWF",
  "SLL",
  "ZAR",
  "TZS",
  "UGX",
  "USD",
  "XOF",
  "ZMW",
] as const;

/** Business priority requested for the Flutterwave currency picker. */
export const FLUTTERWAVE_CURRENCY_PRIORITY = ["GHS", "KES", "ZAR", "NGN"] as const;

const KNOWN_NAMES: Record<string, string> = {
  NGN: "Nigerian Naira",
  USD: "United States Dollar",
  GHS: "Ghanaian Cedi",
  KES: "Kenyan Shilling",
  ZAR: "South African Rand",
  GBP: "British Pound Sterling",
  CAD: "Canadian Dollar",
  XAF: "Central African CFA Franc",
  COP: "Colombian Peso",
  EGP: "Egyptian Pound",
  EUR: "Euro",
  INR: "Indian Rupee",
  RWF: "Rwandan Franc",
  SLL: "Sierra Leonean Leone",
  TZS: "Tanzanian Shilling",
  UGX: "Ugandan Shilling",
  XOF: "West African CFA Franc",
  ZMW: "Zambian Kwacha",
};

const WHOLE_NUMBER_CURRENCIES = new Set(["XAF", "XOF", "RWF", "UGX"]);

export function normalizeCustomPaymentCurrency(value: unknown): string {
  const code = String(value ?? "")
    .trim()
    .toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) throw new Error("Invalid currency code.");
  return code;
}

export function currencyDisplayName(code: string): string {
  const normalized = normalizeCustomPaymentCurrency(code);
  if (KNOWN_NAMES[normalized]) return KNOWN_NAMES[normalized];
  try {
    const DisplayNames = (
      Intl as typeof Intl & {
        DisplayNames?: new (
          locales?: string | string[],
          options?: { type: "currency" },
        ) => { of(code: string): string | undefined };
      }
    ).DisplayNames;
    return DisplayNames
      ? new DisplayNames(["en"], { type: "currency" }).of(normalized) || normalized
      : normalized;
  } catch {
    return normalized;
  }
}

function option(code: string): CustomPaymentCurrencyOption {
  return { code, name: currencyDisplayName(code) };
}

export function customPaymentCurrenciesForGateway(
  gateway: CustomPaymentGateway,
): CustomPaymentCurrencyOption[] {
  if (gateway === "paystack") return PAYSTACK_CUSTOM_PAYMENT_CURRENCIES.map(option);

  const priority = new Map(FLUTTERWAVE_CURRENCY_PRIORITY.map((code, index) => [code, index]));
  return FLUTTERWAVE_CUSTOM_PAYMENT_CURRENCIES.map(option).sort((a, b) => {
    const ai = priority.get(a.code as (typeof FLUTTERWAVE_CURRENCY_PRIORITY)[number]);
    const bi = priority.get(b.code as (typeof FLUTTERWAVE_CURRENCY_PRIORITY)[number]);
    if (ai != null || bi != null) return (ai ?? 999) - (bi ?? 999);
    return a.name.localeCompare(b.name) || a.code.localeCompare(b.code);
  });
}

export function customPaymentGatewaySupportsCurrency(
  gateway: CustomPaymentGateway,
  currency: unknown,
): boolean {
  let code: string;
  try {
    code = normalizeCustomPaymentCurrency(currency);
  } catch {
    return false;
  }
  const allowed: readonly string[] =
    gateway === "paystack"
      ? PAYSTACK_CUSTOM_PAYMENT_CURRENCIES
      : FLUTTERWAVE_CUSTOM_PAYMENT_CURRENCIES;
  return allowed.includes(code);
}

export function searchCustomPaymentCurrencies(
  options: CustomPaymentCurrencyOption[],
  query: string,
): CustomPaymentCurrencyOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return options;
  return options.filter(
    (item) => item.code.toLowerCase().includes(q) || item.name.toLowerCase().includes(q),
  );
}

export function roundCustomPaymentAmount(amount: number, currency: string): number {
  const code = normalizeCustomPaymentCurrency(currency);
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) throw new Error("Amount must be greater than zero.");
  const multiplier = WHOLE_NUMBER_CURRENCIES.has(code) ? 1 : 100;
  return Math.round((n + Number.EPSILON) * multiplier) / multiplier;
}

/** Gateway adapters use a canonical 1/100 boundary; Flutterwave converts this back to major units. */
export function customPaymentMinorUnits(amount: number, currency: string): number {
  return Math.round(roundCustomPaymentAmount(amount, currency) * 100);
}

export function customPaymentRequiresWholeAmount(currency: string): boolean {
  return WHOLE_NUMBER_CURRENCIES.has(normalizeCustomPaymentCurrency(currency));
}

export function formatCustomPaymentMoney(amount: number, currency: string): string {
  const code = normalizeCustomPaymentCurrency(currency);
  const n = Number(amount);
  if (!Number.isFinite(n)) return `${code} 0`;
  const digits = WHOLE_NUMBER_CURRENCIES.has(code) ? 0 : 2;
  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency: code,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(n);
  } catch {
    return `${code} ${n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
  }
}

/* Compatibility aliases retained for any older imports outside Custom Payments. */
export interface PaystackCurrencyOption extends CustomPaymentCurrencyOption {
  countries: string[];
}
export const normalizePaystackCurrency = normalizeCustomPaymentCurrency;
export function merchantPaystackCurrencies(_config: unknown): string[] {
  return [...PAYSTACK_CUSTOM_PAYMENT_CURRENCIES];
}
export function merchantSupportsPaystackCurrency(_config: unknown, currency: unknown): boolean {
  return customPaymentGatewaySupportsCurrency("paystack", currency);
}
