export interface PaystackCurrencyOption {
  code: string;
  name: string;
  countries: string[];
}

const KNOWN_NAMES: Record<string, string> = {
  NGN: "Nigerian Naira",
  USD: "US Dollar",
  GHS: "Ghanaian Cedi",
  KES: "Kenyan Shilling",
  ZAR: "South African Rand",
  XOF: "West African CFA Franc",
  EGP: "Egyptian Pound",
};

export function normalizePaystackCurrency(value: unknown): string {
  const code = String(value ?? "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) throw new Error("Invalid currency code.");
  return code;
}

export function currencyDisplayName(code: string): string {
  const normalized = normalizePaystackCurrency(code);
  if (KNOWN_NAMES[normalized]) return KNOWN_NAMES[normalized];
  try {
    const DisplayNames = (Intl as typeof Intl & { DisplayNames?: new (locales?: string | string[], options?: { type: "currency" }) => { of(code: string): string | undefined } }).DisplayNames;
    const value = DisplayNames ? new DisplayNames(["en"], { type: "currency" }).of(normalized) : undefined;
    return value || normalized;
  } catch {
    return normalized;
  }
}

export function roundCustomPaymentAmount(amount: number, currency: string): number {
  const code = normalizePaystackCurrency(currency);
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) throw new Error("Amount must be greater than zero.");
  // Paystack documents XOF as having no fractional part even though API amounts
  // are still multiplied by 100. Other currently supported currencies use 2dp.
  if (code === "XOF") return Math.round(n);
  return Math.round(n * 100) / 100;
}

export function customPaymentMinorUnits(amount: number, currency: string): number {
  const major = roundCustomPaymentAmount(amount, currency);
  return Math.round(major * 100);
}

export function formatCustomPaymentMoney(amount: number, currency: string): string {
  const code = normalizePaystackCurrency(currency);
  const n = Number(amount);
  if (!Number.isFinite(n)) return `${code} 0`;
  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency: code,
      minimumFractionDigits: code === "XOF" ? 0 : undefined,
      maximumFractionDigits: code === "XOF" ? 0 : 2,
    }).format(n);
  } catch {
    return `${code} ${n.toLocaleString("en-US", { maximumFractionDigits: code === "XOF" ? 0 : 2 })}`;
  }
}
