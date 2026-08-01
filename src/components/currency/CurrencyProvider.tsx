/**
 * Session-scoped selected-currency context + cached public config.
 *
 * Default NGN; SSR always renders NGN to avoid hydration mismatch, then the
 * client swaps to the sessionStorage selection after mount.
 */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getPublicCurrencyConfig, type SupportedCurrency } from "@/lib/currency.functions";
import { buildPricingBreakdown, formatMoney, type PricingBreakdown } from "@/lib/currency-convert";
import { billingSuffix, formatCurrency, getBillingKind, normaliseBillingKind } from "@/lib/currency";

const STORAGE_KEY = "ts_currency";

type Ctx = {
  currency: SupportedCurrency;
  setCurrency: (c: SupportedCurrency) => void;
  config: Awaited<ReturnType<typeof getPublicCurrencyConfig>> | undefined;
  isLoading: boolean;
  /** Convert an NGN price into the selected currency + apply surcharge. */
  price: (ngn: number) => PricingBreakdown | null;
  /** Whether the switcher UI should render (feature-flagged by admin). */
  switcherEnabled: boolean;
};

const CurrencyContext = createContext<Ctx | null>(null);

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const fetchConfig = useServerFn(getPublicCurrencyConfig);
  const { data: config, isLoading } = useQuery({
    queryKey: ["currency-config"],
    queryFn: () => fetchConfig(),
    staleTime: 60_000,
  });

  const [currency, setCurrencyState] = useState<SupportedCurrency>("NGN");

  // Hydrate from sessionStorage after mount.
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved && saved !== currency) setCurrencyState(saved as SupportedCurrency);
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // If admin disables switching or removes a currency, force back to NGN.
  useEffect(() => {
    if (!config) return;
    if (!config.switching_enabled && currency !== "NGN") {
      setCurrencyState("NGN");
      try { sessionStorage.setItem(STORAGE_KEY, "NGN"); } catch { /* ignore */ }
      return;
    }
    if (!config.supported_currencies.includes(currency)) {
      setCurrencyState("NGN");
      try { sessionStorage.setItem(STORAGE_KEY, "NGN"); } catch { /* ignore */ }
    }
  }, [config, currency]);

  const setCurrency = (c: SupportedCurrency) => {
    setCurrencyState(c);
    try { sessionStorage.setItem(STORAGE_KEY, c); } catch { /* ignore */ }
  };

  const value = useMemo<Ctx>(() => {
    const price = (ngn: number): PricingBreakdown | null => {
      if (!ngn || !Number.isFinite(ngn)) return null;
      const cur = currency;
      const rate = cur === "NGN" ? 1 : config?.rates.find((r) => r.currency === cur)?.rate ?? 0;
      if (cur !== "NGN" && (!rate || rate <= 0)) return null;
      try {
        return buildPricingBreakdown({
          ngn,
          currency: cur,
          rate,
          surchargePercent: config?.surcharge_percent ?? 3,
          surchargeEnabled: config?.surcharge_enabled ?? true,
        });
      } catch {
        return null;
      }
    };
    return {
      currency,
      setCurrency,
      config,
      isLoading,
      price,
      switcherEnabled:
        !!config?.switching_enabled &&
        (config?.supported_currencies?.length ?? 0) > 1,
    };
  }, [currency, config, isLoading]);

  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>;
}

export function useCurrency(): Ctx {
  const ctx = useContext(CurrencyContext);
  if (!ctx) throw new Error("useCurrency must be used inside CurrencyProvider");
  return ctx;
}

/**
 * Customer-facing money formatter.
 *
 * Takes a base NGN amount and returns the localized display string in the
 * selected currency, with the admin-configured international adjustment
 * already folded into the number. Customers never see the rate or the
 * adjustment as separate values.
 */
export function useMoney() {
  const { currency, price } = useCurrency();

  const fmt = (ngn: number | null | undefined): string => {
    const n = Number(ngn);
    if (!Number.isFinite(n)) return "";
    if (currency === "NGN") return formatCurrency(n, "₦");
    const b = price(n);
    if (!b) return formatCurrency(n, "₦");
    return formatMoney(b.final_amount, currency);
  };

  const plan = (
    opt: {
      amount: number | null;
      unit?: string | null;
      billing_period?: string | null;
      contact_admin?: boolean | null;
    },
    variant: "full" | "compact" = "full",
  ): string => {
    if (opt.contact_admin || opt.amount == null) return "Pricing confirmed on WhatsApp";
    const money = fmt(Number(opt.amount));
    if (variant === "compact") {
      const kind = normaliseBillingKind(getBillingKind(opt));
      if (kind === "monthly") return `${money}/month`;
      if (kind === "quarterly") return `${money}/quarter`;
      if (kind === "yearly") return `${money}/year`;
      return opt.unit ? `${money} / ${opt.unit}` : money;
    }
    const suffix = billingSuffix(opt);
    return suffix ? `${money} ${suffix}` : money;
  };

  return { currency, fmt, plan };
}
