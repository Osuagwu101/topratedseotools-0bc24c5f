import { describe, it, expect } from "vitest";
import { buildPricingBreakdown, formatMoney, type SupportedCurrency } from "../src/lib/currency-convert";

const RATES: Record<string, number> = { GHS: 0.0085, KES: 0.086, ZAR: 0.012, USD: 0.00065 };
const NGN_PRICES = [2300, 8500, 17000, 51000, 99999];

describe("localized display rounding + checkout parity", () => {
  it("display string and Paystack minor units come from one rounded total", () => {
    for (const cur of Object.keys(RATES) as SupportedCurrency[]) {
      for (const ngn of NGN_PRICES) {
        const b = buildPricingBreakdown({
          ngn, currency: cur, rate: RATES[cur]!, surchargePercent: 3, surchargeEnabled: true,
        });
        // Displayed number == final_amount, 2dp for all non-NGN Paystack currencies
        expect(formatMoney(b.final_amount, cur)).toBe(
          `${{ GHS: "GH₵", KES: "KSh", ZAR: "R", USD: "$" }[cur as "GHS"]} ${b.final_amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        );
        expect(b.minor_units_amount).toBe(Math.round(b.final_amount * 100));
        // verification recomputes minor units the same way
        expect(Math.round(b.final_amount * 100)).toBe(b.minor_units_amount);
      }
    }
  });

  it("NGN stays whole-naira and free of adjustment at every percent", () => {
    for (const pct of [0, 3, 5, 12.5]) {
      const b = buildPricingBreakdown({ ngn: 17000, currency: "NGN", rate: 1, surchargePercent: pct, surchargeEnabled: true });
      expect(b.final_amount).toBe(17000);
      expect(formatMoney(b.final_amount, "NGN")).toBe("₦17,000");
      expect(b.minor_units_amount).toBe(1_700_000);
    }
  });

  it("changing the admin adjustment changes new prices deterministically", () => {
    const three = buildPricingBreakdown({ ngn: 17000, currency: "GHS", rate: 0.0085, surchargePercent: 3, surchargeEnabled: true });
    const seven = buildPricingBreakdown({ ngn: 17000, currency: "GHS", rate: 0.0085, surchargePercent: 7, surchargeEnabled: true });
    expect(three.final_amount).toBe(148.84);
    expect(seven.final_amount).toBe(154.62);
    expect(seven.minor_units_amount).toBe(15462);
    // stored snapshots of past orders are independent of the new percent
    expect(three.international_fee_percent).toBe(3);
  });

  it("stored breakdown keeps every reporting field", () => {
    const b = buildPricingBreakdown({ ngn: 8500, currency: "USD", rate: 0.00065, surchargePercent: 3, surchargeEnabled: true });
    expect(Object.keys(b).sort()).toEqual([
      "base_amount_ngn","converted_amount","exchange_rate","final_amount",
      "international_fee_amount","international_fee_percent","minor_units_amount","payment_currency",
    ]);
    expect(b.base_amount_ngn).toBe(8500);
    expect(b.payment_currency).toBe("USD");
  });
});
