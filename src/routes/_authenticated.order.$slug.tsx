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
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, ShieldCheck, CreditCard, Info, TrendingDown } from "lucide-react";
import { SiteLayout } from "@/components/site/SiteLayout";
import { ToolBrandMark } from "@/components/tools/ToolBrandMark";
import { getTool } from "@/lib/tools-data";
import { listToolPricing, formatPrice } from "@/lib/tool-pricing.functions";
import {
  billingDescription,
  computeAnnualSaving,
  formatCurrency,
  formatPlanPrice,
  getBillingKind,
  renewalText,
} from "@/lib/currency";
import { createOrder } from "@/lib/access.functions";
import { initializePaystackPayment } from "@/lib/paystack.functions";

const pricingQuery = queryOptions({
  queryKey: ["tool-pricing"],
  queryFn: () => listToolPricing(),
});

export const Route = createFileRoute("/_authenticated/order/$slug")({
  validateSearch: (search: Record<string, unknown>) => ({
    plan: typeof search.plan === "string" ? search.plan : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Subscribe — Top Rated SEO Tools" },
      { name: "robots", content: "noindex" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(pricingQuery),
  component: OrderPage,
});

function OrderPage() {
  const { slug } = Route.useParams();
  const { plan: preselected } = Route.useSearch();
  const tool = getTool(slug);
  const { data: pricing } = useSuspenseQuery(pricingQuery);
  const submitOrder = useServerFn(createOrder);
  const initPay = useServerFn(initializePaystackPayment);
  const router = useRouter();
  const options = pricing.options.filter(
    (o) => o.tool_slug === slug && !o.contact_admin,
  );

  const initialId =
    (preselected && options.find((o) => o.id === preselected)?.id) ??
    options[0]?.id ??
    null;
  const [selected, setSelected] = useState<string | null>(initialId);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

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

  const chosen = options.find((o) => o.id === selected) ?? null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!chosen) {
      toast.error("Please select a plan");
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
      const callback = `${window.location.origin}/orders?verify=1`;
      const { authorization_url } = await initPay({
        data: { order_id: orderId, callback_url: callback },
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
              <ul className="mt-3 space-y-2" role="radiogroup" aria-label="Billing period">
                {options.map((o) => {
                  const kind = getBillingKind(o);
                  const billingLabel =
                    kind === "monthly" ? "Monthly" : kind === "annual" ? "Annual" : o.label ?? "Standard";
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
                            aria-label={`${billingLabel} — ${formatPlanPrice(o)}`}
                          />
                          <span className="flex flex-col">
                            <span className="font-medium">{billingLabel}</span>
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
                          <span className="block font-semibold">{formatPlanPrice(o)}</span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {chosen ? <CheckoutSummary chosen={chosen} allOptions={options} /> : null}

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
              You'll be redirected to <strong>Paystack</strong> to pay securely.
              Access unlocks the moment your payment is confirmed — no admin
              approval needed.
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting || !chosen}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-gradient-primary px-5 py-3 text-sm font-medium text-primary-foreground shadow-glow transition hover:opacity-90 disabled:opacity-60"
          >
            <CreditCard className="h-4 w-4" />
            {submitting
              ? "Redirecting to Paystack…"
              : chosen
                ? `Pay ${formatPrice(chosen)} with Paystack`
                : "Select a plan to continue"}
          </button>

          <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
            <Info className="mt-0.5 h-3 w-3 shrink-0" />
            Payments processed in Nigerian Naira. Cards, bank transfer, and USSD are supported.
          </p>
        </form>
      </section>
    </SiteLayout>
  );
}
