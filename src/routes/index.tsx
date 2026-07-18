import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { ArrowRight, Check, Sparkles, Zap, Shield, Users, Star, HelpCircle } from "lucide-react";
import { SiteLayout } from "@/components/site/SiteLayout";
import { ToolBrandMark } from "@/components/tools/ToolBrandMark";
import { TOOLS } from "@/lib/tools-data";
import { listToolPricing, formatPrice } from "@/lib/tool-pricing.functions";
import { APP_NAME, APP_DESCRIPTION } from "@/lib/site-config";

const pricingQuery = queryOptions({
  queryKey: ["tool-pricing"],
  queryFn: () => listToolPricing(),
});

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: `${APP_NAME} | Individual SEO and AI Tool Subscriptions` },
      { name: "description", content: APP_DESCRIPTION },
      { property: "og:title", content: `${APP_NAME} | Individual SEO and AI Tool Subscriptions` },
      { property: "og:description", content: APP_DESCRIPTION },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(pricingQuery),
  component: Home,
});

const TESTIMONIALS = [
  {
    quote:
      "The cheapest way to get Stealthwriter and ChatGPT together. Delivery was instant after payment confirmation.",
    name: "Adaeze O.",
    role: "Content writer, Lagos",
  },
  {
    quote:
      "I ran Semrush and Grammarly for two months and my organic traffic doubled. Worth every naira.",
    name: "Michael K.",
    role: "SEO Consultant",
  },
  {
    quote:
      "Support is fast and the tools work exactly as advertised — no reselling gimmicks. Highly recommended.",
    name: "Ifeoma A.",
    role: "Agency Owner",
  },
];

const FAQ = [
  {
    q: "How do subscriptions work?",
    a: "Each tool is subscribed to separately. You can subscribe to one or several tools and manage all of them from the same dashboard.",
  },
  {
    q: "Is there a free trial?",
    a: "TopRatedSEOTools does not currently offer a general free trial. Creating an account is free, but access to premium tools requires an active subscription.",
  },
  {
    q: "Which payment methods are supported?",
    a: "Payments are processed securely through Paystack.",
  },
  {
    q: "How do renewals work?",
    a: "Eligible monthly and annual subscriptions renew automatically until renewal is disabled. You can disable renewal at any time and keep access until the end of the paid billing period.",
  },
  {
    q: "Are all tools always available?",
    a: "Some tools may require availability and pricing confirmation before purchase. We'll let you know as soon as your access is activated.",
  },
  {
    q: "How do I get support?",
    a: "Support is available through WhatsApp and email. Reach us any time via the Contact page.",
  },
];

function Home() {
  const featured = TOOLS.filter((t) => t.featured);
  const { data: pricing } = useSuspenseQuery(pricingQuery);

  const showcase = TOOLS.slice(0, 8).map((t) => {
    const enabled = pricing.options.filter((o) => o.tool_slug === t.slug && o.enabled);
    const paid = enabled.filter((o) => !o.contact_admin && o.amount != null);
    const primary =
      paid.sort((a, b) => Number(a.amount ?? 0) - Number(b.amount ?? 0))[0] ??
      enabled[0];
    return { tool: t, price: primary };
  });


  return (
    <SiteLayout>
      {/* Hero */}
      <section className="bg-gradient-hero relative overflow-hidden">
        <div className="mx-auto max-w-7xl px-4 pb-20 pt-16 sm:px-6 sm:pt-24 lg:px-8 lg:pt-32">
          <div className="mx-auto max-w-3xl text-center">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border bg-background/60 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              Premium software subscriptions, priced individually
            </div>
            <h1 className="text-4xl font-bold tracking-tight sm:text-6xl">
              Subscribe to the <span className="text-gradient-primary">premium tools you need</span>—without paying for a bundle.
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
              Choose from leading SEO, AI, writing, research, design, and productivity tools.
              Each product has its own monthly and annual subscription, with clear pricing and fast
              access after payment.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link
                to="/pricing"
                className="inline-flex items-center gap-2 rounded-md bg-gradient-primary px-5 py-3 text-sm font-medium text-primary-foreground shadow-glow transition hover:opacity-90"
              >
                Browse Individual Plans <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                to="/tools"
                className="inline-flex items-center rounded-md border border-input bg-background/60 px-5 py-3 text-sm font-medium backdrop-blur hover:bg-muted"
              >
                See How It Works
              </Link>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              Clear per-tool pricing · Secure Paystack payments · Automatic activation when access is available · WhatsApp and email support
            </p>
          </div>
        </div>
      </section>

      {/* Featured tools */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="text-3xl font-bold tracking-tight">Popular tools</h2>
            <p className="mt-2 text-muted-foreground">
              Hand-picked picks that our members reach for daily.
            </p>
          </div>
          <Link
            to="/tools"
            className="hidden shrink-0 text-sm font-medium text-primary hover:underline sm:inline-flex"
          >
            View all →
          </Link>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {featured.map((t) => (
            <Link
              key={t.slug}
              to="/tools/$slug"
              params={{ slug: t.slug }}
              className="group relative overflow-hidden rounded-2xl border bg-card p-6 shadow-card transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-glow"
            >
              <ToolBrandMark tool={t} className="mb-4" />
              <div className="text-lg font-semibold">{t.name}</div>
              <div className="mt-1 text-sm text-muted-foreground">{t.tagline}</div>
              <div className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary opacity-0 transition group-hover:opacity-100">
                View plans <ArrowRight className="h-4 w-4" />
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Value props */}
      <section className="border-y bg-muted/30">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-16 sm:grid-cols-2 sm:px-6 lg:grid-cols-3 lg:px-8">
          {[
            { icon: Zap, title: "Pay per tool", body: "No forced software bundle. Choose only the tools you need and subscribe to each one separately." },
            { icon: Shield, title: "One dashboard", body: "Manage every subscription, renewal, and access detail from one place — even when you subscribe to several tools." },
            { icon: Users, title: "WhatsApp & email support", body: "Talk to a real person for activation, renewals, and account questions during business hours." },
          ].map((v) => (
            <div key={v.title} className="rounded-2xl border bg-card p-6 shadow-card">
              <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                <v.icon className="h-5 w-5" />
              </div>
              <div className="text-lg font-semibold">{v.title}</div>
              <div className="mt-1 text-sm text-muted-foreground">{v.body}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing preview — per tool */}
      <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight">Premium tools without the forced bundle</h2>
          <p className="mt-3 text-muted-foreground">
            Subscribe separately to the tools that support your work. Add or remove subscriptions as your
            needs change, while managing everything from one account.
          </p>
        </div>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {showcase.map(({ tool, price }) => (
            <Link
              key={tool.slug}
              to="/tools/$slug"
              params={{ slug: tool.slug }}
              className="group flex flex-col rounded-2xl border bg-card p-5 shadow-card transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-glow"
            >
              <div className="flex items-center gap-3">
                <ToolBrandMark tool={tool} size="sm" />
                <div className="min-w-0">
                  <div className="truncate font-semibold">{tool.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{tool.category}</div>
                </div>
              </div>
              <div className="mt-4 flex-1 text-sm text-muted-foreground line-clamp-2">
                {tool.tagline}
              </div>
              <div className="mt-4 border-t pt-3">
                {price ? (
                  <div className={price.contact_admin ? "text-sm font-medium text-primary" : "text-lg font-bold"}>
                    {formatPrice(price)}
                  </div>
                ) : (
                  <div className="text-sm font-medium text-primary">Contact admin</div>
                )}
              </div>
            </Link>
          ))}
        </div>
        <div className="mt-8 text-center">
          <Link
            to="/pricing"
            className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
          >
            View full pricing <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      {/* Testimonials */}
      <section className="border-y bg-muted/30">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight">Loved by creators & agencies</h2>
            <p className="mt-3 text-muted-foreground">
              Real feedback from members using our tools every day.
            </p>
          </div>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {TESTIMONIALS.map((t) => (
              <div key={t.name} className="rounded-2xl border bg-card p-6 shadow-card">
                <div className="flex gap-0.5 text-warning">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star key={i} className="h-4 w-4 fill-current" />
                  ))}
                </div>
                <p className="mt-3 text-sm text-foreground/90">"{t.quote}"</p>
                <div className="mt-4 text-xs">
                  <div className="font-semibold">{t.name}</div>
                  <div className="text-muted-foreground">{t.role}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="mx-auto max-w-4xl px-4 py-20 sm:px-6 lg:px-8">
        <div className="text-center">
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-primary text-primary-foreground shadow-glow">
            <HelpCircle className="h-5 w-5" />
          </div>
          <h2 className="mt-4 text-3xl font-bold tracking-tight">Frequently asked questions</h2>
        </div>
        <div className="mt-10 space-y-3">
          {FAQ.map((item) => (
            <details
              key={item.q}
              className="group rounded-2xl border bg-card p-5 shadow-card open:shadow-glow"
            >
              <summary className="flex cursor-pointer items-center justify-between gap-3 text-sm font-semibold">
                {item.q}
                <span className="text-lg text-muted-foreground transition group-open:rotate-45">+</span>
              </summary>
              <p className="mt-3 text-sm text-muted-foreground">{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-7xl px-4 pb-20 sm:px-6 lg:px-8">
        <div className="overflow-hidden rounded-3xl border bg-gradient-primary p-10 text-center text-primary-foreground shadow-glow sm:p-16">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Ready to pick your first tool?
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-primary-foreground/80">
            Create a free account, subscribe only to the tools you need, and manage every subscription
            from one dashboard.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Link
              to="/register"
              className="inline-flex items-center gap-2 rounded-md bg-background px-5 py-3 text-sm font-medium text-foreground shadow hover:opacity-90"
            >
              Create account <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              to="/tools"
              className="inline-flex items-center rounded-md border border-primary-foreground/40 px-5 py-3 text-sm font-medium hover:bg-primary-foreground/10"
            >
              Explore all tools
            </Link>
          </div>
        </div>
      </section>
    </SiteLayout>
  );
}

/* Ensure the following exists in tool-pricing.functions.ts:
   export function formatPrice(o: ToolPricingOption): string
   — already exported. */
