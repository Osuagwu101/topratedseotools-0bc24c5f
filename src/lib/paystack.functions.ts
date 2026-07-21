/**
 * Paystack — subscription initialization, verification, Disable Renewal.
 * Enum values match DB CHECK constraints (see paystack-webhook.ts header).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const PAYSTACK_BASE = "https://api.paystack.co";

function toKobo(naira: number): number {
  return Math.round(naira * 100);
}

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
      currency: "NGN";
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

    let planCode: string | null = null;
    if (isRecurring) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const res = await ensurePlanFromSnapshot(supabaseAdmin, paystackApi(), snapshot);
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
    };

    // Recurring: restrict to channels Paystack supports for subscriptions.
    // One-time: omit `channels` so every one-time channel enabled on the
    // Paystack account (bank transfer, USSD, pay with bank, QR, etc.) shows.
    const initBody: Record<string, unknown> = {
      email,
      amount: toKobo(snapshot.price_amount),
      currency: "NGN",
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
        "id, user_id, status, price_amount, currency, paystack_reference, paystack_environment, duration_days, grace_days, access_type, fulfilment_status, payment_type",
      )
      .eq("id", orderId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!order) throw new Error(VERIFY_FAILURE_MESSAGE);
    const orderSafe = order;
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
          amount: (orderSafe.price_amount as number | null) ?? tx.amount / 100,
          currency: (orderSafe.currency as string | null) ?? tx.currency ?? "NGN",
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
          amount: (orderSafe.price_amount as number | null) ?? tx.amount / 100,
          currency: (orderSafe.currency as string | null) ?? "NGN",
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
          amount: (orderSafe.price_amount as number | null) ?? tx.amount / 100,
          currency: (orderSafe.currency as string | null) ?? tx.currency ?? "NGN",
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

