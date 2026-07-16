import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, Tag } from "lucide-react";
import { SiteLayout } from "@/components/site/SiteLayout";
import { ToolBrandMark } from "@/components/tools/ToolBrandMark";
import { getTool, TOOLS } from "@/lib/tools-data";
import { listToolPricing, formatPrice } from "@/lib/tool-pricing.functions";

const pricingQuery = queryOptions({
  queryKey: ["tool-pricing"],
  queryFn: () => listToolPricing(),
});

export const Route = createFileRoute("/tools/$slug")({
  loader: ({ params }) => {
    const tool = getTool(params.slug);
    if (!tool) throw notFound();
    // Return only serializable fields; the icon component is looked up in the component.
    return {
      slug: tool.slug,
      name: tool.name,
      tagline: tool.tagline,
      description: tool.description,
      category: tool.category,
      access: tool.access,
    };
  },
  head: ({ loaderData }) => {
    if (!loaderData) {
      return {
        meta: [
          { title: "Tool not found — Top Rated SEO Tools" },
          { name: "robots", content: "noindex" },
        ],
      };
    }
    return {
      meta: [
        { title: `${loaderData.name} — Top Rated SEO Tools` },
        { name: "description", content: loaderData.description },
        { property: "og:title", content: `${loaderData.name} — Top Rated SEO Tools` },
        { property: "og:description", content: loaderData.description },
      ],
    };
  },
  errorComponent: () => (
    <SiteLayout>
      <div className="mx-auto max-w-xl px-4 py-24 text-center">
        <h1 className="text-2xl font-semibold">Couldn't load this tool</h1>
        <p className="mt-2 text-sm text-muted-foreground">Please try again.</p>
      </div>
    </SiteLayout>
  ),
  notFoundComponent: () => (
    <SiteLayout>
      <div className="mx-auto max-w-xl px-4 py-24 text-center">
        <h1 className="text-2xl font-semibold">Tool not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">This tool doesn't exist or was removed.</p>
        <Link to="/tools" className="mt-6 inline-flex text-sm text-primary hover:underline">
          ← Back to all tools
        </Link>
      </div>
    </SiteLayout>
  ),
  component: ToolPage,
});

function ToolPage() {
  const data = Route.useLoaderData();
  const tool = getTool(data.slug)!;
  const related = TOOLS.filter((t) => t.category === tool.category && t.slug !== tool.slug).slice(0, 3);

  return (
    <SiteLayout>
      <section className="bg-gradient-hero">
        <div className="mx-auto max-w-5xl px-4 pb-14 pt-10 sm:px-6 lg:px-8">
          <Link to="/tools" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> All tools
          </Link>
          <div className="mt-6 flex flex-col gap-6 sm:flex-row sm:items-start sm:gap-8">
            <ToolBrandMark tool={tool} size="lg" className="shadow-card" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-full border bg-background/60 px-2 py-0.5">{tool.category}</span>
                <span
                  className={`rounded-full px-2 py-0.5 font-semibold uppercase tracking-wide ${
                    tool.access === "pro" ? "bg-primary/10 text-primary" : "bg-success/15 text-success"
                  }`}
                >
                  {tool.access}
                </span>
              </div>
              <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">{tool.name}</h1>
              <p className="mt-2 text-lg text-muted-foreground">{tool.tagline}</p>
              <p className="mt-4 max-w-2xl text-foreground/80">{tool.description}</p>

              <div className="mt-6 flex flex-wrap gap-3">
                <Link
                  to="/register"
                  className="inline-flex items-center gap-2 rounded-md bg-gradient-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-glow hover:opacity-90"
                >
                  {tool.access === "pro" ? "Start free trial" : "Get started"} <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  to="/pricing"
                  className="inline-flex items-center rounded-md border border-input bg-background/60 px-5 py-2.5 text-sm font-medium backdrop-blur hover:bg-muted"
                >
                  View pricing
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid gap-6 md:grid-cols-2">
          <div className="rounded-2xl border bg-card p-6 shadow-card">
            <h2 className="text-lg font-semibold">What you can do</h2>
            <ul className="mt-4 space-y-3 text-sm">
              {["Fast, high-quality output on the latest models", "Templates and presets to get you started", "Export, share and integrate with your workflow", "Priority speed on paid plans"].map((f) => (
                <li key={f} className="flex items-start gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border bg-card p-6 shadow-card">
            <h2 className="text-lg font-semibold">Access level</h2>
            {tool.access === "pro" ? (
              <div className="mt-3 flex items-start gap-3">
                <Lock className="mt-0.5 h-5 w-5 text-primary" />
                <div className="text-sm text-muted-foreground">
                  This tool is included on the <span className="font-medium text-foreground">Pro</span> and <span className="font-medium text-foreground">Team</span> plans. Start a 7-day free trial to use it.
                </div>
              </div>
            ) : (
              <div className="mt-3 text-sm text-muted-foreground">
                Available on every plan, including free.
              </div>
            )}
          </div>
        </div>

        {related.length > 0 && (
          <>
            <h2 className="mt-14 text-xl font-semibold">More in {tool.category}</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              {related.map((r) => (
                  <Link
                    key={r.slug}
                    to="/tools/$slug"
                    params={{ slug: r.slug }}
                    className="group rounded-2xl border bg-card p-5 shadow-card transition hover:-translate-y-0.5 hover:border-primary/40"
                  >
                    <ToolBrandMark tool={r} size="sm" className="mb-3" />
                    <div className="font-semibold">{r.name}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{r.tagline}</div>
                  </Link>
              ))}
            </div>
          </>
        )}
      </section>
    </SiteLayout>
  );
}
