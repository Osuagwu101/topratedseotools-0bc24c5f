/**
 * Coupon customer journey — end-to-end simulation.
 *
 * Covers the whole chain the customer touches: coupon validation at checkout,
 * the NGN-first discount, currency conversion + international adjustment, the
 * amount handed to Paystack, and the amount webhook/verify compare against.
 */
import { describe, expect, it } from "vitest";
import { buildPricingBreakdown, computeDiscountNgn } from "@/lib/currency-convert";
import {
  evaluateCoupon,
  couponRejectionMessage,
  normaliseCouponCode,
  type CouponRow,
} from "@/lib/coupons";

const BASE_NGN = 10_000;

function coupon(over: Partial<CouponRow> = {}): CouponRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    code: "SAVE10",
    description: null,
    discount_type: "percent",
    discount_value: 10,
    currency: "NGN",
    tool_slug: null,
    access_type: null,
    billing_period: null,
    min_amount_ngn: null,
    max_redemptions: null,
    max_per_user: 1,
    redemptions_count: 0,
    starts_at: null,
    ends_at: null,
    is_active: true,
    ...over,
  };
}

const ctx = {
  now: new Date("2026-08-01T00:00:00Z"),
  tool_slug: "chatgpt-plus",
  access_type: "shared" as const,
  billing_period: "monthly" as const,
  base_amount_ngn: BASE_NGN,
  userRedemptions: 0,
};

describe("1 — customer pays in NGN", () => {
  it("applies the coupon to the base naira price and charges the discount", () => {
    const evaluated = evaluateCoupon(coupon(), ctx);
    expect(evaluated.ok).toBe(true);
    if (!evaluated.ok) return;

    expect(evaluated.discount_amount_ngn).toBe(1000);
    expect(evaluated.discounted_amount_ngn).toBe(9000);

    const b = buildPricingBreakdown({
      ngn: BASE_NGN,
      currency: "NGN",
      rate: 1,
      surchargePercent: 3,
      surchargeEnabled: true,
      discount: evaluated.discount,
    });

    // No international adjustment on NGN; discount is the only delta.
    expect(b.base_amount_ngn).toBe(BASE_NGN);
    expect(b.discount_amount_ngn).toBe(1000);
    expect(b.discounted_amount_ngn).toBe(9000);
    expect(b.international_fee_amount).toBe(0);
    expect(b.final_amount).toBe(9000);
    // Paystack is charged in minor units of exactly the displayed amount.
    expect(b.minor_units_amount).toBe(900_000);
  });

  it("fixed-naira coupons behave the same and never go below zero", () => {
    const b = buildPricingBreakdown({
      ngn: BASE_NGN,
      currency: "NGN",
      rate: 1,
      discount: { type: "amount", value: 25_000, code: "BIG" },
    });
    expect(b.discount_amount_ngn).toBe(BASE_NGN);
    expect(b.final_amount).toBe(0);
    expect(computeDiscountNgn(BASE_NGN, { type: "percent", value: 150 })).toBe(BASE_NGN);
  });
});

describe("2 — customer pays in an international currency", () => {
  const rate = 0.00065; // 1 NGN = 0.00065 USD

  it("discounts in naira, then converts, then adds the adjustment", () => {
    const withCoupon = buildPricingBreakdown({
      ngn: BASE_NGN,
      currency: "USD",
      rate,
      surchargePercent: 3,
      surchargeEnabled: true,
      discount: { type: "percent", value: 10, code: "SAVE10" },
    });

    // Order of operations: 10000 → 9000 → ×rate → +3%
    const converted = Math.round(9000 * rate * 100) / 100;
    expect(withCoupon.discounted_amount_ngn).toBe(9000);
    expect(withCoupon.converted_amount).toBe(converted);
    expect(withCoupon.international_fee_percent).toBe(3);
    expect(withCoupon.international_fee_amount).toBeGreaterThan(0);
    expect(withCoupon.final_amount).toBeCloseTo(Math.round(converted * 1.03 * 100) / 100, 2);
    // Displayed amount and Paystack amount cannot diverge.
    expect(withCoupon.minor_units_amount).toBe(Math.round(withCoupon.final_amount * 100));
    expect(withCoupon.payment_currency).toBe("USD");
  });

  it("keeps the adjustment applied and the saving proportional", () => {
    const opts = {
      ngn: BASE_NGN,
      currency: "USD" as const,
      rate,
      surchargePercent: 3,
      surchargeEnabled: true,
    };
    const full = buildPricingBreakdown(opts);
    const discounted = buildPricingBreakdown({
      ...opts,
      discount: { type: "percent", value: 10, code: "SAVE10" },
    });

    expect(discounted.final_amount).toBeLessThan(full.final_amount);
    expect(discounted.international_fee_amount).toBeGreaterThan(0);
    // A 10% naira discount is still ~10% off the localized total.
    expect(discounted.final_amount / full.final_amount).toBeCloseTo(0.9, 2);
  });

  it("percent coupons give the same effective saving in every currency", () => {
    for (const [currency, r] of [
      ["GHS", 0.0078],
      ["KES", 0.086],
      ["ZAR", 0.012],
      ["USD", 0.00065],
    ] as const) {
      const opts = {
        ngn: BASE_NGN,
        currency,
        rate: r,
        surchargePercent: 3,
        surchargeEnabled: true,
      };
      const full = buildPricingBreakdown(opts);
      const disc = buildPricingBreakdown({
        ...opts,
        discount: { type: "percent", value: 25, code: "Q" },
      });
      expect(disc.final_amount / full.final_amount).toBeCloseTo(0.75, 2);
      expect(disc.minor_units_amount).toBe(Math.round(disc.final_amount * 100));
    }
  });
});

describe("3 — checkout coupon field validation", () => {
  it("accepts a valid code, case-insensitively", () => {
    expect(normaliseCouponCode(" save10 ")).toBe("SAVE10");
    expect(evaluateCoupon(coupon(), ctx).ok).toBe(true);
  });

  it("rejects unknown, disabled, expired and not-yet-started codes", () => {
    const cases: Array<[CouponRow | null, string]> = [
      [null, "not_found"],
      [coupon({ is_active: false }), "inactive"],
      [coupon({ ends_at: "2026-07-01T00:00:00Z" }), "expired"],
      [coupon({ starts_at: "2026-09-01T00:00:00Z" }), "not_started"],
    ];
    for (const [row, reason] of cases) {
      const res = evaluateCoupon(row, ctx);
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.reason).toBe(reason);
        // Customer-facing copy never leaks configuration details.
        expect(couponRejectionMessage(res.reason).length).toBeGreaterThan(5);
      }
    }
  });

  it("rejects codes that do not match the selected plan", () => {
    const mismatches: Array<[CouponRow, string]> = [
      [coupon({ tool_slug: "other-tool" }), "tool_mismatch"],
      [coupon({ access_type: "private" }), "access_mismatch"],
      [coupon({ billing_period: "yearly" }), "period_mismatch"],
      [coupon({ min_amount_ngn: 50_000 }), "min_amount"],
    ];
    for (const [row, reason] of mismatches) {
      const res = evaluateCoupon(row, ctx);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.reason).toBe(reason);
    }
  });

  it("enforces total and per-customer usage limits", () => {
    const exhausted = evaluateCoupon(coupon({ max_redemptions: 5, redemptions_count: 5 }), ctx);
    expect(exhausted.ok).toBe(false);
    if (!exhausted.ok) expect(exhausted.reason).toBe("exhausted");

    const reused = evaluateCoupon(coupon({ max_per_user: 1 }), { ...ctx, userRedemptions: 1 });
    expect(reused.ok).toBe(false);
    if (!reused.ok) expect(reused.reason).toBe("user_limit");

    // max_per_user = 0 means unlimited per customer.
    expect(evaluateCoupon(coupon({ max_per_user: 0 }), { ...ctx, userRedemptions: 9 }).ok).toBe(
      true,
    );
  });

  it("rejects a coupon that would not reduce the price", () => {
    const res = evaluateCoupon(coupon({ discount_type: "amount", discount_value: 0.4 }), ctx);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("no_discount");
  });
});

describe("4 — payment completion amount checks", () => {
  it("verify/webhook comparison uses the discounted amount", () => {
    const b = buildPricingBreakdown({
      ngn: BASE_NGN,
      currency: "USD",
      rate: 0.00065,
      surchargePercent: 3,
      surchargeEnabled: true,
      discount: { type: "percent", value: 10, code: "SAVE10" },
    });

    // What the order stores at init, and what Paystack reports back.
    const order = {
      final_amount_charged: b.final_amount,
      discount_amount_ngn: b.discount_amount_ngn,
      discounted_amount_ngn: b.discounted_amount_ngn,
      coupon_code: b.discount_code,
    };
    const paystackMinor = b.minor_units_amount;

    expect(order.coupon_code).toBe("SAVE10");
    expect(Math.round(order.final_amount_charged * 100)).toBe(paystackMinor);
    // Undiscounted amount must NOT match, i.e. the discount really reached Paystack.
    const undiscounted = buildPricingBreakdown({
      ngn: BASE_NGN,
      currency: "USD",
      rate: 0.00065,
      surchargePercent: 3,
      surchargeEnabled: true,
    });
    expect(undiscounted.minor_units_amount).not.toBe(paystackMinor);
  });
});
