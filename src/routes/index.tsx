import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Check, Sparkles, Zap, Shield, Users } from "lucide-react";
import { SiteLayout } from "@/components/site/SiteLayout";
import { TOOLS } from "@/lib/tools-data";
import { PRICING_PLANS } from "@/lib/pricing-data";
import { APP_NAME, APP_TAGLINE, APP_DESCRIPTION } from "@/lib/site-config";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: `${APP_NAME} — ${APP_TAGLINE}` },
      { name: "description", content: APP_DESCRIPTION },
    ],
  }),
  component: Home,
});

function Home() {
  const featured = TOOLS.filter((t) => t.featured);

  return (
    <SiteLayout>
      {/* Hero */}
      <section className="bg-gradient-hero relative overflow-hidden">
        <div className="mx-auto max-w-7xl px-4 pb-20 pt-16 sm:px-6 sm:pt-24 lg:px-8 lg:pt-32">
          <div className="mx-auto max-w-3xl text-center">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border bg-background/60 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              20+ premium SEO & AI tools in one subscription
            </div>
            <h1 className="text-4xl font-bold tracking-tight sm:text-6xl">
              All the <span className="text-gradient-primary">top-rated SEO & AI tools</span>, one login.
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground">
              Stealthwriter, Phrasly, ChatGPT, QuillBot, Grammarly, CapCut, Semrush, Turnitin and more — bundled behind one affordable plan.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link
                to="/register"
                className="inline-flex items-center gap-2 rounded-md bg-gradient-primary px-5 py-3 text-sm font-medium text-primary-foreground shadow-glow transition hover:opacity-90"
              >
                Start free trial <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                to="/tools"
                className="inline-flex items-center rounded-md border border-input bg-background/60 px-5 py-3 text-sm font-medium backdrop-blur hover:bg-muted"
              >
                Explore tools
              </Link>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              No card required · 7-day Pro trial · Cancel anytime
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
          {featured.map((t) => {
            const Icon = t.icon;
            return (
              <Link
                key={t.slug}
                to="/tools/$slug"
                params={{ slug: t.slug }}
                className="group relative overflow-hidden rounded-2xl border bg-card p-6 shadow-card transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-glow"
              >
                <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-primary text-primary-foreground">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="text-lg font-semibold">{t.name}</div>
                <div className="mt-1 text-sm text-muted-foreground">{t.tagline}</div>
                <div className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary opacity-0 transition group-hover:opacity-100">
                  Launch tool <ArrowRight className="h-4 w-4" />
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Value props */}
      <section className="border-y bg-muted/30">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-16 sm:grid-cols-2 sm:px-6 lg:grid-cols-3 lg:px-8">
          {[
            { icon: Zap, title: "Fast by default", body: "Priority routing to the latest models. No cold starts, no queues." },
            { icon: Shield, title: "Private & secure", body: "Your data is encrypted, isolated per account and never used to train models." },
            { icon: Users, title: "Built for teams", body: "Shared workspaces, seat management and SSO on the Team plan." },
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

      {/* Pricing preview */}
      <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight">Simple, honest pricing</h2>
          <p className="mt-3 text-muted-foreground">
            Start free. Upgrade when you're ready. Cancel with one click.
          </p>
        </div>
        <div className="mt-10 grid gap-6 lg:grid-cols-3">
          {PRICING_PLANS.map((p) => (
            <div
              key={p.id}
              className={`relative flex flex-col rounded-2xl border bg-card p-6 shadow-card ${
                p.featured ? "border-primary/50 shadow-glow" : ""
              }`}
            >
              {p.featured && (
                <div className="absolute -top-3 left-6 rounded-full bg-gradient-primary px-3 py-1 text-xs font-semibold text-primary-foreground">
                  Most popular
                </div>
              )}
              <div className="text-lg font-semibold">{p.name}</div>
              <div className="mt-1 text-sm text-muted-foreground">{p.tagline}</div>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-4xl font-bold">${p.monthly}</span>
                <span className="text-sm text-muted-foreground">/month</span>
              </div>
              <ul className="mt-5 flex-1 space-y-2 text-sm">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <Link
                to="/pricing"
                className={`mt-6 inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition ${
                  p.featured
                    ? "bg-gradient-primary text-primary-foreground shadow-glow hover:opacity-90"
                    : "border border-input hover:bg-muted"
                }`}
              >
                {p.cta}
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-7xl px-4 pb-20 sm:px-6 lg:px-8">
        <div className="overflow-hidden rounded-3xl border bg-gradient-primary p-10 text-center text-primary-foreground shadow-glow sm:p-16">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Ready to build faster with AI?
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-primary-foreground/80">
            Join thousands of creators and teams using {APP_NAME} every day.
          </p>
          <Link
            to="/register"
            className="mt-6 inline-flex items-center gap-2 rounded-md bg-background px-5 py-3 text-sm font-medium text-foreground shadow hover:opacity-90"
          >
            Start your free trial <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </SiteLayout>
  );
}
