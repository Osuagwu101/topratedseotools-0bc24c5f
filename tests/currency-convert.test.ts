import { describe, it, expect } from "vitest";
import {
  convertFromNgn,
  applySurcharge,
  buildPricingBreakdown,
  roundForCurrency,
  formatMoney,
} from "../src/lib/currency-convert";

describe("currency-convert", () => {
  it("rounds NGN to integer, USD to 2dp", () => {
    expect(roundForCurrency(1234.567, "NGN")).toBe(1235);
    expect(roundForCurrency(1.2345, "USD")).toBe(1.23);
  });

  it("converts NGN → USD at rate 0.0007", () => {
    expect(convertFromNgn(10000, 0.0007, "USD")).toBe(7);
    expect(convertFromNgn(10000, 1, "NGN")).toBe(10000);
  });

  it("skips surcharge on NGN, applies 3% otherwise", () => {
    expect(applySurcharge(1000, "NGN", 3, true)).toEqual({ fee: 0, total: 1000, percent: 0 });
    const r = applySurcharge(100, "USD", 3, true);
    expect(r.fee).toBe(3);
    expect(r.total).toBe(103);
    expect(r.percent).toBe(3);
  });

  it("respects surcharge_enabled = false", () => {
    const r = applySurcharge(100, "USD", 3, false);
    expect(r.fee).toBe(0);
    expect(r.total).toBe(100);
  });

  it("builds a full breakdown with correct minor units", () => {
    const b = buildPricingBreakdown({
      ngn: 10000,
      currency: "USD",
      rate: 0.0007,
      surchargePercent: 3,
      surchargeEnabled: true,
    });
    expect(b.base_amount_ngn).toBe(10000);
    expect(b.converted_amount).toBe(7);
    expect(b.international_fee_amount).toBe(0.21);
    expect(b.final_amount).toBe(7.21);
    expect(b.minor_units_amount).toBe(721);
  });

  it("NGN breakdown never applies fee, minor units = final × 100", () => {
    const b = buildPricingBreakdown({
      ngn: 5000,
      currency: "NGN",
      rate: 1,
      surchargePercent: 3,
      surchargeEnabled: true,
    });
    expect(b.international_fee_amount).toBe(0);
    expect(b.final_amount).toBe(5000);
    expect(b.minor_units_amount).toBe(500000);
  });

  it("throws on missing rate for non-NGN", () => {
    expect(() =>
      buildPricingBreakdown({
        ngn: 1000,
        currency: "GHS",
        rate: 0,
        surchargePercent: 3,
        surchargeEnabled: true,
      }),
    ).toThrow();
  });

  it("formats money with symbol", () => {
    expect(formatMoney(5000, "NGN")).toBe("₦5,000");
    expect(formatMoney(1.5, "USD")).toBe("$ 1.50");
  });
});
