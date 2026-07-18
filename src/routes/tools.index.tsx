import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { Search, Sparkles } from "lucide-react";
import { SiteLayout } from "@/components/site/SiteLayout";
import { ToolBrandMark } from "@/components/tools/ToolBrandMark";
import { CATEGORIES, TOOLS, type ToolCategory } from "@/lib/tools-data";
import { listToolPricing, formatPrice } from "@/lib/tool-pricing.functions";
import { cn } from "@/lib/utils";

const pricingQuery = queryOptions({
  queryKey: ["tool-pricing"],
  queryFn: () => listToolPricing(),
});

export const Route = createFileRoute("/tools/")({
  loader: ({ context }) => context.queryClient.ensureQueryData(pricingQuery),
  head: () => ({
    meta: [
      { title: "Browse Individual Tool Subscriptions — Top Rated SEO Tools" },
      { name: "description", content: "Every tool is subscribed to separately. Explore premium SEO, AI, writing, research, design, and productivity tools and pay only for the ones you need." },
      { property: "og:title", content: "Browse Individual Tool Subscriptions — Top Rated SEO Tools" },
      { property: "og:description", content: "Every tool is subscribed to separately — pay only for the tools you need." },
    ],
  }),
  component: ToolsDirectory,
});

function ToolsDirectory() {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<ToolCategory | "All">("All");
  const { data: pricing } = useSuspenseQuery(pricingQuery);
  const priceByTool = useMemo(() => {
    const m = new Map<string, ReturnType<typeof formatPrice>>();
    for (const opt of pricing.options) {
      if (!m.has(opt.tool_slug)) m.set(opt.tool_slug, formatPrice(opt));
    }
    return m;
  }, [pricing.options]);


  const filtered = useMemo(() => {
    return TOOLS.filter((t) => {
      const matchesCat = cat === "All" || t.category === cat;
      const matchesQ =
        !q ||
        t.name.toLowerCase().includes(q.toLowerCase()) ||
        t.tagline.toLowerCase().includes(q.toLowerCase()) ||
        t.description.toLowerCase().includes(q.toLowerCase());
      return matchesCat && matchesQ;
    });
  }, [q, cat]);

  return (
    <SiteLayout>
      <section className="bg-gradient-hero">
        <div className="mx-auto max-w-7xl px-4 py-16 text-center sm:px-6 lg:px-8">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Browse Individual Tool Subscriptions</h1>
          <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
            Every tool is subscribed to separately, so you pay only for the products you need.
            Explore premium tools across SEO, AI, writing, research, design, and productivity.
          </p>

          <div className="mx-auto mt-8 flex max-w-xl items-center gap-2 rounded-full border bg-background px-4 py-2 shadow-card">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search tools..."
              className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="mb-6 flex flex-wrap gap-2">
          {(["All", ...CATEGORIES] as const).map((c) => (
            <button
              key={c}
              onClick={() => setCat(c as ToolCategory | "All")}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs font-medium transition",
                cat === c
                  ? "border-primary bg-primary text-primary-foreground"
                  : "hover:bg-muted",
              )}
            >
              {c}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="rounded-2xl border border-dashed p-16 text-center">
            <Sparkles className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">
              No tools match "<span className="font-medium text-foreground">{q}</span>". Try another search.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((t) => (
              <Link
                key={t.slug}
                to="/tools/$slug"
                params={{ slug: t.slug }}
                className="group relative flex flex-col rounded-2xl border bg-card p-6 shadow-card transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-glow"
              >
                <div className="flex items-center justify-between">
                  <ToolBrandMark tool={t} />
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                      t.access === "pro"
                        ? "bg-primary/10 text-primary"
                        : "bg-success/15 text-success",
                    )}
                  >
                    {t.access}
                  </span>
                </div>
                <div className="mt-4 text-lg font-semibold">{t.name}</div>
                <div className="mt-1 text-sm text-muted-foreground">{t.tagline}</div>
                <div className="mt-4 flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{t.category}</span>
                  <span className="font-semibold text-foreground">
                    {priceByTool.get(t.slug) ?? "Contact admin"}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </SiteLayout>
  );
}