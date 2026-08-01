import { describe, it, expect } from "vitest";
import { buildPricingBreakdown, resolveChargePlan, formatMoney, type SupportedCurrency } from "../src/lib/currency-convert";
import { validatePaymentVerification } from "../src/lib/paystack-checkout";

const SURCHARGE = { surchargePercent: 3, surchargeEnabled: true };
const RATES: Record<string, number> = { GHS: 0.0085, KES: 0.086, ZAR: 0.012, USD: 0.00065 };
const MERCHANT = ["NGN"];

function plan(currency: SupportedCurrency, ngn: number, discount?: { type: "percent" | "amount"; value: number; code: string }) {
  const b = buildPricingBreakdown({
    ngn,
    currency,
    rate: currency === "NGN" ? 1 : RATES[currency]!,
    ...SURCHARGE,
    discount: discount ?? null,
  });
  return { b, charge: resolveChargePlan(b, MERCHANT) };
}

function verify(order: Record<string, unknown>, tx: Record<string, unknown>) {
  return validatePaymentVerification({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tx: tx as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    order: order as any,
    callerUserId: "user-1",
    env: "test",
    otherOrderHasReference: false,
  });
}

const baseOrder = {
  id: "order-1",
  user_id: "user-1",
  paystack_reference: "TRSEO-1",
  paystack_environment: "test",
};

describe("display currency vs. Paystack payment currency", () => {
  it("NGN customer: display NGN, Paystack NGN, no fallback", () => {
    const { b, charge } = plan("NGN", 12000);
    expect(charge.fallback_applied).toBe(false);
    expect(charge.display_currency).toBe("NGN");
    expect(charge.display_amount).toBe(12000);
    expect(charge.payment_currency).toBe("NGN");
    expect(charge.payment_amount).toBe(12000);
    expect(charge.payment_minor_units).toBe(1_200_000);
    expect(charge.payment_minor_units).toBe(b.minor_units_amount);
  });

  it.each(["GHS", "KES", "ZAR", "USD"] as SupportedCurrency[])(
    "%s customer: display local currency, Paystack charged NGN",
    (cur) => {
      const { b, charge } = plan(cur, 12000);
      expect(charge.display_currency).toBe(cur);
      expect(charge.display_amount).toBe(b.final_amount);
      expect(charge.payment_currency).toBe("NGN");
      expect(charge.fallback_applied).toBe(true);
      // The NGN charge is the displayed total converted back at the same rate.
      expect(charge.payment_amount).toBe(Math.round(b.final_amount / RATES[cur]!));
      expect(charge.payment_minor_units).toBe(charge.payment_amount * 100);
      // Adjustment still applied: NGN charge ≈ base × 1.03
      expect(charge.payment_amount).toBeGreaterThan(12000);
      expect(charge.payment_amount).toBeLessThan(12000 * 1.05);
    },
  );

  it("pricing pipeline is untouched — display maths unchanged", () => {
    const { b } = plan("GHS", 12000);
    expect(b.converted_amount).toBe(102); // 12000 × 0.0085
    expect(b.international_fee_amount).toBe(3.06);
    expect(b.final_amount).toBe(105.06);
    expect(formatMoney(b.final_amount, "GHS")).toBe("GH₵ 105.06");
  });

  it("coupon still applies to the NGN base before conversion and fallback", () => {
    const { b, charge } = plan("GHS", 10000, { type: "percent", value: 10, code: "TEST10" });
    expect(b.discount_amount_ngn).toBe(1000);
    expect(b.discounted_amount_ngn).toBe(9000);
    expect(charge.display_amount).toBe(b.final_amount);
    expect(charge.payment_amount).toBe(Math.round(b.final_amount / RATES.GHS!));
    // 9000 × 1.03 ≈ 9270 NGN charged
    expect(charge.payment_amount).toBeGreaterThan(9200);
    expect(charge.payment_amount).toBeLessThan(9350);
  });

  it("webhook/verify validation succeeds against the NGN charge", () => {
    const { charge } = plan("KES", 7500);
    const r = verify(
      {
        ...baseOrder,
        price_amount: 7500,
        currency: "NGN",
        payment_currency: charge.payment_currency,
        final_amount_charged: charge.payment_amount,
      },
      {
        status: "success",
        reference: "TRSEO-1",
        amount: charge.payment_minor_units,
        currency: "NGN",
        metadata: { order_id: "order-1" },
      },
    );
    expect(r).toEqual({ ok: true });
  });

  it("verification rejects a charge in the customer's display currency", () => {
    const { b, charge } = plan("KES", 7500);
    const r = verify(
      {
        ...baseOrder,
        price_amount: 7500,
        currency: "NGN",
        payment_currency: charge.payment_currency,
        final_amount_charged: charge.payment_amount,
      },
      {
        status: "success",
        reference: "TRSEO-1",
        amount: b.minor_units_amount,
        currency: "KES",
        metadata: { order_id: "order-1" },
      },
    );
    expect(r).toEqual({ ok: false, reason: "amount_mismatch" });
  });

  it("no fallback when the merchant account supports the currency", () => {
    const b = buildPricingBreakdown({ ngn: 10000, currency: "USD", rate: RATES.USD!, ...SURCHARGE });
    const charge = resolveChargePlan(b, ["NGN", "USD"]);
    expect(charge.fallback_applied).toBe(false);
    expect(charge.payment_currency).toBe("USD");
    expect(charge.payment_minor_units).toBe(b.minor_units_amount);
  });

  it("defaults to NGN-only merchant support when unset", () => {
    const b = buildPricingBreakdown({ ngn: 5000, currency: "ZAR", rate: RATES.ZAR!, ...SURCHARGE });
    expect(resolveChargePlan(b, null).payment_currency).toBe("NGN");
    expect(resolveChargePlan(b, []).payment_currency).toBe("NGN");
  });
});
