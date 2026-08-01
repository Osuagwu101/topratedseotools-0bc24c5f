/**
 * Paystack — subscription initialization, verification, Disable Renewal.
 * Enum values match DB CHECK constraints (see paystack-webhook.ts header).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const PAYSTACK_BASE = "https://api.paystack.co";


async function paystack<T>(path: string, init?: RequestInit): Promise<T> {
  const key = process.env.PAYSTACK_SECRET_KEY;
  if (!key) throw new Error("Payments are not configured yet. Contact support.");
  const res = await fetch(`${PAYSTACK_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const json = (await res.json()) as { status: boolean; message: string; data: T };
  if (!res.ok || !json.status) {
    throw new Error(json.message || `Paystack error (${res.status})`);
  }
  return json.data;
}

function paystackApi() {
  return {
    createPlan: async (input: {
      name: string;
      amount: number;
      interval: "monthly" | "quarterly" | "annually";
      currency: string;
    }) =>
      paystack<{ plan_code: string }>("/plan", {
        method: "POST",
        body: JSON.stringify(input),
      }),
  };
}

export const initializePaystackPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        order_id: z.string().uuid(),
        callback_url: z.string().url(),
        payment_type: z.enum(["one_time", "recurring_subscription"]).optional(),
        payment_currency: z.enum(["NGN", "GHS", "KES", "ZAR", "USD"]).optional(),
        coupon_code: z.string().min(1).max(64).optional().nullable(),
      })
      .parse(input),
  )

  .handler(async ({ data, context }) => {
    const {
      detectCheckoutEnvironment,
      validateAndBuildOrderSnapshot,
      generatePaystackReference,
      buildPaystackMetadata,
      CheckoutError,
    } = await import("@/lib/paystack-checkout");
    const { ensurePlanFromSnapshot } = await import("@/lib/paystack-plans");

    // Emergency controls — admin can halt new orders / payments without code.
    const { data: gate } = await context.supabase
      .from("site_settings")
      .select("orders_paused, payments_paused, maintenance_mode")
      .eq("id", true)
      .maybeSingle();
    if (gate?.maintenance_mode) throw new Error("The site is currently in maintenance mode. Please try again shortly.");
    if (gate?.orders_paused) throw new Error("New orders are temporarily paused. Please try again shortly.");
    if (gate?.payments_paused) throw new Error("Payments are temporarily paused. Please try again shortly.");

    const env = detectCheckoutEnvironment(process.env.PAYSTACK_SECRET_KEY);
    if (!env) throw new Error("Payments are temporarily unavailable. Please contact support.");

    const paymentType = data.payment_type ?? "recurring_subscription";
    const isRecurring = paymentType === "recurring_subscription";

    const { data: order, error } = await context.supabase
      .from("tool_orders")
      .select("id, user_id, tool_slug, pricing_option_id, status")
      .eq("id", data.order_id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!order) throw new Error("Order not found");
    const orderSafe = order;
    if (order.status === "approved") throw new Error("This subscription is already active");

    let snapshot;
    try {
      snapshot = await validateAndBuildOrderSnapshot(
        context.supabase,
        {
          userId: context.userId,
          tool_slug: order.tool_slug as string,
          pricing_option_id: order.pricing_option_id as string | null,
          payment_type: paymentType,
        },
        env,
      );
    } catch (err) {
      if (err instanceof CheckoutError) throw new Error(err.message);
      throw err;
    }

    // Coupons: NGN is the source of truth. The code is re-resolved here and
    // the discount is fed into buildPricingBreakdown, so the discounted NGN
    // base flows through conversion + the international adjustment exactly
    // like the price shown to the customer.
    const chosenCurrency = (data.payment_currency ?? "NGN") as "NGN" | "GHS" | "KES" | "ZAR" | "USD";
    const { buildPricingBreakdown } = await import("@/lib/currency-convert");

    let discount: { type: "percent" | "amount"; value: number; code: string } | null = null;
    let couponId: string | null = null;
    if (data.coupon_code) {
      if (isRecurring) {
        throw new Error(
          "Coupon codes apply to one-time payments only. Choose One-Time Payment to use your coupon.",
        );
      }
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { resolveCouponForCheckout } = await import("@/lib/coupons.server");
      const { couponRejectionMessage } = await import("@/lib/coupons");
      const resolved = await resolveCouponForCheckout(supabaseAdmin, {
        code: data.coupon_code,
        userId: context.userId,
        tool_slug: snapshot.tool_slug,
        access_type: snapshot.access_type,
        billing_period: snapshot.billing_period,
        base_amount_ngn: snapshot.price_amount,
      });
      if (!resolved.ok) throw new Error(couponRejectionMessage(resolved.reason));
      discount = {
        type: resolved.discount.type,
        value: resolved.discount.value,
        code: resolved.discount.code as string,
      };
      couponId = resolved.coupon.id;
    }

    // Multi-currency: server re-validates chosen currency + recomputes the
    // breakdown from DB rates. Never trusts client-supplied amounts.
    // `chosenCurrency` is the *display* currency the customer selected — the
    // currency Paystack is charged in is resolved separately below.
    let currencyBreakdown = buildPricingBreakdown({
      ngn: snapshot.price_amount,
      currency: "NGN",
      rate: 1,
      surchargePercent: 0,
      surchargeEnabled: false,
      discount,
    });
    let merchantCurrencies: string[] = ["NGN"];
    if (chosenCurrency !== "NGN") {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const [{ data: cs }, { data: rateRow }] = await Promise.all([
        supabaseAdmin
          .from("currency_settings")
          .select("switching_enabled, surcharge_enabled, surcharge_percent, supported_currencies, merchant_currencies")
          .eq("id", true)
          .maybeSingle(),
        supabaseAdmin
          .from("exchange_rates")
          .select("rate, expires_at")
          .eq("base_currency", "NGN")
          .eq("quote_currency", chosenCurrency)
          .maybeSingle(),
      ]);
      const settings = cs as { switching_enabled: boolean; surcharge_enabled: boolean; surcharge_percent: number; supported_currencies: string[]; merchant_currencies?: string[] | null } | null;
      if (!settings?.switching_enabled) throw new Error("Currency switching is currently disabled.");
      if (!settings.supported_currencies.includes(chosenCurrency)) {
        throw new Error(`${chosenCurrency} is not supported at the moment.`);
      }
      merchantCurrencies = settings.merchant_currencies?.length ? settings.merchant_currencies : ["NGN"];
      const rate = Number((rateRow as { rate?: number } | null)?.rate ?? 0);
      const expires = (rateRow as { expires_at?: string } | null)?.expires_at;
      if (!rate || rate <= 0) throw new Error(`No exchange rate available for ${chosenCurrency}. Please try again shortly or pay in NGN.`);
      if (expires && new Date(expires).getTime() < Date.now()) {
        throw new Error(`Exchange rate for ${chosenCurrency} is stale. Please refresh and try again.`);
      }
      currencyBreakdown = buildPricingBreakdown({
        ngn: snapshot.price_amount,
        currency: chosenCurrency,
        rate,
        surchargePercent: Number(settings.surcharge_percent ?? 3),
        surchargeEnabled: !!settings.surcharge_enabled,
        discount,
      });
    }
    // Display currency vs. payment currency. Our Paystack account can only
    // charge its merchant currencies (NGN today), so for GHS/KES/ZAR/USD the
    // customer-facing total is converted back to NGN for the actual charge.
    const { resolveChargePlan } = await import("@/lib/currency-convert");
    const charge = resolveChargePlan(currencyBreakdown, merchantCurrencies);
    if (charge.payment_minor_units <= 0) {
      throw new Error("This coupon reduces the total to zero. Please contact support to complete this order.");
    }


    let planCode: string | null = null;
    if (isRecurring) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const res = await ensurePlanFromSnapshot(supabaseAdmin, paystackApi(), snapshot, {
        currency: charge.payment_currency,
        priceAmount: charge.payment_amount,
      });
      planCode = res.plan_code;
    }

    const email = context.claims?.email ?? `${context.userId}@users.local`;
    const reference = generatePaystackReference(orderSafe.id as string);
    const metadata = {
      ...buildPaystackMetadata({
        order_id: orderSafe.id as string,
        user_id: orderSafe.user_id as string,
        tool_slug: snapshot.tool_slug,
        pricing_option_id: snapshot.pricing_option_id,
        access_type: snapshot.access_type,
        billing_period: snapshot.billing_period,
      }),
      payment_type: paymentType,
      payment_currency: charge.payment_currency,
      payment_amount: charge.payment_amount,
      customer_display_currency: charge.display_currency,
      customer_display_amount: charge.display_amount,
      base_amount_ngn: currencyBreakdown.base_amount_ngn,
      coupon_code: currencyBreakdown.discount_code,
      discount_amount_ngn: currencyBreakdown.discount_amount_ngn,
      discounted_amount_ngn: currencyBreakdown.discounted_amount_ngn,
      exchange_rate: currencyBreakdown.exchange_rate,
      international_fee_amount: currencyBreakdown.international_fee_amount,
      final_amount: currencyBreakdown.final_amount,
    };

    // Recurring: restrict to channels Paystack supports for subscriptions.
    // One-time: omit `channels` so every one-time channel enabled on the
    // Paystack account (bank transfer, USSD, pay with bank, QR, etc.) shows.
    const initBody: Record<string, unknown> = {
      email,
      amount: charge.payment_minor_units,
      currency: charge.payment_currency,
      reference,
      callback_url: data.callback_url,
      metadata,
    };
    if (isRecurring && planCode) {
      initBody.plan = planCode;
      initBody.channels = ["card", "direct_debit"];
    }


    const init = await paystack<{ authorization_url: string; access_code: string; reference: string }>(
      "/transaction/initialize",
      { method: "POST", body: JSON.stringify(initBody) },
    );

    const fulfilment = snapshot.access_type === "private" ? "pending" : "not_required";

    await context.supabase
      .from("tool_orders")
      .update({
        paystack_reference: init.reference,
        paystack_plan_code: planCode,
        access_type: snapshot.access_type,
        billing_period: snapshot.billing_period,
        price_amount: snapshot.price_amount,
        currency: snapshot.currency,
        duration_days: snapshot.duration_days,
        grace_days: snapshot.grace_days,
        warning_days: snapshot.warning_days,
        payment_type: paymentType,
        product_type: snapshot.product_type,
        paystack_environment: snapshot.paystack_environment,
        subscription_status: "pending",
        renewal_status: isRecurring ? "enabled" : "not_applicable",
        fulfilment_status: fulfilment,
        payment_currency: charge.payment_currency,
        exchange_rate_snapshot: currencyBreakdown.exchange_rate,
        international_fee_amount: currencyBreakdown.international_fee_amount,
        final_amount_charged: charge.payment_amount,
        display_currency: charge.display_currency,
        display_amount: charge.display_amount,
        coupon_id: couponId,
        coupon_code: currencyBreakdown.discount_code,
        discount_amount_ngn: currencyBreakdown.discount_amount_ngn,
        discounted_amount_ngn: currencyBreakdown.discounted_amount_ngn,
      })
      .eq("id", orderSafe.id);

    // Record an "initiated" payment row so a single transaction reference is
    // tracked from checkout through verification, receipt delivery, and
    // reconciliation. Every later webhook / verify / recheck upserts here.
    {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: existing } = await supabaseAdmin
        .from("tool_payments")
        .select("id")
        .eq("paystack_reference", init.reference)
        .maybeSingle();
      if (!existing) {
        const { data: inserted } = await supabaseAdmin
          .from("tool_payments")
          .insert({
            order_id: orderSafe.id,
            user_id: orderSafe.user_id,
            tool_slug: snapshot.tool_slug,
            amount: snapshot.price_amount,
            currency: snapshot.currency,
            payment_status: "initiated",
            payment_type: paymentType,
            classification: isRecurring ? "initial" : "one_time",
            paystack_reference: init.reference,
            paystack_environment: snapshot.paystack_environment,
            customer_email: email,
            access_type: snapshot.access_type,
            billing_period: snapshot.billing_period,
            price_label: snapshot.price_label,
            source: "paystack",
            initiated_at: new Date().toISOString(),
            last_status_change_at: new Date().toISOString(),
            base_amount_ngn: currencyBreakdown.base_amount_ngn,
            coupon_code: currencyBreakdown.discount_code,
            discount_amount_ngn: currencyBreakdown.discount_amount_ngn,
            payment_currency: charge.payment_currency,
            exchange_rate: currencyBreakdown.exchange_rate,
            converted_amount: currencyBreakdown.converted_amount,
            international_fee_percent: currencyBreakdown.international_fee_percent,
            international_fee_amount: currencyBreakdown.international_fee_amount,
            final_amount: charge.payment_amount,
            display_currency: charge.display_currency,
            display_amount: charge.display_amount,
          } as never)
          .select("id")
          .maybeSingle();
        if (inserted?.id) {
          await supabaseAdmin.from("tool_payment_status_history").insert({
            payment_id: inserted.id,
            from_status: null,
            to_status: "initiated",
            source: "checkout",
            note: "Transaction initiated at Paystack",
            created_by: context.userId,
          } as never);
        }
      }
    }

    // Schedule an abandoned-checkout reminder — the dispatcher will cancel it
    // if the order is completed or fails before the delay elapses.
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { queueEmail, getEmailSettings } = await import("@/lib/email/queue");
      const settings = await getEmailSettings(supabaseAdmin);
      const delayH = settings?.abandoned_delay_hours ?? 24;
      const scheduled = new Date(Date.now() + delayH * 3600_000).toISOString();
      const to = email;
      if (to) {
        await queueEmail(supabaseAdmin, {
          eventKey: `abandoned:${orderSafe.id}`,
          templateKey: "abandoned_checkout",
          recipient: to,
          relatedOrderId: orderSafe.id as string,
          relatedUserId: orderSafe.user_id as string,
          scheduledFor: scheduled,
          payload: {
            name: "there",
            tool: snapshot.tool_slug,
            amount: snapshot.price_amount,
            currency: snapshot.currency,
            access_type: snapshot.access_type,
            billing_period: snapshot.billing_period,
            resume_url: `https://topratedseotools.com/order/${snapshot.tool_slug}`,
          },
        });
      }
    } catch (err) {
      console.warn("[email] failed to schedule abandoned reminder", err);
    }

    return { authorization_url: init.authorization_url, reference: init.reference };
  });



/** Fallback verify — used when the browser returns from Paystack before the webhook fires. */
export const verifyPaystackPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ reference: z.string().min(4).max(120) }).parse(input))
  .handler(async ({ data, context }) => {
    const { detectCheckoutEnvironment, validatePaymentVerification, VERIFY_FAILURE_MESSAGE } =
      await import("@/lib/paystack-checkout");

    const env = detectCheckoutEnvironment(process.env.PAYSTACK_SECRET_KEY);
    if (!env) throw new Error(VERIFY_FAILURE_MESSAGE);

    const tx = await paystack<{
      status: string;
      reference: string;
      amount: number;
      currency: string;
      metadata: { order_id?: string; user_id?: string };
      customer?: { customer_code?: string };
    }>(`/transaction/verify/${encodeURIComponent(data.reference)}`);

    const orderId = tx.metadata?.order_id;
    if (!orderId) throw new Error(VERIFY_FAILURE_MESSAGE);

    const { data: order } = await context.supabase
      .from("tool_orders")
      .select(
        "id, user_id, status, price_amount, currency, paystack_reference, paystack_environment, duration_days, grace_days, access_type, fulfilment_status, payment_type, payment_currency, final_amount_charged, display_currency, display_amount, exchange_rate_snapshot, international_fee_amount, coupon_code, discount_amount_ngn, discounted_amount_ngn",
      )
      .eq("id", orderId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!order) throw new Error(VERIFY_FAILURE_MESSAGE);
    const orderSafe = order;
    // Charged money = what Paystack actually took (merchant currency),
    // falling back to the NGN order price for legacy rows.
    const chargedCurrency =
      ((order as { payment_currency?: string | null }).payment_currency ?? tx.currency ?? "NGN").toUpperCase();
    const chargedAmount =
      ((order as { final_amount_charged?: number | null }).final_amount_charged) ??
      (orderSafe.price_amount as number | null) ??
      tx.amount / 100;
    // What the customer saw and should see again in receipts/emails.
    const displayCurrency =
      ((order as { display_currency?: string | null }).display_currency ?? chargedCurrency).toUpperCase();
    const displayAmount =
      ((order as { display_amount?: number | null }).display_amount) ?? chargedAmount;
    if (order.status === "approved") {
      const { data: orderFull } = await context.supabase
        .from("tool_orders")
        .select("tool_slug")
        .eq("id", orderId)
        .maybeSingle();
      return {
        ok: true,
        orderId,
        alreadyActive: true,
        purchase: {
          order_id: orderId,
          tool_slug: (orderFull as { tool_slug?: string } | null)?.tool_slug ?? null,
          amount: chargedAmount,
          currency: chargedCurrency,
          reference: tx.reference,
          event_id: `purchase:${orderId}`,
        },
      };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: refClash } = await supabaseAdmin
      .from("tool_orders")
      .select("id")
      .eq("paystack_reference", tx.reference)
      .neq("id", orderId)
      .maybeSingle();

    const verdict = validatePaymentVerification({
      tx,
      order: {
        id: orderSafe.id as string,
        user_id: orderSafe.user_id as string,
        price_amount: (orderSafe.price_amount as number | null) ?? null,
        currency: (orderSafe.currency as string | null) ?? null,
        paystack_reference: (order.paystack_reference as string | null) ?? null,
        paystack_environment: (order.paystack_environment as string | null) ?? null,
        payment_currency: ((order as { payment_currency?: string | null }).payment_currency) ?? null,
        final_amount_charged: ((order as { final_amount_charged?: number | null }).final_amount_charged) ?? null,
      },
      callerUserId: context.userId,
      env,
      otherOrderHasReference: !!refClash,
    });

    if (!verdict.ok) throw new Error(VERIFY_FAILURE_MESSAGE);

    const paidAt = new Date();
    const dur = (order.duration_days as number) ?? 28;
    const grace = (order.grace_days as number) ?? 0;
    const access = ((order.access_type as string) ?? "shared") as "shared" | "private";
    const isOneTime = (order.payment_type as string) === "one_time";
    const renewalStatus = isOneTime ? "not_applicable" : "enabled";

    // Idempotently record this successful charge in tool_payments so the
    // admin revenue dashboard reflects it even when the webhook is delayed
    // or never delivered (e.g. checkout completed via the browser return).
    // If an "initiated" row exists for this reference (created at init time),
    // update it in place so we keep a single canonical transaction record.
    if (tx.reference) {
      const { data: dupPay } = await supabaseAdmin
        .from("tool_payments")
        .select("id, payment_status")
        .eq("paystack_reference", tx.reference)
        .maybeSingle();
      const paystackChannel = (tx as unknown as { channel?: string }).channel ?? null;
      const paystackId = (tx as unknown as { id?: string | number }).id;
      if (dupPay) {
        if (dupPay.payment_status !== "successful") {
          await supabaseAdmin
            .from("tool_payments")
            .update({
              payment_status: "successful",
              paid_at: paidAt.toISOString(),
              paystack_status: "success",
              paystack_last_checked_at: paidAt.toISOString(),
              paystack_transaction_id: paystackId ? String(paystackId) : null,
              payment_channel: paystackChannel,
              last_status_change_at: paidAt.toISOString(),
            } as never)
            .eq("id", dupPay.id);
          await supabaseAdmin.from("tool_payment_status_history").insert({
            payment_id: dupPay.id,
            from_status: dupPay.payment_status,
            to_status: "successful",
            source: "verify",
            paystack_status: "success",
            note: "Customer returned from Paystack — verified successful",
            created_by: context.userId,
          } as never);
        }
      } else {
        const { data: orderFull } = await supabaseAdmin
          .from("tool_orders")
          .select("tool_slug, access_type, billing_period")
          .eq("id", orderSafe.id)
          .maybeSingle();
        const { data: inserted } = await supabaseAdmin
          .from("tool_payments")
          .insert({
            order_id: orderSafe.id,
            user_id: orderSafe.user_id,
            tool_slug: (orderFull?.tool_slug as string) ?? "unknown",
            amount: (orderSafe.price_amount as number | null) ?? tx.amount / 100,
            currency: (orderSafe.currency as string | null) ?? "NGN",
            // Coupon-aware: the NGN amount that actually flowed into the
            // conversion pipeline, plus the discount taken off the base.
            base_amount_ngn:
              ((order as { discounted_amount_ngn?: number | null }).discounted_amount_ngn) ??
              (orderSafe.price_amount as number | null) ??
              null,
            coupon_code: ((order as { coupon_code?: string | null }).coupon_code) ?? null,
            discount_amount_ngn:
              Number((order as { discount_amount_ngn?: number | null }).discount_amount_ngn ?? 0) || 0,
            payment_currency: chargedCurrency,
            exchange_rate:
              ((order as { exchange_rate_snapshot?: number | null }).exchange_rate_snapshot) ?? null,
            converted_amount:
              chargedAmount -
              (Number((order as { international_fee_amount?: number | null }).international_fee_amount ?? 0) || 0),
            international_fee_amount:
              Number((order as { international_fee_amount?: number | null }).international_fee_amount ?? 0) || 0,
            final_amount: chargedAmount,
            payment_status: "successful",
            payment_type: isOneTime ? "one_time" : "recurring_subscription",
            classification: isOneTime ? "one_time" : "initial",
            paystack_reference: tx.reference,
            paystack_environment: env,
            paystack_status: "success",
            paystack_transaction_id: paystackId ? String(paystackId) : null,
            paystack_last_checked_at: paidAt.toISOString(),
            payment_channel: paystackChannel,
            access_type: orderFull?.access_type ?? null,
            billing_period: orderFull?.billing_period ?? null,
            paid_at: paidAt.toISOString(),
            last_status_change_at: paidAt.toISOString(),
          } as never)
          .select("id")
          .maybeSingle();
        if (inserted?.id) {
          await supabaseAdmin.from("tool_payment_status_history").insert({
            payment_id: inserted.id,
            from_status: null,
            to_status: "successful",
            source: "verify",
            paystack_status: "success",
            note: "Verified successful on customer return",
            created_by: context.userId,
          } as never);
        }
      }
    }

    // Coupon usage is counted once per order (enforced in the database), so
    // the verify path and the webhook can both call this safely.
    if ((order as { coupon_code?: string | null }).coupon_code) {
      const { recordCouponRedemption } = await import("@/lib/coupons.server");
      await recordCouponRedemption(supabaseAdmin, orderSafe.id as string, tx.reference ?? null);
    }



    // Helper — best-effort recipient lookup for post-payment emails.
    async function queuePostPayment(kind: "shared_success" | "private_pending", extra: Record<string, unknown>) {
      try {
        const { queueEmail } = await import("@/lib/email/queue");
        const { data: prof } = await supabaseAdmin
          .from("profiles")
          .select("email, full_name")
          .eq("id", orderSafe.user_id)
          .maybeSingle();
        const to = ((prof as { email?: string } | null)?.email) ?? context.claims?.email ?? null;
        const name = (prof as { full_name?: string } | null)?.full_name ?? "there";
        if (!to) return;
        const { data: orderFull } = await supabaseAdmin
          .from("tool_orders")
          .select("tool_slug, access_type, billing_period")
          .eq("id", orderSafe.id)
          .maybeSingle();
        const payload = {
          name,
          tool: orderFull?.tool_slug ?? "your tool",
          access_type: orderFull?.access_type ?? "shared",
          billing_period: orderFull?.billing_period ?? "monthly",
          amount: chargedAmount,
          currency: chargedCurrency,
          reference: tx.reference,
          dashboard_url: "https://topratedseotools.com/dashboard",
          ...extra,
        };
        if (kind === "shared_success") {
          await queueEmail(supabaseAdmin, {
            eventKey: `payment_success:${orderId}`,
            templateKey: "payment_success",
            recipient: to,
            relatedOrderId: orderId,
            relatedUserId: orderSafe.user_id as string,
            payload: {
              ...payload,
              start_date: paidAt.toISOString(),
              expiry_date: new Date(paidAt.getTime() + (dur + grace) * 86400_000).toISOString(),
            },
          });
        } else {
          await queueEmail(supabaseAdmin, {
            eventKey: `private_pending:${orderId}`,
            templateKey: "private_pending",
            recipient: to,
            relatedOrderId: orderId,
            relatedUserId: orderSafe.user_id as string,
            payload,
          });
        }
      } catch (err) {
        console.warn("[email] failed to queue post-payment email", err);
      }
    }

    if (access === "private") {
      const deadline = new Date(paidAt.getTime() + 6 * 60 * 60 * 1000);
      await supabaseAdmin
        .from("tool_orders")
        .update({
          status: "approved",
          approved_at: paidAt.toISOString(),
          paid_at: paidAt.toISOString(),
          paystack_reference: tx.reference,
          paystack_environment: env,
          paystack_customer_code: tx.customer?.customer_code ?? null,
          subscription_status: "pending",
          renewal_status: renewalStatus,
          payment_status: "successful",
          fulfilment_status: "pending",
          fulfilment_deadline_at: deadline.toISOString(),
        })
        .eq("id", orderId)
        .neq("status", "approved");
      try {
        const { tryAutoAssignAccount } = await import("@/lib/account-pool.functions");
        await tryAutoAssignAccount(supabaseAdmin, orderId);
      } catch (e) { console.warn("[account-pool] private auto-assign failed", e); }
      await queuePostPayment("private_pending", {
        fulfil_by: deadline.toISOString(),
        contact_admin_line: "",
      });
      await trackConversionFromServer({
        access,
        isOneTime,
        orderId: orderSafe.id as string,
        userId: orderSafe.user_id as string,
        reference: tx.reference,
        amount: (orderSafe.price_amount as number | null) ?? tx.amount / 100,
        currency: (orderSafe.currency as string | null) ?? "NGN",
      });
      return {
        ok: true,
        orderId,
        alreadyActive: false,
        fulfilment: "pending",
        purchase: {
          order_id: orderSafe.id as string,
          tool_slug: null,
          amount: chargedAmount,
          currency: chargedCurrency,
          reference: tx.reference,
          event_id: `subscription_start:${orderSafe.id as string}`,
        },
      };
    }

    const expiresAt = new Date(paidAt.getTime() + (dur + grace) * 86400_000);
    const nextPaymentAt = new Date(paidAt.getTime() + dur * 86400_000);
    await supabaseAdmin
      .from("tool_orders")
      .update({
        status: "approved",
        approved_at: paidAt.toISOString(),
        paid_at: paidAt.toISOString(),
        subscription_started_at: paidAt.toISOString(),
        paid_through_at: isOneTime ? null : nextPaymentAt.toISOString(),
        current_period_start: paidAt.toISOString(),
        current_period_end: isOneTime ? null : nextPaymentAt.toISOString(),
        next_payment_at: isOneTime ? null : nextPaymentAt.toISOString(),
        expires_at: expiresAt.toISOString(),
        paystack_reference: tx.reference,
        paystack_environment: env,
        paystack_customer_code: tx.customer?.customer_code ?? null,
        subscription_status: isOneTime ? "non_renewing" : "active",
        renewal_status: renewalStatus,
        payment_status: "successful",
        fulfilment_status: "not_required",
      })
      .eq("id", orderId)
      .neq("status", "approved");

    try {
      const { tryAutoAssignAccount } = await import("@/lib/account-pool.functions");
      await tryAutoAssignAccount(supabaseAdmin, orderId);
    } catch (e) { console.warn("[account-pool] shared auto-assign failed", e); }

    await queuePostPayment("shared_success", {});
    await trackConversionFromServer({
      access,
      isOneTime,
      orderId: orderSafe.id as string,
      userId: orderSafe.user_id as string,
      reference: tx.reference,
      amount: (orderSafe.price_amount as number | null) ?? tx.amount / 100,
      currency: (orderSafe.currency as string | null) ?? "NGN",
    });
    const { data: orderFullForReturn } = await supabaseAdmin
      .from("tool_orders")
      .select("tool_slug")
      .eq("id", orderSafe.id)
      .maybeSingle();
    const kind = isOneTime ? "purchase" : "subscription_start";
    return {
      ok: true,
      orderId,
      alreadyActive: false,
      fulfilment: "not_required",
      purchase: {
        order_id: orderSafe.id as string,
        tool_slug: (orderFullForReturn as { tool_slug?: string } | null)?.tool_slug ?? null,
        amount: (orderSafe.price_amount as number | null) ?? tx.amount / 100,
        currency: (orderSafe.currency as string | null) ?? tx.currency ?? "NGN",
        reference: tx.reference,
        event_id: `${kind}:${orderSafe.id as string}`,
      },
    };
  });

/**
 * Fire Meta CAPI conversion after the browser return path activates an order.
 * Uses a stable event_id so if the webhook also fires, Meta dedups.
 */
async function trackConversionFromServer(args: {
  access: "shared" | "private";
  isOneTime: boolean;
  orderId: string;
  userId: string;
  reference: string;
  amount: number;
  currency: string;
}) {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { trackServerConversion, buildEventId } = await import(
      "@/lib/marketing/server-events"
    );
    const { data: prof } = await supabaseAdmin
      .from("profiles")
      .select("email")
      .eq("id", args.userId)
      .maybeSingle();
    const { data: orderFull } = await supabaseAdmin
      .from("tool_orders")
      .select("tool_slug")
      .eq("id", args.orderId)
      .maybeSingle();
    // Private access hasn't been fulfilled yet, so no Purchase there.
    const kind = args.access === "private"
      ? "subscription_start"
      : args.isOneTime
        ? "purchase"
        : "subscription_start";
    await trackServerConversion(supabaseAdmin, {
      kind,
      event_id: buildEventId(kind, args.orderId),
      order_id: args.orderId,
      user_id: args.userId,
      tool_slug: (orderFull as { tool_slug?: string } | null)?.tool_slug ?? null,
      amount: args.amount,
      currency: args.currency,
      email: (prof as { email?: string } | null)?.email ?? null,
      custom: { paystack_reference: args.reference, source: "verify" },
    });
  } catch (err) {
    console.warn("[marketing] verify conversion failed", err);
  }
}

/** Auth — user disables auto-renewal on an active subscription. */
export const disableOrderRenewal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ order_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: order, error } = await context.supabase
      .from("tool_orders")
      .select("id, user_id, paystack_subscription_code, subscription_status, renewal_status")
      .eq("id", data.order_id)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!order) throw new Error("Subscription not found");
    const orderSafe = order;


    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (!order.paystack_subscription_code) {
      await supabaseAdmin
        .from("tool_orders")
        .update({
          renewal_status: "disabled",
          subscription_status: "non_renewing",
          subscription_disabled_at: new Date().toISOString(),
          non_renewal_requested_at: new Date().toISOString(),
        })
        .eq("id", orderSafe.id);
      return { ok: true };
    }

    const code = order.paystack_subscription_code as string;
    const sub = await paystack<{ email_token: string }>(
      `/subscription/${encodeURIComponent(code)}`,
    );
    await paystack("/subscription/disable", {
      method: "POST",
      body: JSON.stringify({ code, token: sub.email_token }),
    });

    await supabaseAdmin
      .from("tool_orders")
      .update({
        renewal_status: "disable_pending",
        subscription_status: "non_renewing",
        non_renewal_requested_at: new Date().toISOString(),
      })
      .eq("id", orderSafe.id);

    try {
      const { queueOrderEmail } = await import("@/lib/email/order-emails");
      await queueOrderEmail(supabaseAdmin, {
        kind: "renewal_disabled",
        orderId: orderSafe.id as string,
        extraPayload: { disabled_at: new Date().toISOString(), source: "customer" },
      });
    } catch (err) {
      console.warn("[email] failed to queue renewal_disabled", err);
    }

    return { ok: true };
  });

