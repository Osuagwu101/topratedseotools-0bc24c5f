/**
 * Order flow — user requests access to a single tool.
 * Manual/admin-approval for now; the same row is what a future Paystack
 * webhook will flip from `pending` → `approved`.
 */
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, CheckCircle2, Info } from "lucide-react";
import { SiteLayout } from "@/components/site/SiteLayout";
import { ToolBrandMark } from "@/components/tools/ToolBrandMark";
import { getTool } from "@/lib/tools-data";
import { listToolPricing, formatPrice } from "@/lib/tool-pricing.functions";
import { createOrder } from "@/lib/access.functions";

const pricingQuery = queryOptions({
  queryKey: ["tool-pricing"],
  queryFn: () => listToolPricing(),
});

export const Route = createFileRoute("/_authenticated/order/$slug")({
  head: () => ({
    meta: [
      { title: "Order tool — Top Rated SEO Tools" },
      { name: "robots", content: "noindex" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(pricingQuery),
  component: OrderPage,
});

function OrderPage() {
  const { slug } = Route.useParams();
  const tool = getTool(slug);
  const { data: pricing } = useSuspenseQuery(pricingQuery);
  const submitOrder = useServerFn(createOrder);
  const router = useRouter();
  const options = pricing.options.filter((o) => o.tool_slug === slug);

  const [selected, setSelected] = useState<string | null>(
    options.find((o) => !o.contact_admin)?.id ?? options[0]?.id ?? null,
  );
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

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
    setSubmitting(true);
    try {
      await submitOrder({
        data: {
          tool_slug: slug,
          pricing_option_id: selected,
          notes: notes || null,
        },
      });
      setDone(true);
      toast.success("Request submitted — an admin will confirm shortly.");
      router.invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not submit order");
    } finally {
      setSubmitting(false);
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

        {done ? (
          <div className="mt-8 rounded-2xl border bg-card p-6 shadow-card">
            <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-success/15 text-success">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <h2 className="mt-3 text-lg font-semibold">Request submitted</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              We'll email you and unlock the tool as soon as payment is confirmed.
              You can track this on your subscriptions page.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Link
                to="/orders"
                className="inline-flex items-center rounded-md bg-gradient-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-glow hover:opacity-90"
              >
                My subscriptions
              </Link>
              <Link
                to="/tools"
                className="inline-flex items-center rounded-md border border-input px-4 py-2 text-sm font-medium hover:bg-muted"
              >
                Browse more tools
              </Link>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-8 space-y-6">
            <div className="rounded-2xl border bg-card p-6 shadow-card">
              <div className="text-sm font-semibold">Choose your plan</div>
              {options.length === 0 ? (
                <p className="mt-3 rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                  Contact admin for a custom quote — leave a note below and we'll follow up.
                </p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {options.map((o) => (
                    <li key={o.id}>
                      <label
                        className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg border bg-background/40 px-3 py-2.5 text-sm transition ${
                          selected === o.id ? "border-primary ring-1 ring-primary/40" : "hover:border-primary/40"
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
                          />
                          <span>{o.label ?? (o.contact_admin ? "Custom pricing" : "Standard")}</span>
                        </span>
                        <span className={o.contact_admin ? "font-medium text-primary" : "font-semibold"}>
                          {formatPrice(o)}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded-2xl border bg-card p-6 shadow-card">
              <label className="text-sm font-semibold" htmlFor="notes">
                Notes for the admin <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={4}
                maxLength={1000}
                placeholder="Preferred payment method, timing, or any special request…"
                className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>

            <div className="flex items-start gap-2 rounded-xl border bg-muted/40 p-4 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                Payments are currently confirmed manually by an admin. Automatic checkout
                (Paystack / Flutterwave) will be plugged into this same flow later — your
                order will convert automatically.
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-gradient-primary px-5 py-3 text-sm font-medium text-primary-foreground shadow-glow transition hover:opacity-90 disabled:opacity-60"
            >
              {submitting ? "Submitting…" : chosen ? `Request access · ${formatPrice(chosen)}` : "Request access"}
            </button>
          </form>
        )}
      </section>
    </SiteLayout>
  );
}
