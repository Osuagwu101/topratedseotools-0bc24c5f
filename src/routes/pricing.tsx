import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { queryOptions } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { SiteLayout } from "@/components/site/SiteLayout";
import { ToolBrandMark } from "@/components/tools/ToolBrandMark";
import { TOOLS, getTool } from "@/lib/tools-data";
import {
  listToolPricing,
  formatPrice,
  type ToolPricingOption,
} from "@/lib/tool-pricing.functions";

const pricingQuery = queryOptions({
  queryKey: ["tool-pricing"],
  queryFn: () => listToolPricing(),
});

export const Route = createFileRoute("/pricing")({
  loader: ({ context }) => context.queryClient.ensureQueryData(pricingQuery),
  head: () => ({
    meta: [
      { title: "Pricing — Top Rated SEO Tools" },
      {
        name: "description",
        content:
          "Pay only for the tools you need. Transparent per-tool pricing for Stealthwriter, ChatGPT, Semrush, Turnitin and more.",
      },
      { property: "og:title", content: "Pricing — Top Rated SEO Tools" },
      {
        property: "og:description",
        content: "Pay only for the tools you need. Transparent per-tool pricing.",
      },
    ],
  }),
  component: PricingPage,
});

function PricingPage() {
  const { data } = useSuspenseQuery(pricingQuery);
  const [q, setQ] = useState("");

  // Group pricing options by tool_slug and preserve TOOLS ordering.
  const grouped = useMemo(() => {
    const map = new Map<string, ToolPricingOption[]>();
    for (const opt of data.options) {
      const arr = map.get(opt.tool_slug) ?? [];
      arr.push(opt);
      map.set(opt.tool_slug, arr);
    }
    return TOOLS.map((t) => ({
      tool: t,
      options: map.get(t.slug) ?? [
        {
          id: `placeholder-${t.slug}`,
          tool_slug: t.slug,
          label: null,
          amount: null,
          unit: null,
          currency: "₦",
          contact_admin: true,
          sort_order: 0,
          duration_days: null,
          grace_days: 0,
          warning_days: 0,
        } satisfies ToolPricingOption,

      ],
    }));
  }, [data.options]);

  const filtered = useMemo(() => {
    if (!q) return grouped;
    const needle = q.toLowerCase();
    return grouped.filter(
      ({ tool }) =>
        tool.name.toLowerCase().includes(needle) ||
        tool.category.toLowerCase().includes(needle),
    );
  }, [grouped, q]);

  return (
    <SiteLayout>
      <section className="bg-gradient-hero">
        <div className="mx-auto max-w-4xl px-4 py-20 text-center sm:px-6 lg:px-8">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            Pay only for the tools you need
          </h1>
          <p className="mt-4 text-lg text-muted-foreground">
            Transparent per-tool pricing. No forced bundles. Ask the admin for
            anything not listed.
          </p>
          <div className="mx-auto mt-8 flex max-w-xl items-center gap-2 rounded-full border bg-background px-4 py-2 shadow-card">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search a tool..."
              className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6 lg:px-8">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map(({ tool, options }) => (
            <div
              key={tool.slug}
              className="flex flex-col rounded-2xl border bg-card p-6 shadow-card transition hover:-translate-y-0.5 hover:border-primary/40"
            >
              <div className="flex items-center gap-3">
                <ToolBrandMark tool={tool} size="sm" />
                <div className="min-w-0">
                  <div className="truncate font-semibold">{tool.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {tool.category}
                  </div>
                </div>
              </div>

              <ul className="mt-5 flex-1 space-y-2">
                {options.map((opt) => (
                  <li
                    key={opt.id}
                    className="flex items-baseline justify-between gap-3 rounded-lg border bg-background/40 px-3 py-2"
                  >
                    <span className="text-xs text-muted-foreground">
                      {opt.label ?? (opt.contact_admin ? "Custom pricing" : "Standard")}
                    </span>
                    <span
                      className={
                        opt.contact_admin
                          ? "text-sm font-medium text-primary"
                          : "text-sm font-semibold"
                      }
                    >
                      {formatPrice(opt)}
                    </span>
                  </li>
                ))}
              </ul>

              <div className="mt-5 flex gap-2">
                <Link
                  to="/tools/$slug"
                  params={{ slug: tool.slug }}
                  className="flex-1 rounded-md border border-input px-3 py-2 text-center text-xs font-medium hover:bg-muted"
                >
                  Learn more
                </Link>
                <Link
                  to="/contact"
                  className="flex-1 rounded-md bg-gradient-primary px-3 py-2 text-center text-xs font-medium text-primary-foreground shadow-glow hover:opacity-90"
                >
                  Order
                </Link>
              </div>
            </div>
          ))}
        </div>

        {filtered.length === 0 && (
          <p className="mt-10 text-center text-sm text-muted-foreground">
            No tools match "{q}".
          </p>
        )}

        <div className="mx-auto mt-16 max-w-3xl">
          <h2 className="text-2xl font-bold tracking-tight">
            Frequently asked questions
          </h2>
          <dl className="mt-6 space-y-4">
            {[
              {
                q: "How do I pay for a tool?",
                a: "Click Order on the tool you need or contact us via the Contact page. The admin will confirm your access after payment.",
              },
              {
                q: "Why do some tools say 'Contact admin'?",
                a: "Those tools have custom or volume-based pricing. Message us and we'll quote you within a few hours.",
              },
              {
                q: "Can I get a shared or private account?",
                a: "For tools like Canva Pro we offer both — shared for lower cost, private for full control. See the tool card for prices.",
              },
              {
                q: "Do prices change?",
                a: "Our admin keeps pricing up to date. Prices on this page are always the current published rates.",
              },
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

// Re-export for convenience if other pages want the helper via this route module.
export { getTool };
