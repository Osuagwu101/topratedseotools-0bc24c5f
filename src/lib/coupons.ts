/**
 * Coupon rules — pure and unit-testable.
 *
 * NGN is the source of truth for every promotion. A coupon's percentage is
 * calculated against the base NGN price, and fixed-value coupons are defined
 * in NGN. The discounted NGN amount is then handed to
 * `buildPricingBreakdown`, which performs currency conversion and the
 * international adjustment — there is no separate coupon price path.
 */
import {
  computeDiscountNgn,
  type CouponDiscountType,
  type DiscountInput,
} from "@/lib/currency-convert";

export interface CouponRow {
  id: string;
  code: string;
  description: string | null;
  discount_type: CouponDiscountType;
  discount_value: number;
  currency: string;
  tool_slug: string | null;
  access_type: "shared" | "private" | null;
  billing_period: "monthly" | "quarterly" | "yearly" | null;
  min_amount_ngn: number | null;
  max_redemptions: number | null;
  max_per_user: number;
  redemptions_count: number;
  starts_at: string | null;
  ends_at: string | null;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export type CouponRejection =
  | "not_found"
  | "inactive"
  | "not_started"
  | "expired"
  | "tool_mismatch"
  | "access_mismatch"
  | "period_mismatch"
  | "min_amount"
  | "exhausted"
  | "user_limit"
  | "no_discount";

/** Customer-safe wording — never reveals coupon configuration details. */
export function couponRejectionMessage(reason: CouponRejection): string {
  switch (reason) {
    case "not_found":
      return "That coupon code is not valid.";
    case "inactive":
      return "That coupon is no longer available.";
    case "not_started":
      return "That coupon is not active yet.";
    case "expired":
      return "That coupon has expired.";
    case "tool_mismatch":
      return "That coupon does not apply to this tool.";
    case "access_mismatch":
      return "That coupon does not apply to this access type.";
    case "period_mismatch":
      return "That coupon does not apply to this billing period.";
    case "min_amount":
      return "This plan does not meet the minimum amount for that coupon.";
    case "exhausted":
      return "That coupon has reached its usage limit.";
    case "user_limit":
      return "You have already used that coupon.";
    case "no_discount":
      return "That coupon does not reduce this plan's price.";
  }
}

/** Codes are stored as typed but matched case-insensitively. */
export function normaliseCouponCode(code: string | null | undefined): string {
  return (code ?? "").trim().toUpperCase();
}

export interface CouponContext {
  now: Date;
  tool_slug: string;
  access_type: "shared" | "private";
  billing_period: "monthly" | "quarterly" | "yearly";
  base_amount_ngn: number;
  /** How many times this user has already redeemed this coupon. */
  userRedemptions: number;
}

export type CouponEvaluation =
  | {
      ok: true;
      coupon: CouponRow;
      discount: DiscountInput;
      discount_amount_ngn: number;
      discounted_amount_ngn: number;
    }
  | { ok: false; reason: CouponRejection };

export function evaluateCoupon(
  coupon: CouponRow | null | undefined,
  ctx: CouponContext,
): CouponEvaluation {
  if (!coupon) return { ok: false, reason: "not_found" };
  if (!coupon.is_active) return { ok: false, reason: "inactive" };
  const now = ctx.now.getTime();
  if (coupon.starts_at && new Date(coupon.starts_at).getTime() > now) {
    return { ok: false, reason: "not_started" };
  }
  if (coupon.ends_at && new Date(coupon.ends_at).getTime() < now) {
    return { ok: false, reason: "expired" };
  }
  if (coupon.tool_slug && coupon.tool_slug !== ctx.tool_slug) {
    return { ok: false, reason: "tool_mismatch" };
  }
  if (coupon.access_type && coupon.access_type !== ctx.access_type) {
    return { ok: false, reason: "access_mismatch" };
  }
  if (coupon.billing_period && coupon.billing_period !== ctx.billing_period) {
    return { ok: false, reason: "period_mismatch" };
  }
  if (
    coupon.min_amount_ngn != null &&
    Number(ctx.base_amount_ngn) < Number(coupon.min_amount_ngn)
  ) {
    return { ok: false, reason: "min_amount" };
  }
  if (
    coupon.max_redemptions != null &&
    Number(coupon.redemptions_count) >= Number(coupon.max_redemptions)
  ) {
    return { ok: false, reason: "exhausted" };
  }
  const perUser = Number(coupon.max_per_user ?? 1);
  if (perUser > 0 && ctx.userRedemptions >= perUser) {
    return { ok: false, reason: "user_limit" };
  }

  const discount: DiscountInput = {
    type: coupon.discount_type,
    value: Number(coupon.discount_value),
    code: normaliseCouponCode(coupon.code),
  };
  const amount = computeDiscountNgn(ctx.base_amount_ngn, discount);
  if (amount <= 0) return { ok: false, reason: "no_discount" };

  return {
    ok: true,
    coupon,
    discount,
    discount_amount_ngn: amount,
    discounted_amount_ngn: Math.max(0, Number(ctx.base_amount_ngn) - amount),
  };
}
