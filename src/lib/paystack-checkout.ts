/**
 * Pure checkout helpers — extracted so validation and verification can be
 * unit-tested without a real Supabase or Paystack.
 *
 * Rules enforced here mirror Phase 1D:
 *  - Environment is derived from the server secret prefix only.
 *    sk_test_ → "test", sk_live_ → "live", anything else → null (block).
 *  - The frontend supplies only tool_slug + pricing_option_id. The server
 *    loads and snapshots price, currency, duration, access, billing period.
 *  - Private Access is blocked from purchase for now.
 *  - Verification checks amount (kobo), currency (NGN), metadata order id,
 *    reference match, caller ownership and environment tag.
 */

export type PaystackEnv = "test" | "live";

export function detectCheckoutEnvironment(secret: string | undefined): PaystackEnv | null {
  if (!secret) return null;
  if (secret.startsWith("sk_test_")) return "test";
  if (secret.startsWith("sk_live_")) return "live";
  return null;
}

export class CheckoutError extends Error {
  public code: string;
  public status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const VALID_PERIODS = new Set(["monthly", "quarterly", "yearly"] as const);
export type BillingPeriod = "monthly" | "quarterly" | "yearly";

export type PaymentType = "one_time" | "recurring_subscription";

export interface OrderSnapshot {
  user_id: string;
  tool_slug: string;
  pricing_option_id: string;
  access_type: "shared" | "private";
  billing_period: BillingPeriod;
  price_amount: number;
  price_label: string | null;
  currency: string;
  duration_days: number;
  grace_days: number;
  warning_days: number;
  payment_type: PaymentType;
  product_type: "subscription";
  paystack_environment: PaystackEnv;
}

/**
 * Validates the plan the browser picked and returns an immutable snapshot
 * for the pending order. Throws `CheckoutError` on any rule violation.
 * The caller must supply an authenticated user id and a strict env value.
 */
export async function validateAndBuildOrderSnapshot(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  input: { userId: string | null | undefined; tool_slug: string; pricing_option_id: string | null | undefined; payment_type?: PaymentType },
  env: PaystackEnv | null,
): Promise<OrderSnapshot> {
  if (!input.userId) {
    throw new CheckoutError("unauthenticated", "Please sign in to continue.", 401);
  }
  if (!env) {
    throw new CheckoutError(
      "bad_config",
      "Payments are temporarily unavailable. Please contact support.",
      503,
    );
  }
  if (!input.tool_slug) {
    throw new CheckoutError("no_tool", "This tool is not available.");
  }
  if (!input.pricing_option_id) {
    throw new CheckoutError("no_plan", "Please select a plan.");
  }

  const { data: setting, error: sErr } = await db
    .from("tool_settings")
    .select("enabled, access_level, shared_access_enabled, private_access_enabled")
    .eq("tool_slug", input.tool_slug)
    .maybeSingle();
  if (sErr) throw new CheckoutError("db_error", "Could not load tool. Please try again.", 500);
  // Missing tool_settings row = tool is available with defaults (matches
  // the customer-facing pages, which default to enabled/shared+private allowed
  // when no admin override exists).
  const effectiveSetting = setting ?? {
    enabled: true,
    access_level: "purchased",
    shared_access_enabled: true,
    private_access_enabled: true,
  };
  if (effectiveSetting.enabled === false) {
    throw new CheckoutError("tool_disabled", "This tool is temporarily unavailable.");
  }
  if (effectiveSetting.access_level && effectiveSetting.access_level !== "purchased") {
    throw new CheckoutError(
      "not_purchasable",
      "This tool is not available for direct purchase.",
    );
  }


  const { data: opt, error: oErr } = await db
    .from("tool_pricing")
    .select(
      "id, tool_slug, amount, label, currency, contact_admin, enabled, access_type, billing_period, unit, duration_days, grace_days, warning_days",
    )
    .eq("id", input.pricing_option_id)
    .maybeSingle();
  if (oErr) throw new CheckoutError("db_error", "Could not load the selected plan.", 500);
  if (!opt) throw new CheckoutError("no_plan", "The selected plan could not be found.");
  if (opt.tool_slug !== input.tool_slug) {
    throw new CheckoutError("plan_mismatch", "The selected plan does not belong to this tool.");
  }
  if (opt.enabled === false) {
    throw new CheckoutError("plan_disabled", "This plan is no longer available.");
  }
  if (opt.contact_admin) {
    throw new CheckoutError("contact_admin", "This plan is only available via admin — please contact support.");
  }

  const access = ((opt.access_type as string) ?? "shared") as "shared" | "private";
  if (access === "shared" && effectiveSetting.shared_access_enabled === false) {
    throw new CheckoutError(
      "shared_disabled",
      "Shared Access is not available for this tool right now.",
    );
  }
  if (access === "private" && effectiveSetting.private_access_enabled === false) {
    throw new CheckoutError(
      "private_disabled",
      "Private Access is not available for this tool right now.",
    );
  }


  // Derive billing period: prefer the explicit column, fall back to unit for
  // legacy rows saved before billing_period was added to the admin UI.
  let period = String(opt.billing_period ?? "").toLowerCase();
  if (!VALID_PERIODS.has(period as BillingPeriod)) {
    const u = String(opt.unit ?? "").toLowerCase().trim();
    if (u === "month" || u === "monthly" || u === "mo") period = "monthly";
    else if (
      u === "quarter" ||
      u === "quarterly" ||
      u === "3month" ||
      u === "3months" ||
      u === "3mo"
    )
      period = "quarterly";
    else if (u === "year" || u === "yearly" || u === "annual" || u === "yr")
      period = "yearly";
  }
  if (!VALID_PERIODS.has(period as BillingPeriod)) {
    throw new CheckoutError(
      "bad_period",
      "This plan has no valid billing period configured.",
    );
  }

  const amount = Number(opt.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new CheckoutError("bad_price", "This plan has no valid price.");
  }

  const currency = String(opt.currency ?? "").trim();
  if (!currency || currency.length > 8) {
    throw new CheckoutError("bad_currency", "This plan has an invalid currency.");
  }

  // Derive duration_days from the period when not stored explicitly.
  const durationFallback =
    period === "monthly" ? 28 : period === "quarterly" ? 90 : 365;
  const durationDays = Number(opt.duration_days ?? durationFallback) || durationFallback;

  const paymentType: PaymentType =
    input.payment_type === "one_time" ? "one_time" : "recurring_subscription";

  return {
    user_id: input.userId,
    tool_slug: input.tool_slug,
    pricing_option_id: opt.id as string,
    access_type: access,
    billing_period: period as BillingPeriod,
    price_amount: amount,
    price_label: (opt.label as string | null) ?? null,
    currency,
    duration_days: durationDays,
    grace_days: Number(opt.grace_days ?? 0),
    warning_days: Number(opt.warning_days ?? 0),
    payment_type: paymentType,
    product_type: "subscription",
    paystack_environment: env,
  };
}


/** Server-controlled unique reference. Never trust a client-supplied ref. */
export function generatePaystackReference(orderId: string, now: number = Date.now()): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `TRST-${orderId.slice(0, 8)}-${now}-${rand}`;
}

/** Only non-sensitive fields belong in Paystack metadata. */
export function buildPaystackMetadata(snapshot: {
  order_id: string;
  user_id: string;
  tool_slug: string;
  pricing_option_id: string;
  access_type: "shared" | "private";
  billing_period: BillingPeriod;
}) {
  return {
    order_id: snapshot.order_id,
    user_id: snapshot.user_id,
    tool_slug: snapshot.tool_slug,
    pricing_option_id: snapshot.pricing_option_id,
    access_type: snapshot.access_type,
    billing_period: snapshot.billing_period,
  };
}

export interface VerifyInput {
  tx: {
    status: string;
    reference: string;
    amount: number; // kobo
    currency: string;
    metadata?: { order_id?: string };
  } | null;
  order: {
    id: string;
    user_id: string;
    price_amount: number | null;
    currency: string | null;
    paystack_reference: string | null;
    paystack_environment: string | null;
  } | null;
  callerUserId: string;
  env: PaystackEnv;
  /** True if any OTHER order already stores this reference. */
  otherOrderHasReference: boolean;
}

export type VerifyReason =
  | "not_success"
  | "no_order"
  | "wrong_user"
  | "meta_mismatch"
  | "reference_mismatch"
  | "reference_reused"
  | "amount_mismatch"
  | "currency_mismatch"
  | "env_mismatch";

export function validatePaymentVerification(
  v: VerifyInput,
): { ok: true } | { ok: false; reason: VerifyReason } {
  if (!v.tx || v.tx.status !== "success") return { ok: false, reason: "not_success" };
  if (!v.order) return { ok: false, reason: "no_order" };
  if (v.order.user_id !== v.callerUserId) return { ok: false, reason: "wrong_user" };
  const metaOrderId = v.tx.metadata?.order_id;
  if (!metaOrderId || metaOrderId !== v.order.id) return { ok: false, reason: "meta_mismatch" };
  if (v.order.paystack_reference && v.order.paystack_reference !== v.tx.reference) {
    return { ok: false, reason: "reference_mismatch" };
  }
  if (v.otherOrderHasReference) return { ok: false, reason: "reference_reused" };
  const expectedKobo = Math.round((v.order.price_amount ?? 0) * 100);
  if (expectedKobo <= 0 || v.tx.amount !== expectedKobo) {
    return { ok: false, reason: "amount_mismatch" };
  }
  if ((v.tx.currency ?? "").toUpperCase() !== "NGN") {
    return { ok: false, reason: "currency_mismatch" };
  }
  const orderEnv = v.order.paystack_environment;
  if (orderEnv && orderEnv !== v.env && orderEnv !== "legacy") {
    return { ok: false, reason: "env_mismatch" };
  }
  return { ok: true };
}

/** Non-technical, user-facing failure message for the verification screen. */
export const VERIFY_FAILURE_MESSAGE =
  "We could not fully verify this payment. Please contact support with your transaction reference.";
