/**
 * Paystack plan helpers — pure functions kept isolated from the
 * `createServerFn` module so they can be unit-tested with a mock DB and a
 * mock `fetch` for the Paystack API.
 *
 * A "plan" in Paystack is the recurring billing template. Each unique
 * (tool_slug, access_type, billing_period, amount, environment) tuple maps
 * to exactly one Paystack plan and one `paystack_plan_mappings` row. If a
 * mapping already exists at the same amount and env, we reuse the plan
 * code and never call Paystack again.
 */

import type { PaystackEnv, BillingPeriod, OrderSnapshot } from "./paystack-checkout";

export type PaystackInterval = "monthly" | "quarterly" | "annually";

export function paystackIntervalFor(period: BillingPeriod): PaystackInterval {
  if (period === "monthly") return "monthly";
  if (period === "quarterly") return "quarterly";
  return "annually";
}

export interface PaystackApi {
  createPlan(input: {
    name: string;
    amount: number; // minor units of `currency`
    interval: PaystackInterval;
    currency: string;
  }): Promise<{ plan_code: string }>;
}

export interface EnsurePlanInput {
  tool_slug: string;
  pricing_option_id: string;
  access_type: "shared" | "private";
  billing_period: BillingPeriod;
  paystack_environment: PaystackEnv;
  /** Amount that Paystack will charge, in the plan's own currency. */
  price_amount: number;
  /** Plan currency (defaults to NGN for legacy callers). */
  currency?: string;
}

/**
 * Look up an active, matching plan mapping and return its plan_code — or
 * create a fresh Paystack plan and persist the mapping. Idempotent per
 * (tool, access, period, amount, currency, env).
 */
export async function ensurePaystackPlanCode(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseAdmin: any,
  api: PaystackApi,
  input: EnsurePlanInput,
): Promise<{ plan_code: string; reused: boolean }> {
  const interval = paystackIntervalFor(input.billing_period);
  const currency = (input.currency ?? "NGN").toUpperCase();

  const { data: existing } = await supabaseAdmin
    .from("paystack_plan_mappings")
    .select("paystack_plan_code, amount_snapshot, currency")
    .eq("tool_slug", input.tool_slug)
    .eq("access_type", input.access_type)
    .eq("billing_period", input.billing_period)
    .eq("paystack_environment", input.paystack_environment)
    .eq("amount_snapshot", input.price_amount)
    .eq("currency", currency)
    .eq("active_for_new_purchases", true)
    .maybeSingle();

  if (existing?.paystack_plan_code) {
    return { plan_code: existing.paystack_plan_code as string, reused: true };
  }

  const plan = await api.createPlan({
    name: `${input.tool_slug} · ${input.access_type} · ${input.billing_period} · ${currency}${input.price_amount}`,
    amount: Math.round(input.price_amount * 100),
    interval,
    currency,
  });

  await supabaseAdmin.from("paystack_plan_mappings").insert({
    tool_slug: input.tool_slug,
    pricing_option_id: input.pricing_option_id,
    access_type: input.access_type,
    billing_period: input.billing_period,
    paystack_environment: input.paystack_environment,
    paystack_interval: interval,
    paystack_plan_code: plan.plan_code,
    amount_snapshot: input.price_amount,
    currency,
    subscription_currency: currency,
    sync_status: "active",
    active_for_new_purchases: true,
    last_verified_at: new Date().toISOString(),
  });

  return { plan_code: plan.plan_code, reused: false };
}

/** Sugar over `ensurePaystackPlanCode` that pulls from an order snapshot. */
export function ensurePlanFromSnapshot(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseAdmin: any,
  api: PaystackApi,
  snapshot: OrderSnapshot,
) {
  return ensurePaystackPlanCode(supabaseAdmin, api, {
    tool_slug: snapshot.tool_slug,
    pricing_option_id: snapshot.pricing_option_id,
    access_type: snapshot.access_type,
    billing_period: snapshot.billing_period,
    paystack_environment: snapshot.paystack_environment,
    price_amount: snapshot.price_amount,
  });
}
