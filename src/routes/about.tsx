import { createFileRoute, Link } from "@tanstack/react-router";
import { Sparkles, Target, Heart, Rocket } from "lucide-react";
import { SiteLayout } from "@/components/site/SiteLayout";
import { APP_NAME } from "@/lib/site-config";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "About — Nexus AI" },
      { name: "description", content: "Our mission: make every AI tool accessible behind one simple subscription." },
      { property: "og:title", content: "About — Nexus AI" },
      { property: "og:description", content: "Our mission: make every AI tool accessible behind one simple subscription." },
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
            Building the everything-app for AI
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
            {APP_NAME} is a home for the best AI tools — bundled behind one simple subscription so you can focus on the work, not on juggling accounts.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="grid gap-6 md:grid-cols-3">
          {[
            { icon: Target, title: "Our mission", body: "Give every creator and team access to state-of-the-art AI without the sprawl of a dozen subscriptions." },
            { icon: Heart, title: "Our values", body: "Simplicity, honesty, and craft. We build tools we're proud to use every day ourselves." },
            { icon: Rocket, title: "Where we're going", body: "A single, opinionated workspace that grows with the AI landscape — with new tools rolled out every month." },
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
          <h2 className="mt-4 text-2xl font-bold tracking-tight">Ready to try {APP_NAME}?</h2>
          <p className="mt-2 text-muted-foreground">Start free — upgrade only when you're ready.</p>
          <Link
            to="/register"
            className="mt-6 inline-flex items-center rounded-md bg-gradient-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-glow hover:opacity-90"
          >
            Create your account
          </Link>
        </div>
      </section>
    </SiteLayout>
  );
}
