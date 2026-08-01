/**
 * Coupons — customer preview + admin management.
 *
 * The preview endpoint returns only the resolved discount so the checkout UI
 * can render the reduced localized price through the same
 * `buildPricingBreakdown` pipeline the server uses to charge Paystack.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { couponRejectionMessage, normaliseCouponCode, type CouponRow } from "@/lib/coupons";
import type { CouponDiscountType } from "@/lib/currency-convert";

export type { CouponRow };

export interface CouponPreview {
  code: string;
  description: string | null;
  discount_type: CouponDiscountType;
  discount_value: number;
  base_amount_ngn: number;
  discount_amount_ngn: number;
  discounted_amount_ngn: number;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function assertAdmin(context: { supabase: any; userId: string }) {
  const { data, error } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", context.userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden");
}

/** Customer — validate a coupon against a specific tool + plan. */
export const previewCoupon = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        code: z.string().min(1).max(64),
        tool_slug: z.string().min(1),
        pricing_option_id: z.string().uuid(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<CouponPreview> => {
    const { detectCheckoutEnvironment, validateAndBuildOrderSnapshot, CheckoutError } = await import(
      "@/lib/paystack-checkout"
    );
    const env = detectCheckoutEnvironment(process.env.PAYSTACK_SECRET_KEY);

    let snapshot;
    try {
      snapshot = await validateAndBuildOrderSnapshot(
        context.supabase,
        {
          userId: context.userId,
          tool_slug: data.tool_slug,
          pricing_option_id: data.pricing_option_id,
        },
        env,
      );
    } catch (err) {
      if (err instanceof CheckoutError) throw new Error(err.message);
      throw err;
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { resolveCouponForCheckout } = await import("@/lib/coupons.server");
    const result = await resolveCouponForCheckout(supabaseAdmin, {
      code: data.code,
      userId: context.userId,
      tool_slug: snapshot.tool_slug,
      access_type: snapshot.access_type,
      billing_period: snapshot.billing_period,
      base_amount_ngn: snapshot.price_amount,
    });
    if (!result.ok) throw new Error(couponRejectionMessage(result.reason));

    return {
      code: normaliseCouponCode(result.coupon.code),
      description: result.coupon.description,
      discount_type: result.coupon.discount_type,
      discount_value: Number(result.coupon.discount_value),
      base_amount_ngn: snapshot.price_amount,
      discount_amount_ngn: result.discount_amount_ngn,
      discounted_amount_ngn: result.discounted_amount_ngn,
    };
  });

/** Admin — list every coupon with usage counters. */
export const adminListCoupons = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { data, error } = await context.supabase
      .from("coupons")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { coupons: (data ?? []) as CouponRow[] };
  });

const couponInput = z.object({
  code: z.string().min(2).max(64),
  description: z.string().max(500).nullable().optional(),
  discount_type: z.enum(["percent", "amount"]),
  discount_value: z.number().positive(),
  tool_slug: z.string().nullable().optional(),
  access_type: z.enum(["shared", "private"]).nullable().optional(),
  billing_period: z.enum(["monthly", "quarterly", "yearly"]).nullable().optional(),
  min_amount_ngn: z.number().nonnegative().nullable().optional(),
  max_redemptions: z.number().int().positive().nullable().optional(),
  max_per_user: z.number().int().min(0).default(1),
  starts_at: z.string().nullable().optional(),
  ends_at: z.string().nullable().optional(),
  is_active: z.boolean().default(true),
});

function normalisePayload(input: z.infer<typeof couponInput>) {
  if (input.discount_type === "percent" && input.discount_value > 100) {
    throw new Error("Percentage discount cannot exceed 100%.");
  }
  return {
    code: normaliseCouponCode(input.code),
    description: input.description ?? null,
    discount_type: input.discount_type,
    discount_value: input.discount_value,
    currency: "NGN",
    tool_slug: input.tool_slug || null,
    access_type: input.access_type ?? null,
    billing_period: input.billing_period ?? null,
    min_amount_ngn: input.min_amount_ngn ?? null,
    max_redemptions: input.max_redemptions ?? null,
    max_per_user: input.max_per_user,
    starts_at: input.starts_at || null,
    ends_at: input.ends_at || null,
    is_active: input.is_active,
  };
}

export const adminCreateCoupon = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => couponInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { error } = await context.supabase
      .from("coupons")
      .insert({ ...normalisePayload(data), created_by: context.userId } as never);
    if (error) {
      throw new Error(
        error.code === "23505" || /duplicate/i.test(error.message)
          ? "A coupon with that code already exists."
          : error.message,
      );
    }
    return { ok: true };
  });

export const adminUpdateCoupon = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => couponInput.extend({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { id, ...rest } = data;
    const { error } = await context.supabase
      .from("coupons")
      .update(normalisePayload(rest as z.infer<typeof couponInput>) as never)
      .eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminSetCouponActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid(), is_active: z.boolean() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { error } = await context.supabase
      .from("coupons")
      .update({ is_active: data.is_active } as never)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminDeleteCoupon = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { error } = await context.supabase.from("coupons").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Admin — recent redemptions for reporting. */
export const adminListCouponRedemptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { data, error } = await context.supabase
      .from("coupon_redemptions")
      .select("id, coupon_code, user_id, order_id, discount_amount_ngn, base_amount_ngn, payment_currency, final_amount, paystack_reference, created_at")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return { redemptions: data ?? [] };
  });
