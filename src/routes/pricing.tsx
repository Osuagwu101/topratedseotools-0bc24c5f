import { createFileRoute, Link } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { useState } from "react";
import { SiteLayout } from "@/components/site/SiteLayout";
import { PRICING_PLANS } from "@/lib/pricing-data";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "Pricing — Top Rated SEO Tools" },
      { name: "description", content: "Simple monthly and annual plans. 7-day free trial. Cancel anytime." },
      { property: "og:title", content: "Pricing — Top Rated SEO Tools" },
      { property: "og:description", content: "Simple monthly and annual plans. 7-day free trial. Cancel anytime." },
    ],
  }),
  component: Pricing,
});

function Pricing() {
  const [yearly, setYearly] = useState(true);

  return (
    <SiteLayout>
      <section className="bg-gradient-hero">
        <div className="mx-auto max-w-4xl px-4 py-20 text-center sm:px-6 lg:px-8">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            Pricing that scales with you
          </h1>
          <p className="mt-4 text-lg text-muted-foreground">
            Every plan unlocks the full catalog. Pay monthly or save 20% with annual billing.
          </p>

          <div className="mt-8 inline-flex items-center gap-1 rounded-full border bg-background p-1">
            <button
              onClick={() => setYearly(false)}
              className={cn(
                "rounded-full px-4 py-1.5 text-sm font-medium transition",
                !yearly ? "bg-foreground text-background" : "text-muted-foreground",
              )}
            >
              Monthly
            </button>
            <button
              onClick={() => setYearly(true)}
              className={cn(
                "inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium transition",
                yearly ? "bg-foreground text-background" : "text-muted-foreground",
              )}
            >
              Annual
              <span className="rounded-full bg-success/20 px-2 py-0.5 text-[10px] font-semibold text-success">
                -20%
              </span>
            </button>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-20 sm:px-6 lg:px-8">
        <div className="grid gap-6 lg:grid-cols-3">
          {PRICING_PLANS.map((p) => {
            const price = yearly ? p.yearly : p.monthly;
            return (
              <div
                key={p.id}
                className={cn(
                  "relative flex flex-col rounded-2xl border bg-card p-8 shadow-card",
                  p.featured && "border-primary/50 shadow-glow",
                )}
              >
                {p.featured && (
                  <div className="absolute -top-3 left-8 rounded-full bg-gradient-primary px-3 py-1 text-xs font-semibold text-primary-foreground">
                    Most popular
                  </div>
                )}
                <div className="text-lg font-semibold">{p.name}</div>
                <p className="mt-1 text-sm text-muted-foreground">{p.tagline}</p>
                <div className="mt-6 flex items-baseline gap-1">
                  <span className="text-5xl font-bold tracking-tight">${price}</span>
                  <span className="text-sm text-muted-foreground">
                    /{yearly ? "mo, billed yearly" : "month"}
                  </span>
                </div>
                <ul className="mt-6 flex-1 space-y-3 text-sm">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <Link
                  to="/register"
                  className={cn(
                    "mt-8 inline-flex items-center justify-center rounded-md px-4 py-2.5 text-sm font-medium transition",
                    p.featured
                      ? "bg-gradient-primary text-primary-foreground shadow-glow hover:opacity-90"
                      : "border border-input hover:bg-muted",
                  )}
                >
                  {p.cta}
                </Link>
              </div>
            );
          })}
        </div>

        <div className="mx-auto mt-16 max-w-3xl">
          <h2 className="text-2xl font-bold tracking-tight">Frequently asked questions</h2>
          <dl className="mt-6 space-y-4">
            {[
              { q: "Can I cancel anytime?", a: "Yes — cancel with one click from your dashboard. You keep access until the end of your billing period." },
              { q: "Is there a free trial?", a: "Pro and Team plans include a 7-day free trial. No card charged until the trial ends." },
              { q: "What payment methods do you accept?", a: "All major cards, plus Apple Pay and Google Pay through Stripe." },
              { q: "Can I switch plans later?", a: "Yes, upgrade or downgrade at any time. Changes are prorated." },
            ].map((f) => (
              <div key={f.q} className="rounded-xl border bg-card p-5">
                <dt className="font-medium">{f.q}</dt>
                <dd className="mt-1 text-sm text-muted-foreground">{f.a}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>
    </SiteLayout>
  );
}
