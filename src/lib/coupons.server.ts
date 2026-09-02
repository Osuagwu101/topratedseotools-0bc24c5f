/**
 * Server-only coupon resolution + redemption recording.
 *
 * Coupon rows are admin-managed and never readable by the browser, so the
 * lookup runs with the service-role client after the caller is authenticated.
 * The resolved discount is always fed into `buildPricingBreakdown`, never
 * applied to a price on its own.
 */
import {
  evaluateCoupon,
  normaliseCouponCode,
  type CouponEvaluation,
  type CouponRow,
} from "@/lib/coupons";

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function resolveCouponForCheckout(
  admin: any,
  input: {
    code: string | null | undefined;
    userId: string;
    tool_slug: string;
    access_type: "shared" | "private";
    billing_period: "monthly" | "quarterly" | "yearly";
    base_amount_ngn: number;
  },
): Promise<CouponEvaluation> {
  const code = normaliseCouponCode(input.code);
  if (!code) return { ok: false, reason: "not_found" };

  const { data } = await admin.from("coupons").select("*").ilike("code", code).maybeSingle();
  const coupon = (data ?? null) as CouponRow | null;
  if (!coupon) return { ok: false, reason: "not_found" };

  const { count } = await admin
    .from("coupon_redemptions")
    .select("id", { count: "exact", head: true })
    .eq("coupon_id", coupon.id)
    .eq("user_id", input.userId);

  return evaluateCoupon(coupon, {
    now: new Date(),
    tool_slug: input.tool_slug,
    access_type: input.access_type,
    billing_period: input.billing_period,
    base_amount_ngn: input.base_amount_ngn,
    userRedemptions: Number(count ?? 0),
  });
}

/**
 * Records the redemption exactly once per order (enforced in the database).
 * Safe to call from both the verify path and the webhook.
 */
export async function recordCouponRedemption(
  admin: any,
  orderId: string,
  reference: string | null,
): Promise<void> {
  try {
    await admin.rpc("record_coupon_redemption", {
      _order_id: orderId,
      _paystack_reference: reference,
    });
  } catch {
    /* redemption accounting must never block access provisioning */
  }
}
