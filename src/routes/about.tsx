import { createFileRoute, Link } from "@tanstack/react-router";
import { Sparkles, Target, Heart, Rocket } from "lucide-react";
import { SiteLayout } from "@/components/site/SiteLayout";
import { APP_NAME } from "@/lib/site-config";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "About — Top Rated SEO Tools" },
      {
        name: "description",
        content:
          "TopRatedSEOTools offers individual subscriptions to premium SEO, AI, writing, research, design, and productivity tools — managed from one dashboard.",
      },
      { property: "og:title", content: "About — Top Rated SEO Tools" },
      {
        property: "og:description",
        content:
          "Individual premium tool subscriptions, managed in one place.",
      },
    ],
  }),
  component: AboutPage,
});

function AboutPage() {
  return (
    <SiteLayout>
      <section className="bg-gradient-hero">
        <div className="mx-auto max-w-4xl px-4 py-20 text-center sm:px-6 lg:px-8">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            Individual premium tool subscriptions, managed in one place
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
            {APP_NAME} makes premium professional software easier to discover, subscribe to, and manage.
            Instead of forcing customers into one large bundle, the platform offers separate
            subscriptions for individual SEO, AI, writing, research, design, and productivity tools.
          </p>
          <p className="mx-auto mt-4 max-w-2xl text-muted-foreground">
            Customers can choose the specific tools they need, subscribe monthly or annually, and
            manage their access and renewals from one dashboard.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="grid gap-6 md:grid-cols-3">
          {[
            {
              icon: Target,
              title: "Our mission",
              body: "Give professionals access to the specific premium tools they need — without paying for software they'll never use.",
            },
            {
              icon: Heart,
              title: "Our approach",
              body: "Clear per-tool pricing, monthly and annual plans, and one place to manage every subscription and renewal.",
            },
            {
              icon: Rocket,
              title: "Where we're going",
              body: "A growing catalogue of SEO, AI, writing, research, design, and productivity tools — added as demand grows.",
            },
          ].map((v) => (
            <div key={v.title} className="rounded-2xl border bg-card p-6 shadow-card">
              <v.icon className="h-6 w-6 text-primary" />
              <div className="mt-3 text-lg font-semibold">{v.title}</div>
              <p className="mt-1 text-sm text-muted-foreground">{v.body}</p>
            </div>
          ))}
        </div>

        <div className="mx-auto mt-16 max-w-3xl text-center">
          <Sparkles className="mx-auto h-8 w-8 text-primary" />
          <h2 className="mt-4 text-2xl font-bold tracking-tight">Choose only the tools you need</h2>
          <p className="mt-2 text-muted-foreground">
            Creating an account is free. Premium tool access requires an active subscription to that tool.
          </p>
          <Link
            to="/tools"
            className="mt-6 inline-flex items-center rounded-md bg-gradient-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-glow hover:opacity-90"
          >
            Browse Tools
          </Link>
        </div>
      </section>
    </SiteLayout>
  );
}
