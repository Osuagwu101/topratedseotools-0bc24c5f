import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { Search, Users, Lock } from "lucide-react";
import { useMemo, useState } from "react";
import { SiteLayout } from "@/components/site/SiteLayout";
import { ToolBrandMark } from "@/components/tools/ToolBrandMark";
import { TOOLS, getTool } from "@/lib/tools-data";
import { listToolPricing, type ToolPricingOption, type AccessType } from "@/lib/tool-pricing.functions";
import { listToolSettings, type ToolSetting } from "@/lib/access.functions";
import { getBillingKind, normaliseBillingKind } from "@/lib/currency";
import { useMoney } from "@/components/currency/CurrencyProvider";

const pricingQuery = queryOptions({ queryKey: ["tool-pricing"], queryFn: () => listToolPricing() });
const settingsQuery = queryOptions({ queryKey: ["tool-settings"], queryFn: () => listToolSettings() });

export const Route = createFileRoute("/pricing")({
  loader: ({ context }) => {
    context.queryClient.ensureQueryData(pricingQuery);
    return context.queryClient.ensureQueryData(settingsQuery);
  },
  head: () => ({
    meta: [
      { title: "Pricing — Top Rated SEO Tools" },
      { name: "description", content: "Compare the Shared, Private and billing-period options currently available for each premium tool. Each tool renews separately — no forced bundle." },
      { property: "og:title", content: "Individual Plans for Every Tool" },
      { property: "og:description", content: "Choose from the access types and billing periods available for each tool, or contact Admin where pricing is custom." },
    ],
  }),
  component: PricingPage,
});

interface AccessBucket { monthly: ToolPricingOption | null; quarterly: ToolPricingOption | null; yearly: ToolPricingOption | null; other: ToolPricingOption[]; }
interface GroupedTool { slug: string; shared: AccessBucket; private: AccessBucket; contact: boolean; hasAny: boolean; }
function emptyBucket(): AccessBucket { return { monthly: null, quarterly: null, yearly: null, other: [] }; }
function placeIntoBucket(bucket: AccessBucket, opt: ToolPricingOption) {
  const kind = normaliseBillingKind(getBillingKind(opt));
  if (kind === "monthly" && !bucket.monthly) bucket.monthly = opt;
  else if (kind === "quarterly" && !bucket.quarterly) bucket.quarterly = opt;
  else if (kind === "yearly" && !bucket.yearly) bucket.yearly = opt;
  else bucket.other.push(opt);
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
      if (s && access === "shared" && (s.shared_access_authorization ?? "confirmed") !== "confirmed") continue;
      if (s && access === "private" && (s.private_access_authorization ?? "confirmed") !== "confirmed") continue;
      if (opt.tool_slug === "turnitin") continue;
      const g = map.get(opt.tool_slug) ?? { slug: opt.tool_slug, shared: emptyBucket(), private: emptyBucket(), contact: false, hasAny: false };
      if (opt.contact_admin || opt.amount == null) g.contact = true;
      else { placeIntoBucket(access === "private" ? g.private : g.shared, opt); g.hasAny = true; }
      map.set(opt.tool_slug, g);
    }
    return TOOLS.map((t) => map.get(t.slug) ?? { slug: t.slug, shared: emptyBucket(), private: emptyBucket(), contact: true, hasAny: false });
  }, [data.options, settingBySlug]);

  const filtered = useMemo(() => {
    if (!q) return grouped;
    const needle = q.toLowerCase();
    return grouped.filter((g) => {
      const t = getTool(g.slug);
      return !!t && (t.name.toLowerCase().includes(needle) || t.category.toLowerCase().includes(needle));
    });
  }, [grouped, q]);

  return (
    <SiteLayout>
      <section className="bg-gradient-hero">
        <div className="mx-auto max-w-4xl px-4 py-20 text-center sm:px-6 lg:px-8">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">Individual Plans for Every Tool</h1>
          <p className="mt-4 text-lg text-muted-foreground">
            Access type and billing periods vary by tool. Choose from the options currently shown for that tool, or contact Admin where pricing is custom. Every subscription is managed separately — no forced software bundle.
          </p>
          <div className="mx-auto mt-8 flex max-w-xl items-center gap-2 rounded-full border bg-background px-4 py-2 shadow-card">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a tool..." className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground" aria-label="Search tools" />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6 lg:px-8">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((g) => {
            const tool = getTool(g.slug);
            if (!tool) return null;
            if (tool.pricingModel === "per_use") return <PerUseCard key={g.slug} tool={tool} />;
            return <ToolPricingCard key={g.slug} group={g} tool={tool} />;
          })}
        </div>
        {filtered.length === 0 && <p className="mt-10 text-center text-sm text-muted-foreground">No tools match "{q}".</p>}

        <div className="mx-auto mt-16 max-w-3xl">
          <h2 className="text-2xl font-bold tracking-tight">Frequently asked questions</h2>
          <dl className="mt-6 space-y-4">
            {[
              { q: "What's the difference between Shared and Private access?", a: "Shared access is a slot on a pooled account and costs less. Private access gives you a dedicated login for that tool. Not every tool offers both — you'll only see the options that are actually available." },
              { q: "How do I pay for a tool?", a: "Choose from the access and billing options shown for that tool, then pay securely through the active payment gateway. Successful payments activate the order immediately. If login credentials are not active yet, your subscription page shows the Admin WhatsApp contact so access can be completed." },
              { q: "How does Turnitin work?", a: "Turnitin Checks are priced per check (₦2,300 each), paid once. There is no monthly, quarterly or yearly billing, no Shared or Private selection, and no automatic renewal. Message us with the number of checks you need and we'll send a payment link." },
              { q: "Why do some tools say 'Pricing confirmed on WhatsApp'?", a: "Those tools currently use Admin-confirmed pricing or fulfilment. Message us and we'll confirm the available option." },
              { q: "Can I change billing period later?", a: "Where a tool offers more than one billing period, you can choose another available period when renewing." },
              { q: "Do longer plans really save money?", a: "Only when the maths genuinely works in your favour. We only show a 'Save' badge when the longer plan is cheaper than the equivalent number of shorter payments — never the other way around." },
            ].map((f) => <div key={f.q} className="rounded-xl border bg-card p-5"><dt className="font-medium">{f.q}</dt><dd className="mt-1 text-sm text-muted-foreground">{f.a}</dd></div>)}
          </dl>
        </div>
      </section>
    </SiteLayout>
  );
}

function ToolPricingCard({ group, tool }: { group: GroupedTool; tool: ReturnType<typeof getTool> & object }) {
  const money = useMoney();
  const lines = [
    group.shared.monthly ? { access: "shared" as const, text: `Shared access from ${money.fmt(Number(group.shared.monthly.amount))}/month` } : null,
    group.private.monthly ? { access: "private" as const, text: `Private access from ${money.fmt(Number(group.private.monthly.amount))}/month` } : null,
  ].filter(Boolean) as Array<{ access: "shared" | "private"; text: string }>;
  return (
    <div className="flex flex-col rounded-2xl border bg-card p-6 shadow-card transition hover:-translate-y-0.5 hover:border-primary/40">
      <div className="flex items-center gap-3"><ToolBrandMark tool={tool} size="sm" /><div className="min-w-0"><div className="truncate font-semibold">{tool.name}</div><div className="truncate text-xs text-muted-foreground">{tool.category}</div></div></div>
      <div className="mt-5 flex-1 space-y-2">
        {lines.length > 0 ? lines.map((line) => <div key={line.access} className="flex items-center gap-2 text-sm font-semibold">{line.access === "shared" ? <Users className="h-3.5 w-3.5 text-muted-foreground" /> : <Lock className="h-3.5 w-3.5 text-muted-foreground" />}<span>{line.text}</span></div>) : <p className="rounded-lg border bg-background/40 px-3 py-2 text-xs text-primary">Pricing confirmed on WhatsApp</p>}
      </div>
      <div className="mt-5 flex gap-2"><Link to="/tools/$slug" params={{ slug: tool.slug }} className="flex-1 rounded-md border border-input px-3 py-2 text-center text-xs font-medium hover:bg-muted">Learn more</Link><Link to="/tools/$slug" params={{ slug: tool.slug }} className="flex-1 rounded-md bg-gradient-primary px-3 py-2 text-center text-xs font-medium text-primary-foreground shadow-glow hover:opacity-90">View Plans</Link></div>
    </div>
  );
}

function PerUseCard({ tool }: { tool: ReturnType<typeof getTool> & object }) {
  const money = useMoney();
  const perUse = tool.perUse!;
  return (
    <div className="flex flex-col rounded-2xl border bg-card p-6 shadow-card transition hover:-translate-y-0.5 hover:border-primary/40">
      <div className="flex items-center gap-3"><ToolBrandMark tool={tool} size="sm" /><div className="min-w-0"><div className="truncate font-semibold">{tool.name}</div><div className="truncate text-xs text-muted-foreground">{tool.category}</div></div></div>
      <div className="mt-5 flex-1 rounded-lg border bg-background/40 p-3"><div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Per-{perUse.unit} pricing</div><div className="mt-1 text-lg font-bold">{money.fmt(perUse.amount)} per {perUse.unit}</div><p className="mt-2 text-[11px] text-muted-foreground">One-time payment. No recurring billing, Shared/Private selection or automatic renewal.</p></div>
      <div className="mt-5 flex gap-2"><Link to="/tools/$slug" params={{ slug: tool.slug }} className="flex-1 rounded-md border border-input px-3 py-2 text-center text-xs font-medium hover:bg-muted">Learn more</Link><Link to="/tools/$slug" params={{ slug: tool.slug }} className="flex-1 rounded-md bg-gradient-primary px-3 py-2 text-center text-xs font-medium text-primary-foreground shadow-glow hover:opacity-90">Order per {perUse.unit}</Link></div>
    </div>
  );
}
