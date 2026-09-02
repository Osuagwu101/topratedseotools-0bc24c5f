import { describe, it, expect } from "vitest";
import { buildPricingBreakdown } from "../src/lib/currency-convert";
import { validatePaymentVerification } from "../src/lib/paystack-checkout";

const SURCHARGE = { surchargePercent: 3, surchargeEnabled: true };

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

describe("NGN customer flow", () => {
  const b = buildPricingBreakdown({ ngn: 12000, currency: "NGN", rate: 1, ...SURCHARGE });

  it("applies no surcharge and charges the exact NGN price", () => {
    expect(b.international_fee_amount).toBe(0);
    expect(b.international_fee_percent).toBe(0);
    expect(b.final_amount).toBe(12000);
    expect(b.payment_currency).toBe("NGN");
    expect(b.minor_units_amount).toBe(1_200_000);
  });

  it("verification accepts the matching NGN transaction", () => {
    const r = verify(
      {
        ...baseOrder,
        price_amount: 12000,
        currency: "NGN",
        payment_currency: "NGN",
        final_amount_charged: 12000,
      },
      {
        status: "success",
        reference: "TRSEO-1",
        amount: b.minor_units_amount,
        currency: "NGN",
        metadata: { order_id: "order-1" },
      },
    );
    expect(r).toEqual({ ok: true });
  });

  it("verification rejects a wrong NGN amount", () => {
    const r = verify(
      {
        ...baseOrder,
        price_amount: 12000,
        currency: "NGN",
        payment_currency: "NGN",
        final_amount_charged: 12000,
      },
      {
        status: "success",
        reference: "TRSEO-1",
        amount: 100,
        currency: "NGN",
        metadata: { order_id: "order-1" },
      },
    );
    expect(r).toEqual({ ok: false, reason: "amount_mismatch" });
  });

  it("legacy order without currency columns still verifies on price_amount/NGN", () => {
    const r = verify(
      { ...baseOrder, price_amount: 5000, currency: "NGN" },
      {
        status: "success",
        reference: "TRSEO-1",
        amount: 500000,
        currency: "NGN",
        metadata: { order_id: "order-1" },
      },
    );
    expect(r).toEqual({ ok: true });
  });
});

describe("international customer flow", () => {
  it("GHS: converts and adds 3%", () => {
    const b = buildPricingBreakdown({ ngn: 12000, currency: "GHS", rate: 0.0095, ...SURCHARGE });
    expect(b.base_amount_ngn).toBe(12000);
    expect(b.exchange_rate).toBe(0.0095);
    expect(b.converted_amount).toBe(114); // 12000 × 0.0095
    expect(b.international_fee_amount).toBe(3.42); // 3% of 114
    expect(b.final_amount).toBe(117.42);
    expect(b.minor_units_amount).toBe(11742);
  });

  it("KES: converts and adds 3%", () => {
    const b = buildPricingBreakdown({ ngn: 12000, currency: "KES", rate: 0.086, ...SURCHARGE });
    expect(b.converted_amount).toBe(1032);
    expect(b.international_fee_amount).toBe(30.96);
    expect(b.final_amount).toBe(1062.96);
    expect(b.minor_units_amount).toBe(106296);
  });

  it("checkout amount sent to Paystack equals the displayed final amount", () => {
    const b = buildPricingBreakdown({ ngn: 7500, currency: "KES", rate: 0.086, ...SURCHARGE });
    const r = verify(
      {
        ...baseOrder,
        price_amount: 7500,
        currency: "NGN",
        payment_currency: "KES",
        final_amount_charged: b.final_amount,
      },
      {
        status: "success",
        reference: "TRSEO-1",
        amount: b.minor_units_amount,
        currency: "KES",
        metadata: { order_id: "order-1" },
      },
    );
    expect(r).toEqual({ ok: true });
  });

  it("rejects a transaction charged in the wrong currency", () => {
    const b = buildPricingBreakdown({ ngn: 7500, currency: "GHS", rate: 0.0095, ...SURCHARGE });
    const r = verify(
      {
        ...baseOrder,
        price_amount: 7500,
        currency: "NGN",
        payment_currency: "GHS",
        final_amount_charged: b.final_amount,
      },
      {
        status: "success",
        reference: "TRSEO-1",
        amount: b.minor_units_amount,
        currency: "NGN",
        metadata: { order_id: "order-1" },
      },
    );
    expect(r).toEqual({ ok: false, reason: "currency_mismatch" });
  });

  it("rejects an intl transaction that only paid the un-surcharged converted amount", () => {
    const b = buildPricingBreakdown({ ngn: 7500, currency: "GHS", rate: 0.0095, ...SURCHARGE });
    const r = verify(
      {
        ...baseOrder,
        price_amount: 7500,
        currency: "NGN",
        payment_currency: "GHS",
        final_amount_charged: b.final_amount,
      },
      {
        status: "success",
        reference: "TRSEO-1",
        amount: Math.round(b.converted_amount * 100),
        currency: "GHS",
        metadata: { order_id: "order-1" },
      },
    );
    expect(r).toEqual({ ok: false, reason: "amount_mismatch" });
  });

  it("admin can turn the surcharge off / change the percent", () => {
    const off = buildPricingBreakdown({
      ngn: 10000,
      currency: "USD",
      rate: 0.0007,
      surchargePercent: 3,
      surchargeEnabled: false,
    });
    expect(off.international_fee_amount).toBe(0);
    expect(off.final_amount).toBe(7);
    const five = buildPricingBreakdown({
      ngn: 10000,
      currency: "USD",
      rate: 0.0007,
      surchargePercent: 5,
      surchargeEnabled: true,
    });
    expect(five.international_fee_percent).toBe(5);
    expect(five.final_amount).toBe(7.35);
    // NGN is unaffected by any admin surcharge setting.
    const ngn = buildPricingBreakdown({
      ngn: 10000,
      currency: "NGN",
      rate: 1,
      surchargePercent: 5,
      surchargeEnabled: true,
    });
    expect(ngn.final_amount).toBe(10000);
  });
});
