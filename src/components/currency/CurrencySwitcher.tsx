/**
 * Compact currency dropdown. Hidden when only NGN is supported or when
 * admin disables switching. Uses shadcn Select to fit any surface.
 */
import { useCurrency } from "./CurrencyProvider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CURRENCY_META, type SupportedCurrency } from "@/lib/currency-convert";

export function CurrencySwitcher({ className }: { className?: string }) {
  const { currency, setCurrency, config, switcherEnabled } = useCurrency();
  if (!switcherEnabled || !config) return null;
  return (
    <Select
      value={currency}
      onValueChange={(v) => setCurrency(v as SupportedCurrency)}
    >
      <SelectTrigger className={className ?? "h-8 w-[110px] text-xs"} aria-label="Change currency">
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        {config.supported_currencies.map((code) => {
          const meta = CURRENCY_META[code];
          const row = config.rates.find((r) => r.currency === code);
          const disabled = code !== "NGN" && (!row || row.rate <= 0);
          return (
            <SelectItem key={code} value={code} disabled={disabled}>
              <span className="font-medium">{code}</span>
              <span className="ml-2 text-muted-foreground">{meta.symbol}</span>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}
