import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useSuspenseQuery, useQuery, queryOptions } from "@tanstack/react-query";
import { ArrowLeft, Check, Tag, TrendingDown } from "lucide-react";
import { SiteLayout } from "@/components/site/SiteLayout";
import { ToolBrandMark } from "@/components/tools/ToolBrandMark";
import { ToolAccessPanel } from "@/components/tools/ToolAccessPanel";
import { getTool, TOOLS } from "@/lib/tools-data";
import { listToolPricing, type ToolPricingOption } from "@/lib/tool-pricing.functions";
import {
  billingDescription,
  computeAnnualSaving,
  formatCurrency,
  formatPlanPrice,
  getBillingKind,
  renewalText,
} from "@/lib/currency";
import { listToolSettings } from "@/lib/access.functions";
import { supabase } from "@/integrations/supabase/client";

const pricingQuery = queryOptions({
  queryKey: ["tool-pricing"],
  queryFn: () => listToolPricing(),
});
const settingsQuery = queryOptions({
  queryKey: ["tool-settings"],
  queryFn: () => listToolSettings(),
});
const sessionQuery = queryOptions({
  queryKey: ["session-flag"],
  queryFn: async () => {
    const { data } = await supabase.auth.getSession();
    return { isAuthenticated: !!data.session };
  },
  staleTime: 30_000,
});

export const Route = createFileRoute("/tools/$slug")({
  loader: ({ params, context }) => {
    const tool = getTool(params.slug);
    if (!tool) throw notFound();
    context.queryClient.ensureQueryData(pricingQuery);
    context.queryClient.ensureQueryData(settingsQuery);
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
  const { data: pricing } = useSuspenseQuery(pricingQuery);
  const { data: settings } = useSuspenseQuery(settingsQuery);
  const { data: session } = useQuery(sessionQuery);
  const priceOptions = pricing.options.filter((o) => o.tool_slug === tool.slug);
  const setting = settings.settings.find((s) => s.tool_slug === tool.slug);
  const related = TOOLS.filter((t) => t.category === tool.category && t.slug !== tool.slug).slice(0, 3);

  const badge =
    setting?.enabled === false
      ? { label: "Disabled", cls: "bg-destructive/10 text-destructive" }
      : setting?.access_level === "public"
        ? { label: "Free", cls: "bg-success/15 text-success" }
        : setting?.access_level === "logged_in"
          ? { label: "Members", cls: "bg-accent text-accent-foreground" }
          : { label: "Premium", cls: "bg-primary/10 text-primary" };

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
                <span className={`rounded-full px-2 py-0.5 font-semibold uppercase tracking-wide ${badge.cls}`}>
                  {badge.label}
                </span>
              </div>
              <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">{tool.name}</h1>
              <p className="mt-2 text-lg text-muted-foreground">{tool.tagline}</p>
              <p className="mt-4 max-w-2xl text-foreground/80">{tool.description}</p>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid gap-6 md:grid-cols-2">
          <ToolAccessPanel
            tool={tool}
            setting={setting}
            isAuthenticated={session?.isAuthenticated ?? false}
          />

          <SubscriptionCard slug={tool.slug} options={priceOptions} />
        </div>

        <div className="mt-8 rounded-2xl border bg-card p-6 shadow-card">
          <h2 className="text-lg font-semibold">What you can do</h2>
          <ul className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            {[
              "Fast, high-quality output on the latest models",
              "Templates and presets to get you started",
              "Export, share and integrate with your workflow",
              "Priority speed on paid plans",
            ].map((f) => (
              <li key={f} className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <span>{f}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-8 rounded-2xl border bg-card p-6 shadow-card">
          <h2 className="text-lg font-semibold">What you can do</h2>
          <ul className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            {[
              "Fast, high-quality output on the latest models",
              "Templates and presets to get you started",
              "Export, share and integrate with your workflow",
              "Priority speed on paid plans",
            ].map((f) => (
              <li key={f} className="flex items-start gap-2">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <span>{f}</span>
              </li>
            ))}
          </ul>
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

function SubscriptionCard({
  slug,
  options,
}: {
  slug: string;
  options: ToolPricingOption[];
}) {
  const purchasable = options.filter((o) => !o.contact_admin && o.amount != null);
  const monthly = purchasable.find((o) => getBillingKind(o) === "monthly") ?? null;
  const annual = purchasable.find((o) => getBillingKind(o) === "annual") ?? null;
  const others = purchasable.filter(
    (o) => getBillingKind(o) === "other" && o !== monthly && o !== annual,
  );
  const contactOnly = options.length > 0 && purchasable.length === 0;
  const saving =
    monthly && annual
      ? computeAnnualSaving(Number(monthly.amount), Number(annual.amount))
      : null;

  return (
    <div className="rounded-2xl border bg-card p-6 shadow-card">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <Tag className="h-4 w-4 text-primary" /> Choose Your Subscription
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Subscribe monthly or annually to this individual tool.
      </p>

      {options.length === 0 || contactOnly ? (
        <p className="mt-4 rounded-lg border bg-background/40 px-3 py-3 text-sm text-primary">
          Pricing confirmed on WhatsApp
        </p>
      ) : (
        <div className="mt-4 grid gap-3">
          {monthly ? (
            <PlanTile slug={slug} opt={monthly} label="Monthly" />
          ) : null}
          {annual ? (
            <PlanTile
              slug={slug}
              opt={annual}
              label="Annual"
              badge={
                saving
                  ? `Save ${formatCurrency(saving.amount, annual.currency || "₦")}`
                  : null
              }
              savingText={
                saving
                  ? `Save ${formatCurrency(saving.amount, annual.currency || "₦")} compared with monthly billing${
                      saving.percent > 0 ? ` (${saving.percent}%)` : ""
                    }`
                  : null
              }
              monthlyEquivalent={
                saving
                  ? `Equivalent to approximately ${formatCurrency(
                      saving.monthlyEquivalent,
                      annual.currency || "₦",
                    )} per month`
                  : null
              }
            />
          ) : null}
          {others.map((o) => (
            <PlanTile
              key={o.id}
              slug={slug}
              opt={o}
              label={o.label ?? "Standard"}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PlanTile({
  slug,
  opt,
  label,
  badge,
  savingText,
  monthlyEquivalent,
}: {
  slug: string;
  opt: ToolPricingOption;
  label: string;
  badge?: string | null;
  savingText?: string | null;
  monthlyEquivalent?: string | null;
}) {
  const kind = getBillingKind(opt);
  const billing = billingDescription(kind);
  const renewal = renewalText(kind);
  return (
    <div className="rounded-xl border bg-background/40 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">{label}</span>
            {badge ? (
              <span className="rounded-full bg-success/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-success">
                {badge}
              </span>
            ) : null}
          </div>
          {opt.label && opt.label !== label ? (
            <div className="text-[11px] text-muted-foreground">{opt.label}</div>
          ) : null}
        </div>
        <div className="text-right">
          <div className="text-base font-bold" aria-label={formatPlanPrice(opt)}>
            {formatPlanPrice(opt)}
          </div>
          {billing ? (
            <div className="text-[11px] text-muted-foreground">{billing}</div>
          ) : null}
        </div>
      </div>

      {monthlyEquivalent ? (
        <p className="mt-2 text-[11px] text-muted-foreground">{monthlyEquivalent}</p>
      ) : null}
      {savingText ? (
        <p className="mt-1 flex items-center gap-1 text-[11px] text-success">
          <TrendingDown className="h-3 w-3" /> {savingText}
        </p>
      ) : null}
      {renewal ? (
        <p className="mt-2 text-[11px] text-muted-foreground">{renewal}</p>
      ) : null}

      <Link
        to="/order/$slug"
        params={{ slug }}
        search={{ plan: opt.id }}
        className="mt-3 inline-flex w-full items-center justify-center rounded-md bg-gradient-primary px-3 py-2 text-xs font-medium text-primary-foreground shadow-glow hover:opacity-90"
      >
        Choose {label}
      </Link>
    </div>
  );
}
