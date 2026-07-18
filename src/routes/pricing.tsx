import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { queryOptions } from "@tanstack/react-query";
import { Search, TrendingDown } from "lucide-react";
import { useMemo, useState } from "react";
import { SiteLayout } from "@/components/site/SiteLayout";
import { ToolBrandMark } from "@/components/tools/ToolBrandMark";
import { TOOLS, getTool } from "@/lib/tools-data";
import {
  listToolPricing,
  type ToolPricingOption,
} from "@/lib/tool-pricing.functions";
import {
  computeAnnualSaving,
  formatCurrency,
  formatPlanPrice,
  getBillingKind,
} from "@/lib/currency";

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
          "Compare monthly and annual subscriptions for every premium tool. Pay only for the tools you need — each renews separately, no forced bundle.",
      },
      { property: "og:title", content: "Individual Plans for Every Tool" },
      {
        property: "og:description",
        content:
          "Compare monthly and annual subscriptions and choose only the premium tools you need.",
      },
    ],
  }),
  component: PricingPage,
});

interface GroupedTool {
  slug: string;
  monthly: ToolPricingOption[];
  annual: ToolPricingOption[];
  other: ToolPricingOption[];
  contact: boolean;
  hasAny: boolean;
}

function PricingPage() {
  const { data } = useSuspenseQuery(pricingQuery);
  const [q, setQ] = useState("");

  const grouped: GroupedTool[] = useMemo(() => {
    const map = new Map<string, GroupedTool>();
    for (const opt of data.options) {
      const g =
        map.get(opt.tool_slug) ??
        {
          slug: opt.tool_slug,
          monthly: [],
          annual: [],
          other: [],
          contact: false,
          hasAny: false,
        };
      if (opt.contact_admin || opt.amount == null) {
        g.contact = true;
      } else {
        const kind = getBillingKind(opt);
        if (kind === "monthly") g.monthly.push(opt);
        else if (kind === "annual") g.annual.push(opt);
        else g.other.push(opt);
        g.hasAny = true;
      }
      map.set(opt.tool_slug, g);
    }
    return TOOLS.map(
      (t) =>
        map.get(t.slug) ?? {
          slug: t.slug,
          monthly: [],
          annual: [],
          other: [],
          contact: true,
          hasAny: false,
        },
    );
  }, [data.options]);

  const filtered = useMemo(() => {
    if (!q) return grouped;
    const needle = q.toLowerCase();
    return grouped.filter((g) => {
      const t = getTool(g.slug);
      if (!t) return false;
      return (
        t.name.toLowerCase().includes(needle) ||
        t.category.toLowerCase().includes(needle)
      );
    });
  }, [grouped, q]);

  return (
    <SiteLayout>
      <section className="bg-gradient-hero">
        <div className="mx-auto max-w-4xl px-4 py-20 text-center sm:px-6 lg:px-8">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            Individual Plans for Every Tool
          </h1>
          <p className="mt-4 text-lg text-muted-foreground">
            Compare monthly and annual subscriptions and choose only the premium
            tools you need. Each tool has its own plan and renews separately —
            no forced software bundle.
          </p>
          <div className="mx-auto mt-8 flex max-w-xl items-center gap-2 rounded-full border bg-background px-4 py-2 shadow-card">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search a tool..."
              className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              aria-label="Search tools"
            />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6 lg:px-8">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((g) => {
            const tool = getTool(g.slug);
            if (!tool) return null;
            return <ToolPricingCard key={g.slug} group={g} tool={tool} />;
          })}
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
                a: "Choose a plan on the tool you need and pay securely via Paystack. Access is granted the moment payment is confirmed — no admin approval needed.",
              },
              {
                q: "Why do some tools say 'Pricing confirmed on WhatsApp'?",
                a: "Those tools have custom or volume-based pricing. Message us and we'll quote you within a few hours.",
              },
              {
                q: "Can I switch between monthly and annual later?",
                a: "Yes. Start on whichever suits you now; when it renews you can pick the other billing period.",
              },
              {
                q: "Do annual plans really save money?",
                a: "Only when the annual price is lower than twelve monthly payments. We only show a 'Save' badge when the maths genuinely works in your favour.",
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

function ToolPricingCard({
  group,
  tool,
}: {
  group: GroupedTool;
  tool: ReturnType<typeof getTool> & object;
}) {
  const monthly = group.monthly[0] ?? null;
  const annual = group.annual[0] ?? null;
  const saving =
    monthly && annual
      ? computeAnnualSaving(Number(monthly.amount), Number(annual.amount))
      : null;

  return (
    <div className="flex flex-col rounded-2xl border bg-card p-6 shadow-card transition hover:-translate-y-0.5 hover:border-primary/40">
      <div className="flex items-center gap-3">
        <ToolBrandMark tool={tool} size="sm" />
        <div className="min-w-0">
          <div className="truncate font-semibold">{tool.name}</div>
          <div className="truncate text-xs text-muted-foreground">
            {tool.category}
          </div>
        </div>
      </div>

      <div className="mt-5 flex-1 space-y-2">
        {monthly ? <PlanRow opt={monthly} label="Monthly" /> : null}
        {annual ? (
          <PlanRow
            opt={annual}
            label="Annual"
            badge={
              saving
                ? `Save ${formatCurrency(saving.amount, annual.currency || "₦")}`
                : null
            }
          />
        ) : null}
        {group.other.map((o) => (
          <PlanRow key={o.id} opt={o} label={o.label ?? "Standard"} />
        ))}

        {!group.hasAny ? (
          <p className="rounded-lg border bg-background/40 px-3 py-2 text-xs text-primary">
            Pricing confirmed on WhatsApp
          </p>
        ) : null}

        {saving ? (
          <p className="flex items-center gap-1 pt-1 text-[11px] text-success">
            <TrendingDown className="h-3 w-3" />
            Save {formatCurrency(saving.amount, annual!.currency || "₦")} annually
            {saving.percent > 0 ? ` (${saving.percent}%)` : ""}
          </p>
        ) : null}
      </div>

      <div className="mt-5 flex gap-2">
        <Link
          to="/tools/$slug"
          params={{ slug: tool.slug }}
          className="flex-1 rounded-md border border-input px-3 py-2 text-center text-xs font-medium hover:bg-muted"
        >
          Learn more
        </Link>
        <Link
          to="/tools/$slug"
          params={{ slug: tool.slug }}
          className="flex-1 rounded-md bg-gradient-primary px-3 py-2 text-center text-xs font-medium text-primary-foreground shadow-glow hover:opacity-90"
        >
          View Plans
        </Link>
      </div>
    </div>
  );
}

function PlanRow({
  opt,
  label,
  badge,
}: {
  opt: ToolPricingOption;
  label: string;
  badge?: string | null;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 rounded-lg border bg-background/40 px-3 py-2">
      <span className="text-xs text-muted-foreground">
        {label}
        {opt.label && opt.label !== label ? (
          <span className="ml-1 text-[10px] uppercase tracking-wide text-muted-foreground/70">
            · {opt.label}
          </span>
        ) : null}
      </span>
      <span className="flex items-baseline gap-2">
        {badge ? (
          <span className="rounded-full bg-success/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-success">
            {badge}
          </span>
        ) : null}
        <span className="text-sm font-semibold">{formatPlanPrice(opt)}</span>
      </span>
    </div>
  );
}
