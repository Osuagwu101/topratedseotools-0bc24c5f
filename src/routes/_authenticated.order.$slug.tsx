/**
 * Order flow — user pays for a tool via Paystack.
 *
 * 1. User picks a plan → we create a `pending` order + call Paystack init.
 * 2. Browser redirects to Paystack's hosted checkout.
 * 3. Paystack redirects back to `/orders?verify=<ref>`; the orders page
 *    then calls `verifyPaystackPayment` to grant access instantly.
 * 4. Paystack's webhook is the authoritative source; verify is a fallback.
 */
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useSuspenseQuery, useQuery, queryOptions } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, ShieldCheck, CreditCard, Info, TrendingDown, Users, Lock, TicketPercent, X } from "lucide-react";
import { useCurrency, useMoney } from "@/components/currency/CurrencyProvider";
import { CurrencySwitcher } from "@/components/currency/CurrencySwitcher";
import { SiteLayout } from "@/components/site/SiteLayout";
import { ToolBrandMark } from "@/components/tools/ToolBrandMark";
import { findCatalogTool } from "@/lib/tool-catalog";
import { listToolOverrides } from "@/lib/tool-overrides.functions";
import { listToolPricing, formatPrice, type ToolPricingOption, type AccessType } from "@/lib/tool-pricing.functions";
import {
  billingDescription,
  computeQuarterlySaving,
  computeYearlySaving,
  computeYearlyVsQuarterlySaving,
  getBillingKind,
  normaliseBillingKind,
  renewalText,
} from "@/lib/currency";
import { createOrder, listToolSettings } from "@/lib/access.functions";
import { initializePaystackPayment } from "@/lib/paystack.functions";
import { getActiveGatewayInfo } from "@/lib/active-gateway.functions";
import { previewCoupon, type CouponPreview } from "@/lib/coupons.functions";
import type { DiscountInput } from "@/lib/currency-convert";
import { attachOrderAttribution } from "@/lib/marketing/attribution.functions";
import {
  trackBeginCheckout,
  trackPaymentMethodSelected,
  trackPaystackOpened,
  marketingContext,
} from "@/lib/marketing/track";
import { buildEventId } from "@/lib/marketing/config";

const pricingQuery = queryOptions({
  queryKey: ["tool-pricing"],
  queryFn: () => listToolPricing(),
});
const settingsQuery = queryOptions({
  queryKey: ["tool-settings"],
  queryFn: () => listToolSettings(),
});
const overridesQuery = queryOptions({
  queryKey: ["tool-overrides"],
  queryFn: () => listToolOverrides(),
});


export const Route = createFileRoute("/_authenticated/order/$slug")({
  validateSearch: (search: Record<string, unknown>): { plan?: string } =>
    typeof search.plan === "string" ? { plan: search.plan } : {},
  head: () => ({
    meta: [
      { title: "Subscribe — Top Rated SEO Tools" },
      { name: "robots", content: "noindex" },
    ],
  }),
  loader: ({ context }) => {
    context.queryClient.ensureQueryData(pricingQuery);
    context.queryClient.ensureQueryData(overridesQuery);
    return context.queryClient.ensureQueryData(settingsQuery);
  },
  component: OrderPage,
});

function OrderPage() {
  const { slug } = Route.useParams();
  const { plan: preselected } = Route.useSearch();
  const { data: overridesData } = useSuspenseQuery(overridesQuery);
  // Admin-created tools live in tool_overrides, so resolve against the merged catalogue.
  const tool = findCatalogTool(overridesData.overrides, slug);
  const { data: pricing } = useSuspenseQuery(pricingQuery);
  const { data: settings } = useSuspenseQuery(settingsQuery);
  const { currency, price, config } = useCurrency();
  const money = useMoney();
  const setting = settings.settings.find((s) => s.tool_slug === slug);
  const sharedAllowed =
    (setting?.shared_access_enabled ?? true) &&
    (setting?.shared_access_authorization ?? "confirmed") === "confirmed";
  const privateAllowed =
    (setting?.private_access_enabled ?? true) &&
    (setting?.private_access_authorization ?? "confirmed") === "confirmed";
  const submitOrder = useServerFn(createOrder);
  const initPay = useServerFn(initializePaystackPayment);
  // Gateway routing is automatic and derived from the payment currency:
  // NGN → Paystack (recurring available), any other currency → Flutterwave
  // (one-time only). The customer never picks a gateway.
  const gatewayName = gatewayNameForCurrency(money.currency);
  const gatewayRecurring = supportsRecurringForCurrency(money.currency);

  const router = useRouter();
  // Turnitin (and any future per-use tool) has no subscription checkout —
  // block any old/direct link from opening the subscription flow.
  const perUseBlocked = tool?.pricingModel === "per_use";
  const options = perUseBlocked
    ? []
    : pricing.options.filter((o) => {
        if (o.tool_slug !== slug) return false;
        if (!o.enabled || o.contact_admin) return false;
        const access = (o.access_type as AccessType) ?? "shared";
        if (access === "shared" && !sharedAllowed) return false;
        if (access === "private" && !privateAllowed) return false;
        return true;
      });

  const initialId =
    (preselected && options.find((o) => o.id === preselected)?.id) ??
    options[0]?.id ??
    null;
  const [selected, setSelected] = useState<string | null>(initialId);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [payMode, setPayMode] = useState<"recurring_subscription" | "one_time">(
    "recurring_subscription",
  );
  const [oneTimeAcknowledged, setOneTimeAcknowledged] = useState(false);
  const [couponInput, setCouponInput] = useState("");
  const [coupon, setCoupon] = useState<CouponPreview | null>(null);
  const [couponBusy, setCouponBusy] = useState(false);
  const applyCoupon = useServerFn(previewCoupon);

  // A coupon is validated against one specific plan, and coupons apply to
  // one-time payments only, so drop it whenever either changes.
  useEffect(() => {
    setCoupon(null);
  }, [selected]);
  useEffect(() => {
    if (payMode !== "one_time") setCoupon(null);
  }, [payMode]);

  // Some gateways cannot charge automatically each cycle — keep the customer
  // on the one-time flow instead of promising a renewal we can't deliver.
  useEffect(() => {
    if (!gatewayRecurring) setPayMode("one_time");
  }, [gatewayRecurring]);

  if (!tool) {
    return (
      <SiteLayout>
        <div className="mx-auto max-w-xl px-4 py-24 text-center">
          <h1 className="text-2xl font-semibold">Tool not found</h1>
          <Link to="/tools" className="mt-4 inline-flex text-sm text-primary hover:underline">
            ← All tools
          </Link>
        </div>
      </SiteLayout>
    );
  }

  if (perUseBlocked && tool) {
    return (
      <SiteLayout>
        <section className="mx-auto max-w-xl px-4 py-20 text-center sm:px-6">
          <h1 className="text-2xl font-semibold">This tool is per-{tool.perUse?.unit ?? "use"}, not a subscription</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            {tool.name} is a pay-per-{tool.perUse?.unit ?? "use"} service. There
            is no monthly, quarterly or yearly billing, no Shared or Private
            selection, and no automatic renewal. Any old subscription link for
            this tool has been retired.
          </p>
          <Link
            to="/tools/$slug"
            params={{ slug }}
            className="mt-6 inline-flex items-center justify-center rounded-md bg-gradient-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-glow hover:opacity-90"
          >
            Go to the {tool.name} page
          </Link>
        </section>
      </SiteLayout>
    );
  }

  const chosen = options.find((o) => o.id === selected) ?? null;
  const oneTimeBlocked = payMode === "one_time" && !oneTimeAcknowledged;
  // Coupons are resolved by the server against the base NGN price. The same
  // discount object is fed to the display pipeline and to the checkout call,
  // so what the customer sees is exactly what Paystack is asked to charge.
  const discount: DiscountInput | null = coupon
    ? { type: coupon.discount_type, value: coupon.discount_value, code: coupon.code }
    : null;

  async function submitCoupon() {
    if (!chosen) {
      toast.error("Please select a plan first");
      return;
    }
    const code = couponInput.trim();
    if (!code) return;
    setCouponBusy(true);
    try {
      const preview = await applyCoupon({
        data: { code, tool_slug: slug, pricing_option_id: chosen.id },
      });
      setCoupon(preview);
      toast.success(`Coupon ${preview.code} applied`);
    } catch (err) {
      setCoupon(null);
      toast.error(err instanceof Error ? err.message : "That coupon could not be applied");
    } finally {
      setCouponBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!chosen) {
      toast.error("Please select a plan");
      return;
    }
    if (payMode === "one_time" && !oneTimeAcknowledged) {
      toast.error("Please confirm the one-time payment notice to continue.");
      return;
    }
    setSubmitting(true);
    try {
      const { orderId } = await submitOrder({
        data: {
          tool_slug: slug,
          pricing_option_id: selected,
          notes: notes || null,
        },
      });
      // Attach campaign attribution + fire begin_checkout before opening Paystack.
      // Attribution is only linked to the order once Marketing consent has been granted.
      const ctx = marketingContext();
      const snap = ctx.attribution.last_touch ?? ctx.attribution.first_touch ?? null;
      const { readConsent } = await import("@/lib/marketing/consent");
      if (readConsent().marketing) {
        try {
          await attachOrderAttribution({
            data: {
              order_id: orderId,
              visitor_id: ctx.visitor_id,
              snapshot: snap,
            },
          });
        } catch {
          /* attribution attach is best-effort */
        }
      }
      const price = chosen ? Number(chosen.amount ?? 0) : 0;
      const kind = chosen ? normaliseBillingKind(getBillingKind(chosen)) : "monthly";
      if (tool) {
        trackBeginCheckout({
          order_id: orderId,
          slug,
          name: tool.name,
          amount: price,
          access_type: (chosen?.access_type as string) ?? "shared",
          billing_period: kind,
          payment_type: payMode,
          event_id: buildEventId("checkout", orderId),
        });
      }
      trackPaymentMethodSelected(payMode);
      trackPaystackOpened(orderId);
      // Paystack unconditionally appends `?trxref=…&reference=…` to the callback,
      // so the callback URL must NOT already contain a query string or the
      // browser lands on a malformed `/orders?verify=1?trxref=…` URL and the
      // route's validateSearch throws "This page didn't load".
      const callback = `${window.location.origin}/orders`;
      const { authorization_url } = await initPay({
        data: {
          order_id: orderId,
          callback_url: callback,
          payment_type: payMode,
          payment_currency: currency,
          coupon_code: coupon?.code ?? null,
        },
      });
      window.location.href = authorization_url;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start payment");
      setSubmitting(false);
      router.invalidate();
    }
  }

  return (
    <SiteLayout>
      <section className="mx-auto max-w-2xl px-4 py-12 sm:px-6 lg:px-8">
        <Link
          to="/tools/$slug"
          params={{ slug }}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to {tool.name}
        </Link>

        <div className="mt-6 flex items-center gap-4">
          <ToolBrandMark tool={tool} size="lg" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Subscribe to {tool.name}</h1>
            <p className="text-sm text-muted-foreground">{tool.tagline}</p>
          </div>
        </div>

        <form onSubmit={submit} className="mt-8 space-y-6">
          <div className="rounded-2xl border bg-card p-6 shadow-card">
            <div className="text-sm font-semibold">Choose your plan</div>
            {options.length === 0 ? (
              <p className="mt-3 rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                No plans are available for this tool yet. Please check back soon.
              </p>
            ) : (
              <div className="mt-3 space-y-5" role="radiogroup" aria-label="Subscription plan">
                {(["shared", "private"] as AccessType[]).map((access) => {
                  const group = options.filter(
                    (o) => ((o.access_type as AccessType) ?? "shared") === access,
                  );
                  if (group.length === 0) return null;
                  return (
                    <div key={access}>
                      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {access === "shared" ? (
                          <Users className="h-3.5 w-3.5" />
                        ) : (
                          <Lock className="h-3.5 w-3.5" />
                        )}
                        {access === "shared" ? "Shared Access" : "Private Access"}
                      </div>
                      <ul className="space-y-2">
                        {group.map((o) => {
                          const kind = normaliseBillingKind(getBillingKind(o));
                          const billingLabel =
                            kind === "monthly"
                              ? "Monthly"
                              : kind === "quarterly"
                                ? "Quarterly"
                                : kind === "yearly"
                                  ? "Yearly"
                                  : o.label ?? "Standard";
                          return (
                            <li key={o.id}>
                              <label
                                className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg border bg-background/40 px-3 py-2.5 text-sm transition ${
                                  selected === o.id
                                    ? "border-primary ring-1 ring-primary/40"
                                    : "hover:border-primary/40"
                                }`}
                              >
                                <span className="flex items-center gap-2">
                                  <input
                                    type="radio"
                                    name="opt"
                                    value={o.id}
                                    checked={selected === o.id}
                                    onChange={() => setSelected(o.id)}
                                    className="h-4 w-4"
                                    aria-label={`${billingLabel} — ${money.plan(o)}`}
                                  />
                                  <span className="flex flex-col">
                                    <span className="font-medium">
                                      {billingLabel}
                                      {o.badge ? (
                                        <span className="ml-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                                          {o.badge}
                                        </span>
                                      ) : null}
                                    </span>
                                    {o.label && o.label !== billingLabel ? (
                                      <span className="text-[11px] text-muted-foreground">{o.label}</span>
                                    ) : null}
                                    {billingDescription(kind) ? (
                                      <span className="text-[11px] text-muted-foreground">
                                        {billingDescription(kind)}
                                      </span>
                                    ) : null}
                                  </span>
                                </span>
                                <span className="text-right">
                                  <span className="block font-semibold">{money.plan(o)}</span>
                                </span>
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })}
              </div>
            )}
          </div>


          {chosen ? <CheckoutSummary chosen={chosen} allOptions={options} currency={currency} price={price} config={config} discount={discount} coupon={coupon} /> : null}

          {chosen ? (
            <div className="rounded-2xl border bg-card p-6 shadow-card">
              <div className="text-sm font-semibold">Choose how to pay</div>
              <p className="mt-1 text-xs text-muted-foreground">
                Both options use the exact price above. The channels shown at checkout depend on your choice.
              </p>
              {!gatewayRecurring ? (
                <div className="mt-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
                  <strong>{gatewayName} does not support automatic renewals.</strong> This purchase
                  is a one-time payment for the selected billing period only — nothing will be
                  charged again automatically, and you'll need to renew manually when it expires.
                </div>
              ) : null}
              <div className="mt-3 space-y-3">

                <label
                  className={`flex items-start gap-3 rounded-lg border p-3 text-sm transition ${
                    payMode === "recurring_subscription"
                      ? "border-primary ring-1 ring-primary/40"
                      : "hover:border-primary/40"
                  } ${gatewayRecurring ? "cursor-pointer" : "cursor-not-allowed opacity-50"}`}
                >
                  <input
                    type="radio"
                    name="paymode"
                    className="mt-1 h-4 w-4"
                    disabled={!gatewayRecurring}
                    checked={payMode === "recurring_subscription"}
                    onChange={() => setPayMode("recurring_subscription")}
                  />
                  <span className="flex-1">
                    <span className="block font-medium">Auto-Renew Subscription</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      Pay by Card or Direct Debit. Your subscription will renew automatically at
                      the end of each billing period until you disable renewal.
                    </span>
                  </span>
                </label>

                <label
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm transition ${
                    payMode === "one_time"
                      ? "border-primary ring-1 ring-primary/40"
                      : "hover:border-primary/40"
                  }`}
                >
                  <input
                    type="radio"
                    name="paymode"
                    className="mt-1 h-4 w-4"
                    checked={payMode === "one_time"}
                    onChange={() => setPayMode("one_time")}
                  />
                  <span className="flex-1">
                    <span className="block font-medium">One-Time Payment</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      Pay once via Bank Transfer, USSD, Pay with Bank, QR, or any other one-time
                      channel enabled on our {gatewayName} account.
                    </span>
                  </span>
                </label>

                {payMode === "one_time" ? (
                  <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs">
                    <div className="text-warning">
                      This payment method supports one-time payment only. Your access will last
                      for the selected billing period and will not renew automatically.
                    </div>
                    <label className="mt-2 flex items-start gap-2 text-foreground">
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4"
                        checked={oneTimeAcknowledged}
                        onChange={(e) => setOneTimeAcknowledged(e.target.checked)}
                      />
                      <span>I understand this is a one-time purchase and will not renew.</span>
                    </label>
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {chosen && payMode === "one_time" ? (
            <div className="rounded-2xl border bg-card p-6 shadow-card">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <TicketPercent className="h-4 w-4 text-primary" /> Coupon code
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Discounts are calculated on the Naira price, then converted into your selected
                currency.
              </p>
              {coupon ? (
                <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-sm">
                  <span>
                    <span className="font-semibold">{coupon.code}</span> applied —{" "}
                    {coupon.discount_type === "percent"
                      ? `${coupon.discount_value}% off`
                      : `${money.fmt(coupon.discount_value)} off`}
                    {coupon.description ? (
                      <span className="block text-xs text-muted-foreground">{coupon.description}</span>
                    ) : null}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setCoupon(null);
                      setCouponInput("");
                    }}
                    className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted"
                  >
                    <X className="h-3 w-3" /> Remove
                  </button>
                </div>
              ) : (
                <div className="mt-3 flex gap-2">
                  <input
                    value={couponInput}
                    onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                    placeholder="Enter coupon code"
                    aria-label="Coupon code"
                    maxLength={64}
                    className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm uppercase outline-none focus:ring-2 focus:ring-primary/40"
                  />
                  <button
                    type="button"
                    onClick={submitCoupon}
                    disabled={couponBusy || !couponInput.trim()}
                    className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-60"
                  >
                    {couponBusy ? "Checking…" : "Apply"}
                  </button>
                </div>
              )}
            </div>
          ) : chosen ? (
            <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
              <TicketPercent className="mt-0.5 h-3 w-3 shrink-0" />
              Have a coupon code? Choose <strong className="mx-1">One-Time Payment</strong> above to
              apply it.
            </p>
          ) : null}

          <div className="rounded-2xl border bg-card p-6 shadow-card">
            <label className="text-sm font-semibold" htmlFor="notes">
              Notes <span className="font-normal text-muted-foreground">(optional)</span>
            </label>
            <textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="Any preferences or details you'd like us to know…"
              className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>

          <div className="flex items-start gap-2 rounded-xl border bg-muted/40 p-4 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" />
            <div>
              You'll be redirected to <strong>{gatewayName}</strong> to pay securely.
              <strong> Shared Access</strong> is activated after payment
              confirmation, subject to availability.
              <strong> Private Access</strong> orders are marked pending
              fulfilment after payment — contact Admin on WhatsApp to complete
              the account assignment (usually within six hours).
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting || !chosen || oneTimeBlocked}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-gradient-primary px-5 py-3 text-sm font-medium text-primary-foreground shadow-glow transition hover:opacity-90 disabled:opacity-60"
          >
            <CreditCard className="h-4 w-4" />
            {submitting
              ? `Redirecting to ${gatewayName}…`
              : !chosen
                ? "Select a plan to continue"
                : payMode === "one_time"
                  ? `Pay ${chosen.amount == null || chosen.contact_admin ? formatPrice(chosen) : money.fmt(chosen.amount, discount)} once with ${gatewayName}`
                  : `Subscribe · ${chosen.amount == null || chosen.contact_admin ? formatPrice(chosen) : money.fmt(chosen.amount)} with ${gatewayName}`}
          </button>


          <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
            <Info className="mt-0.5 h-3 w-3 shrink-0" />
            {money.currency === "NGN"
              ? "Payments processed in Nigerian Naira. Cards, bank transfer, and USSD are supported."
              : `Payments processed in ${money.currency}. Cards and supported local channels are available.`}
          </p>
        </form>
      </section>
    </SiteLayout>
  );
}

function CheckoutSummary({
  chosen,
  allOptions,
  currency,
  price,
  config,
  discount,
  coupon,
}: {
  chosen: ToolPricingOption;
  allOptions: ToolPricingOption[];
  discount: import("@/lib/currency-convert").DiscountInput | null;
  coupon: CouponPreview | null;
  currency: import("@/lib/currency-convert").SupportedCurrency;
  price: (ngn: number) => import("@/lib/currency-convert").PricingBreakdown | null;
  config: Awaited<ReturnType<typeof import("@/lib/currency.functions").getPublicCurrencyConfig>> | undefined;
}) {
  const money = useMoney();
  const kind = normaliseBillingKind(getBillingKind(chosen));
  const billing = billingDescription(kind);
  const renewal = renewalText(kind);
  const access: AccessType = (chosen.access_type as AccessType) ?? "shared";

  // Compare against peers of the same access type.
  const peers = allOptions.filter(
    (o) => ((o.access_type as AccessType) ?? "shared") === access && o.amount != null,
  );
  const monthly = peers.find((o) => normaliseBillingKind(getBillingKind(o)) === "monthly");
  const quarterly = peers.find((o) => normaliseBillingKind(getBillingKind(o)) === "quarterly");

  let savingLine: string | null = null;
  if (kind === "quarterly" && monthly) {
    const s = computeQuarterlySaving(monthly.amount, chosen.amount);
    if (s) {
      savingLine = `You save ${money.fmt(s.amount)} compared with three monthly payments${s.percent > 0 ? ` (${s.percent}%)` : ""}.`;
    }
  } else if (kind === "yearly") {
    if (monthly) {
      const s = computeYearlySaving(monthly.amount, chosen.amount);
      if (s) {
        savingLine = `You save ${money.fmt(s.amount)} compared with twelve monthly payments${s.percent > 0 ? ` (${s.percent}%)` : ""}.`;
      }
    } else if (quarterly) {
      const s = computeYearlyVsQuarterlySaving(quarterly.amount, chosen.amount);
      if (s) {
        savingLine = `You save ${money.fmt(s.amount)} compared with four quarterly payments${s.percent > 0 ? ` (${s.percent}%)` : ""}.`;
      }
    }
  }

  const planLabel =
    kind === "monthly"
      ? "Monthly Subscription"
      : kind === "quarterly"
        ? "Quarterly Subscription"
        : kind === "yearly"
          ? "Yearly Subscription"
          : chosen.label ?? "Standard";

  const ngn = Number(chosen.amount ?? 0);
  // Total payable in the selected currency; the international adjustment is
  // already folded in and is never itemised for the customer.
  const totalPayable = money.plan(chosen, "full", discount);
  void price;
  void config;
  void ngn;

  return (
    <div className="rounded-2xl border bg-card p-6 shadow-card" aria-label="Order summary">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">Order summary</div>
        <CurrencySwitcher />
      </div>
      <dl className="mt-3 space-y-2 text-sm">
        <div className="flex items-center justify-between">
          <dt className="text-muted-foreground">Access</dt>
          <dd className="flex items-center gap-1 font-medium">
            {access === "private" ? (
              <>
                <Lock className="h-3.5 w-3.5" /> Private
              </>
            ) : (
              <>
                <Users className="h-3.5 w-3.5" /> Shared
              </>
            )}
          </dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-muted-foreground">Plan</dt>
          <dd className="font-medium">{planLabel}</dd>
        </div>
        {billing ? (
          <div className="flex items-center justify-between">
            <dt className="text-muted-foreground">Billing</dt>
            <dd>{billing}</dd>
          </div>
        ) : null}

        {coupon ? (
          <div className="flex items-center justify-between">
            <dt className="text-muted-foreground">Coupon {coupon.code}</dt>
            <dd className="font-medium text-success">
              −{money.fmt(coupon.discount_amount_ngn)}
            </dd>
          </div>
        ) : null}

        <div className="flex items-center justify-between border-t pt-2">
          <dt className="text-muted-foreground">Amount due today</dt>
          <dd className="text-base font-bold">{totalPayable}</dd>
        </div>

        {savingLine ? (
          <div className="flex items-start gap-1 text-[11px] text-success">
            <TrendingDown className="mt-0.5 h-3 w-3" />
            <span>{savingLine}</span>
          </div>
        ) : null}
        {renewal ? (
          <p className="text-[11px] text-muted-foreground">{renewal}</p>
        ) : null}
      </dl>
    </div>
  );
}
