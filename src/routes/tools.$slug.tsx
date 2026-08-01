import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useSuspenseQuery, useQuery, queryOptions } from "@tanstack/react-query";
import { ArrowLeft, Check, Tag, TrendingDown, Users, Lock, MessageCircle, ShieldAlert } from "lucide-react";
import type { Tool } from "@/lib/tools-data";
import { getPublicSiteSettings } from "@/lib/site-settings.functions";
import { SiteLayout } from "@/components/site/SiteLayout";
import { ToolBrandMark } from "@/components/tools/ToolBrandMark";
import { ToolAccessPanel } from "@/components/tools/ToolAccessPanel";
import { getTool, TOOLS } from "@/lib/tools-data";
import { listToolPricing, type ToolPricingOption, type AccessType } from "@/lib/tool-pricing.functions";
import {
  billingDescription,
  computeQuarterlySaving,
  computeYearlySaving,
  computeYearlyVsQuarterlySaving,
  formatCurrency,
  formatPlanPrice,
  getBillingKind,
  normaliseBillingKind,
  renewalText,
} from "@/lib/currency";
import { listToolSettings } from "@/lib/access.functions";
import { listToolOverrides, applyOverride } from "@/lib/tool-overrides.functions";
import { supabase } from "@/integrations/supabase/client";
import { ReviewSection } from "@/components/reviews/ReviewSection";

const pricingQuery = queryOptions({
  queryKey: ["tool-pricing"],
  queryFn: () => listToolPricing(),
});
const settingsQuery = queryOptions({
  queryKey: ["tool-settings"],
  queryFn: () => listToolSettings(),
});
const overridesQuery = queryOptions({
  queryKey: ["tool-overrides"],
  queryFn: () => listToolOverrides(),
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
    context.queryClient.ensureQueryData(overridesQuery);
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
  const baseTool = getTool(data.slug)!;
  const { data: pricing } = useSuspenseQuery(pricingQuery);
  const { data: settings } = useSuspenseQuery(settingsQuery);
  const { data: overridesData } = useSuspenseQuery(overridesQuery);
  const { data: session } = useQuery(sessionQuery);
  const override = overridesData.overrides.find((o) => o.tool_slug === baseTool.slug);
  const tool = { ...baseTool, ...applyOverride(baseTool, override) };
  const priceOptions = pricing.options.filter((o) => o.tool_slug === tool.slug);
  const setting = settings.settings.find((s) => s.tool_slug === tool.slug);
  const overrideBySlug = new Map(overridesData.overrides.map((o) => [o.tool_slug, o]));
  const related = TOOLS.filter((t) => t.category === tool.category && t.slug !== tool.slug)
    .map((t) => ({ ...t, ...applyOverride(t, overrideBySlug.get(t.slug)) }))
    .filter((t) => t.is_visible)
    .slice(0, 3);

  if (!tool.is_visible) {
    return (
      <SiteLayout>
        <div className="mx-auto max-w-md px-4 py-24 text-center">
          <h1 className="text-2xl font-semibold">Tool unavailable</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This tool is currently hidden and not available to customers.
          </p>
          <Link
            to="/tools"
            className="mt-6 inline-block text-sm text-primary hover:underline"
          >
            Browse other tools
          </Link>
        </div>
      </SiteLayout>
    );
  }


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
            {tool.image_url ? (
              <img
                src={tool.image_url}
                alt=""
                className="h-20 w-20 rounded-2xl object-cover shadow-card"
              />
            ) : (
              <ToolBrandMark tool={tool} size="lg" className="shadow-card" />
            )}
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
        {tool.pricingModel === "per_use" ? (
          <PerUsePanel tool={tool} />
        ) : (
          <div className="grid gap-6 md:grid-cols-2">
            <ToolAccessPanel
              tool={tool}
              setting={setting}
              isAuthenticated={session?.isAuthenticated ?? false}
            />

            <SubscriptionCard slug={tool.slug} options={priceOptions} setting={setting} />
          </div>
        )}

        {tool.features && tool.features.length > 0 ? (
          <div className="mt-8 rounded-2xl border bg-card p-6 shadow-card">
            <h2 className="text-lg font-semibold">What you can do with {tool.name}</h2>
            <ul className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              {tool.features.map((f) => (
                <li key={f} className="flex items-start gap-2">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <ReviewSection tool={tool} isAuthenticated={session?.isAuthenticated ?? false} />



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

type Period = "monthly" | "quarterly" | "yearly";
interface AccessBucket {
  monthly: ToolPricingOption | null;
  quarterly: ToolPricingOption | null;
  yearly: ToolPricingOption | null;
  other: ToolPricingOption[];
}

function bucketize(opts: ToolPricingOption[]): AccessBucket {
  const b: AccessBucket = { monthly: null, quarterly: null, yearly: null, other: [] };
  for (const o of opts) {
    const k = normaliseBillingKind(getBillingKind(o));
    if (k === "monthly" && !b.monthly) b.monthly = o;
    else if (k === "quarterly" && !b.quarterly) b.quarterly = o;
    else if (k === "yearly" && !b.yearly) b.yearly = o;
    else b.other.push(o);
  }
  return b;
}

function bucketHas(b: AccessBucket): boolean {
  return !!(b.monthly || b.quarterly || b.yearly) || b.other.length > 0;
}

function SubscriptionCard({
  slug,
  options,
  setting,
}: {
  slug: string;
  options: ToolPricingOption[];
  setting:
    | {
        shared_access_enabled: boolean;
        private_access_enabled: boolean;
        shared_access_authorization?: string;
        private_access_authorization?: string;
      }
    | undefined;
}) {
  const sharedAllowed =
    (setting?.shared_access_enabled ?? true) &&
    (setting?.shared_access_authorization ?? "confirmed") === "confirmed";
  const privateAllowed =
    (setting?.private_access_enabled ?? true) &&
    (setting?.private_access_authorization ?? "confirmed") === "confirmed";
  const purchasable = options.filter(
    (o) => o.enabled && !o.contact_admin && o.amount != null,
  );
  const shared = bucketize(
    purchasable.filter((o) => ((o.access_type as AccessType) ?? "shared") === "shared"),
  );
  const priv = bucketize(purchasable.filter((o) => o.access_type === "private"));
  const contactOnly = options.length > 0 && purchasable.length === 0;
  const hasShared = sharedAllowed && bucketHas(shared);
  const hasPrivate = privateAllowed && bucketHas(priv);

  return (
    <div className="rounded-2xl border bg-card p-6 shadow-card">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <Tag className="h-4 w-4 text-primary" /> Choose Your Subscription
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Pick Shared or Private access, then choose Monthly, Quarterly, or Yearly billing.
      </p>

      {(!hasShared && !hasPrivate) || contactOnly ? (
        <p className="mt-4 rounded-lg border bg-background/40 px-3 py-3 text-sm text-primary">
          Pricing confirmed on WhatsApp
        </p>
      ) : (
        <div className="mt-4 space-y-5">
          {hasShared ? (
            <AccessSection
              slug={slug}
              title="Shared Access"
              icon={<Users className="h-4 w-4" />}
              bucket={shared}
            />
          ) : null}
          {hasPrivate ? (
            <AccessSection
              slug={slug}
              title="Private Access"
              icon={<Lock className="h-4 w-4" />}
              bucket={priv}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

function AccessSection({
  slug,
  title,
  icon,
  bucket,
}: {
  slug: string;
  title: string;
  icon: React.ReactNode;
  bucket: AccessBucket;
}) {
  const qSave = computeQuarterlySaving(bucket.monthly?.amount, bucket.quarterly?.amount);
  const ySave = computeYearlySaving(bucket.monthly?.amount, bucket.yearly?.amount);
  const yFromQ =
    !bucket.monthly && bucket.quarterly && bucket.yearly
      ? computeYearlyVsQuarterlySaving(bucket.quarterly.amount, bucket.yearly.amount)
      : null;

  return (
    <div className="rounded-xl border bg-background/40 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold">
        {icon}
        <span>{title}</span>
      </div>
      <div className="mt-3 grid gap-3">
        {bucket.monthly ? (
          <PlanTile slug={slug} opt={bucket.monthly} label="Monthly" />
        ) : null}
        {bucket.quarterly ? (
          <PlanTile
            slug={slug}
            opt={bucket.quarterly}
            label="Quarterly"

            badge={
              qSave
                ? `Save ${money.fmt(qSave.amount)}`
                : null
            }
            savingText={
              qSave
                ? `Save ${money.fmt(qSave.amount)} compared with three monthly payments`
                : null
            }
          />
        ) : null}
        {bucket.yearly ? (
          <PlanTile
            slug={slug}
            opt={bucket.yearly}
            label="Yearly"

            badge={
              ySave
                ? `Save ${money.fmt(ySave.amount)}`
                : yFromQ
                  ? `Save ${money.fmt(yFromQ.amount)}`
                  : null
            }
            savingText={
              ySave
                ? `Save ${money.fmt(ySave.amount)} yearly compared with monthly billing`
                : yFromQ
                  ? `Save ${money.fmt(yFromQ.amount)} compared with four quarterly payments`
                  : null
            }
            monthlyEquivalent={
              ySave || yFromQ
                ? `Equivalent to approximately ${money.fmt(
                    Math.round(Number(bucket.yearly.amount) / 12),
                  )} per month`
                : null
            }
          />
        ) : null}
        {bucket.other.map((o) => (
          <PlanTile
            key={o.id}
            slug={slug}
            opt={o}
            label={o.label ?? "Standard"}

          />
        ))}
      </div>
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
          <div className="text-base font-bold" aria-label={money.plan(opt)}>
            {money.plan(opt)}
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

/**
 * Per-use pricing panel — used for pay-per-check tools like Turnitin.
 * The public quantity-based checkout is not wired up yet, so we do NOT
 * expose a subscription checkout. We show the price, let the customer
 * choose a quantity to see the total, and direct them to WhatsApp to
 * place the order.
 */
function PerUsePanel({ tool }: { tool: Tool }) {
  const perUse = tool.perUse!;
  const { data: siteSettings } = useQuery({
    queryKey: ["public-site-settings"],
    queryFn: () => getPublicSiteSettings(),
    staleTime: 5 * 60_000,
  });
  const whatsapp = (siteSettings?.adminWhatsappNumber ?? "").replace(/\D/g, "");
  const currency = perUse.currency || "₦";
  const perUnit = money.fmt(perUse.amount);

  return (
    <div className="rounded-2xl border bg-card p-6 shadow-card">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <Tag className="h-4 w-4 text-primary" /> {perUnit} per {perUse.unit}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {tool.name} is a one-time, pay-per-{perUse.unit} service. You choose how
        many {perUse.unit}s you need and pay the total once — there is no
        monthly, quarterly or yearly billing, no Shared or Private Access
        selection, and no automatic renewal.
      </p>

      <QuantityCalculator perUse={perUse} />

      <div className="mt-5 rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
        Online per-{perUse.unit} checkout is being finalised. To place an order
        now, message us on WhatsApp with the number of {perUse.unit}s you need
        and the documents you want submitted, and we will send you a payment
        link and return the reports.
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {whatsapp ? (
          <a
            href={`https://wa.me/${whatsapp}?text=${encodeURIComponent(
              `Hello, I would like to order ${tool.name}. Please send me a payment link.`,
            )}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-md bg-gradient-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-glow hover:opacity-90"
          >
            <MessageCircle className="h-4 w-4" /> Order on WhatsApp
          </a>
        ) : (
          <Link
            to="/contact"
            className="inline-flex items-center gap-2 rounded-md bg-gradient-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-glow hover:opacity-90"
          >
            <MessageCircle className="h-4 w-4" /> Contact us to order
          </Link>
        )}
        <span className="inline-flex items-center gap-1 rounded-md border border-input px-3 py-2 text-xs text-muted-foreground">
          <ShieldAlert className="h-3.5 w-3.5" /> No auto-renewal
        </span>
      </div>
    </div>
  );
}

function QuantityCalculator({
  perUse,
}: {
  perUse: NonNullable<Tool["perUse"]>;
}) {
  const currency = perUse.currency || "₦";
  const [qty, setQty] = useStateNumber(1);
  const total = Math.max(0, qty) * perUse.amount;
  return (
    <div className="mt-4 rounded-lg border bg-background/40 p-4">
      <label className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Number of {perUse.unit}s
      </label>
      <div className="mt-2 flex items-center gap-3">
        <input
          type="number"
          min={1}
          value={qty}
          onChange={(e) => setQty(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
          className="w-24 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40"
        />
        <div className="text-sm text-muted-foreground">
          × {money.fmt(perUse.amount)} ={" "}
          <span className="text-base font-bold text-foreground">
            {money.fmt(total)}
          </span>
        </div>
      </div>
    </div>
  );
}

// Small local hook so we don't import React namespace just for one useState.
import { useState as useStateNumber } from "react";
