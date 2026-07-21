import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { queryOptions } from "@tanstack/react-query";
import { Search, TrendingDown, Users, Lock } from "lucide-react";
import { useMemo, useState } from "react";
import { SiteLayout } from "@/components/site/SiteLayout";
import { ToolBrandMark } from "@/components/tools/ToolBrandMark";
import { TOOLS, getTool } from "@/lib/tools-data";
import {
  listToolPricing,
  type ToolPricingOption,
  type AccessType,
} from "@/lib/tool-pricing.functions";
import { listToolSettings, type ToolSetting } from "@/lib/access.functions";
import {
  billingPeriodLabel,
  computeQuarterlySaving,
  computeYearlySaving,
  computeYearlyVsQuarterlySaving,
  formatCurrency,
  formatPlanPrice,
  getBillingKind,
  normaliseBillingKind,
} from "@/lib/currency";

const pricingQuery = queryOptions({
  queryKey: ["tool-pricing"],
  queryFn: () => listToolPricing(),
});
const settingsQuery = queryOptions({
  queryKey: ["tool-settings"],
  queryFn: () => listToolSettings(),
});

export const Route = createFileRoute("/pricing")({
  loader: ({ context }) => {
    context.queryClient.ensureQueryData(pricingQuery);
    return context.queryClient.ensureQueryData(settingsQuery);
  },
  head: () => ({
    meta: [
      { title: "Pricing — Top Rated SEO Tools" },
      {
        name: "description",
        content:
          "Compare Shared and Private access plans — Monthly, Quarterly, and Yearly — for every premium tool. Each renews separately, no forced bundle.",
      },
      { property: "og:title", content: "Individual Plans for Every Tool" },
      {
        property: "og:description",
        content:
          "Shared and Private access with Monthly, Quarterly, and Yearly billing — choose only the tools you need.",
      },
    ],
  }),
  component: PricingPage,
});

type Period = "monthly" | "quarterly" | "yearly";

interface AccessBucket {
  monthly: ToolPricingOption | null;
  quarterly: ToolPricingOption | null;
  yearly: ToolPricingOption | null;
  other: ToolPricingOption[];
}

interface GroupedTool {
  slug: string;
  shared: AccessBucket;
  private: AccessBucket;
  contact: boolean;
  hasAny: boolean;
}

function emptyBucket(): AccessBucket {
  return { monthly: null, quarterly: null, yearly: null, other: [] };
}

function placeIntoBucket(bucket: AccessBucket, opt: ToolPricingOption) {
  const kind = normaliseBillingKind(getBillingKind(opt));
  if (kind === "monthly" && !bucket.monthly) bucket.monthly = opt;
  else if (kind === "quarterly" && !bucket.quarterly) bucket.quarterly = opt;
  else if (kind === "yearly" && !bucket.yearly) bucket.yearly = opt;
  else bucket.other.push(opt);
}

function bucketHasAny(b: AccessBucket): boolean {
  return !!(b.monthly || b.quarterly || b.yearly) || b.other.length > 0;
}

function PricingPage() {
  const { data } = useSuspenseQuery(pricingQuery);
  const { data: settingsData } = useSuspenseQuery(settingsQuery);
  const [q, setQ] = useState("");

  const settingBySlug = useMemo(() => {
    const m = new Map<string, ToolSetting>();
    for (const s of settingsData.settings) m.set(s.tool_slug, s);
    return m;
  }, [settingsData.settings]);

  const grouped: GroupedTool[] = useMemo(() => {
    const map = new Map<string, GroupedTool>();
    for (const opt of data.options) {
      if (!opt.enabled) continue;
      const s = settingBySlug.get(opt.tool_slug);
      const access: AccessType = (opt.access_type as AccessType) ?? "shared";
      if (s && access === "shared" && s.shared_access_enabled === false) continue;
      if (s && access === "private" && s.private_access_enabled === false) continue;
      const g =
        map.get(opt.tool_slug) ??
        {
          slug: opt.tool_slug,
          shared: emptyBucket(),
          private: emptyBucket(),
          contact: false,
          hasAny: false,
        };
      if (opt.contact_admin || opt.amount == null) {
        g.contact = true;
      } else {
        placeIntoBucket(access === "private" ? g.private : g.shared, opt);
        g.hasAny = true;
      }
      map.set(opt.tool_slug, g);
    }
    return TOOLS.map(
      (t) =>
        map.get(t.slug) ?? {
          slug: t.slug,
          shared: emptyBucket(),
          private: emptyBucket(),
          contact: true,
          hasAny: false,
        },
    );
  }, [data.options, settingBySlug]);

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
            Choose Shared or Private access, then pick Monthly, Quarterly, or
            Yearly billing. Each tool has its own plan and renews separately —
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
            if (tool.pricingModel === "per_use") {
              return <PerUseCard key={g.slug} tool={tool} />;
            }
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
                q: "What's the difference between Shared and Private access?",
                a: "Shared access is a slot on a pooled account and costs less. Private access gives you a dedicated login for that tool. Not every tool offers both — you'll only see the options that are actually available.",
              },
              {
                q: "How do I pay for a tool?",
                a: "Choose Shared or Private Access, pick your billing period, and pay securely via Paystack. Shared Access is activated after payment confirmation, subject to availability. Private Access orders are marked pending fulfilment after payment — contact Admin on WhatsApp to complete the account assignment (usually within six hours).",
              },
              {
                q: "How does Turnitin work?",
                a: "Turnitin Checks are priced per check (₦2,300 each), paid once. There is no monthly, quarterly or yearly billing, no Shared or Private selection, and no automatic renewal. Message us with the number of checks you need and we'll send a payment link.",
              },
              {
                q: "Why do some tools say 'Pricing confirmed on WhatsApp'?",
                a: "Those tools have custom or volume-based pricing. Message us and we'll quote you within a few hours.",
              },
              {
                q: "Can I switch between Monthly, Quarterly, and Yearly later?",
                a: "Yes. Start on whichever suits you now; when it renews you can pick a different billing period or access type.",
              },
              {
                q: "Do longer plans really save money?",
                a: "Only when the maths genuinely works in your favour. We only show a 'Save' badge when the longer plan is cheaper than the equivalent number of shorter payments — never the other way around.",
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

/** Lowest-price hint for the compact catalogue card. */
function lowestPlan(bucket: AccessBucket): {
  opt: ToolPricingOption;
  period: Period;
} | null {
  const candidates: Array<{ opt: ToolPricingOption; period: Period }> = [];
  if (bucket.monthly) candidates.push({ opt: bucket.monthly, period: "monthly" });
  if (bucket.quarterly) candidates.push({ opt: bucket.quarterly, period: "quarterly" });
  if (bucket.yearly) candidates.push({ opt: bucket.yearly, period: "yearly" });
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => Number(a.opt.amount ?? 0) - Number(b.opt.amount ?? 0));
  return candidates[0];
}

function periodSuffix(p: Period): string {
  if (p === "monthly") return "/month";
  if (p === "quarterly") return "/quarter";
  return "/year";
}

function ToolPricingCard({
  group,
  tool,
}: {
  group: GroupedTool;
  tool: ReturnType<typeof getTool> & object;
}) {
  const sharedHas = bucketHasAny(group.shared);
  const privateHas = bucketHasAny(group.private);
  const lowestShared = sharedHas ? lowestPlan(group.shared) : null;
  const lowestPrivate = privateHas ? lowestPlan(group.private) : null;

  // Primary "from" line: prefer Shared, fall back to Private.
  const primary = lowestShared ?? lowestPrivate;
  const secondary =
    lowestShared && lowestPrivate ? "Private access also available" : null;

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

      <div className="mt-5 flex-1 space-y-3">
        {sharedHas ? (
          <AccessMini
            title="Shared Access"
            icon={<Users className="h-3.5 w-3.5" />}
            bucket={group.shared}
          />
        ) : null}
        {privateHas ? (
          <AccessMini
            title="Private Access"
            icon={<Lock className="h-3.5 w-3.5" />}
            bucket={group.private}
          />
        ) : null}

        {!group.hasAny ? (
          <p className="rounded-lg border bg-background/40 px-3 py-2 text-xs text-primary">
            Pricing confirmed on WhatsApp
          </p>
        ) : null}

        {primary ? (
          <p className="pt-1 text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground">
              {lowestShared ? "Shared access" : "Private access"} from{" "}
              {formatCurrency(Number(primary.opt.amount), primary.opt.currency || "₦")}
              {periodSuffix(primary.period)}
            </span>
            {secondary ? <span> · {secondary}</span> : null}
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

function AccessMini({
  title,
  icon,
  bucket,
}: {
  title: string;
  icon: React.ReactNode;
  bucket: AccessBucket;
}) {
  const qSave = computeQuarterlySaving(
    bucket.monthly?.amount,
    bucket.quarterly?.amount,
  );
  const ySaveFromM = computeYearlySaving(
    bucket.monthly?.amount,
    bucket.yearly?.amount,
  );
  const ySaveFromQ =
    !bucket.monthly && bucket.quarterly && bucket.yearly
      ? computeYearlyVsQuarterlySaving(bucket.quarterly.amount, bucket.yearly.amount)
      : null;

  return (
    <div className="rounded-lg border bg-background/40 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {icon}
        {title}
      </div>
      <ul className="space-y-1.5">
        {bucket.monthly ? (
          <PlanLine opt={bucket.monthly} label="Monthly" />
        ) : null}
        {bucket.quarterly ? (
          <PlanLine
            opt={bucket.quarterly}
            label="Quarterly"
            savingBadge={
              qSave
                ? `Save ${formatCurrency(qSave.amount, bucket.quarterly.currency || "₦")}`
                : null
            }
          />
        ) : null}
        {bucket.yearly ? (
          <PlanLine
            opt={bucket.yearly}
            label="Yearly"
            savingBadge={
              ySaveFromM
                ? `Save ${formatCurrency(ySaveFromM.amount, bucket.yearly.currency || "₦")}`
                : ySaveFromQ
                  ? `Save ${formatCurrency(ySaveFromQ.amount, bucket.yearly.currency || "₦")}`
                  : null
            }
          />
        ) : null}
        {bucket.other.map((o) => (
          <PlanLine key={o.id} opt={o} label={o.label ?? "Standard"} />
        ))}
      </ul>
      {qSave || ySaveFromM || ySaveFromQ ? (
        <p className="mt-2 flex items-center gap-1 text-[11px] text-success">
          <TrendingDown className="h-3 w-3" />
          {ySaveFromM
            ? `Save ${formatCurrency(ySaveFromM.amount, bucket.yearly!.currency || "₦")} yearly`
            : ySaveFromQ
              ? `Save ${formatCurrency(ySaveFromQ.amount, bucket.yearly!.currency || "₦")} compared with four quarterly payments`
              : qSave
                ? `Save ${formatCurrency(qSave.amount, bucket.quarterly!.currency || "₦")} every quarter`
                : ""}
        </p>
      ) : null}
    </div>
  );
}

function PlanLine({
  opt,
  label,
  savingBadge,
}: {
  opt: ToolPricingOption;
  label: string;
  savingBadge?: string | null;
}) {
  return (
    <li className="flex items-baseline justify-between gap-3">
      <span className="text-xs text-muted-foreground">
        {label}
        {opt.badge ? (
          <span className="ml-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
            {opt.badge}
          </span>
        ) : null}
      </span>
      <span className="flex items-baseline gap-2">
        {savingBadge ? (
          <span className="rounded-full bg-success/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-success">
            {savingBadge}
          </span>
        ) : null}
        <span className="text-sm font-semibold">{formatPlanPrice(opt)}</span>
      </span>
    </li>
  );
}

// Silence "unused" warning for the shared label helper in some builds.
void billingPeriodLabel;
