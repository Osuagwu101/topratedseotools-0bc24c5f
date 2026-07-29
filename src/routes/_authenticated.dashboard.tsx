import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CreditCard, Sparkles, Star, Clock, User, CheckCircle2, ExternalLink, MessageSquare } from "lucide-react";
import { SiteLayout } from "@/components/site/SiteLayout";
import { ToolBrandMark } from "@/components/tools/ToolBrandMark";
import { supabase } from "@/integrations/supabase/client";
import { TOOLS, getTool } from "@/lib/tools-data";
import { listMyOrders } from "@/lib/access.functions";
import { listMyReviewEligibility } from "@/lib/reviews.functions";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — Top Rated SEO Tools" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { user } = Route.useRouteContext();

  const { data: ordersData } = useQuery({
    queryKey: ["my-orders"],
    queryFn: () => listMyOrders(),
  });

  const { data: favorites } = useQuery({
    queryKey: ["favorites", user.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_favorites")
        .select("tool_slug")
        .eq("user_id", user.id);
      return data ?? [];
    },
  });

  const { data: recent } = useQuery({
    queryKey: ["recent", user.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("tool_usage")
        .select("tool_slug, used_at")
        .eq("user_id", user.id)
        .order("used_at", { ascending: false })
        .limit(6);
      return data ?? [];
    },
  });

  const { data: reviewEligibility } = useQuery({
    queryKey: ["my-review-eligibility", user.id],
    queryFn: () => listMyReviewEligibility(),
  });
  const reviewItems = (reviewEligibility?.items ?? [])
    .map((e) => ({ eligibility: e, tool: getTool(e.tool_slug) }))
    .filter((r): r is { eligibility: typeof r.eligibility; tool: NonNullable<ReturnType<typeof getTool>> } => !!r.tool)
    .filter((r) => r.eligibility.qualifying_count > 0 || r.eligibility.review);

  // Customer-facing greeting: never surface "Admin" as an identity. Use the
  // customer's first name when it's a real personal name, otherwise fall back
  // to a neutral greeting. Admin terminology only appears in admin routes.
  const RESERVED_NAMES = new Set([
    "admin",
    "administrator",
    "superadmin",
    "super admin",
    "super-admin",
    "root",
    "staff",
    "support",
    "moderator",
    "owner",
  ]);
  const rawFullName = (user.user_metadata?.full_name as string | undefined)?.trim();
  const firstName = rawFullName ? rawFullName.split(/\s+/)[0] : undefined;
  const emailLocal = user.email?.split("@")[0];
  const candidate = firstName ?? emailLocal;
  const displayName =
    candidate && !RESERVED_NAMES.has(candidate.toLowerCase())
      ? candidate
      : "there";

  const now = Date.now();
  const orders = ordersData?.orders ?? [];
  const activeOrders = orders.filter(
    (o) =>
      o.status === "approved" &&
      (!o.expires_at || new Date(o.expires_at).getTime() > now),
  );
  const pendingCount = orders.filter((o) => o.status === "pending").length;
  const nextRenewalOrder = activeOrders
    .filter((o) => o.next_payment_at || o.expires_at)
    .sort((a, b) => {
      const ax = new Date(a.next_payment_at ?? a.expires_at ?? 0).getTime();
      const bx = new Date(b.next_payment_at ?? b.expires_at ?? 0).getTime();
      return ax - bx;
    })[0];
  const nextRenewalDate = nextRenewalOrder
    ? new Date(
        nextRenewalOrder.next_payment_at ??
          nextRenewalOrder.expires_at ??
          Date.now(),
      ).toLocaleDateString()
    : "—";

  const favTools = (favorites ?? [])
    .map((f) => getTool(f.tool_slug))
    .filter((t): t is NonNullable<typeof t> => !!t);

  const recentTools = (recent ?? [])
    .map((r) => getTool(r.tool_slug))
    .filter((t): t is NonNullable<typeof t> => !!t);

  return (
    <SiteLayout>
      <section className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <h1 className="truncate text-3xl font-bold tracking-tight">Welcome back, {displayName}</h1>
            <p className="mt-1 text-sm text-muted-foreground">Here's a snapshot of your workspace.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              to="/tools"
              className="inline-flex items-center gap-2 rounded-md bg-gradient-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-glow hover:opacity-90"
            >
              <Sparkles className="h-4 w-4" /> Explore tools
            </Link>
            <Link
              to="/orders"
              className="inline-flex items-center gap-2 rounded-md border border-input px-4 py-2 text-sm font-medium hover:bg-muted"
            >
              <CreditCard className="h-4 w-4" /> My subscriptions
            </Link>
          </div>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard
            icon={CheckCircle2}
            label="Active subscriptions"
            value={String(activeOrders.length)}
            hint={pendingCount ? `${pendingCount} awaiting payment` : undefined}
          />
          <StatCard icon={Clock} label="Next renewal" value={nextRenewalDate} />
          <StatCard icon={Star} label="Favourites" value={String(favTools.length)} />
        </div>

        <div className="mt-10">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Your active tools</h2>
            <Link to="/orders" className="text-xs font-medium text-primary hover:underline">
              Manage subscriptions →
            </Link>
          </div>
          {activeOrders.length === 0 ? (
            <div className="rounded-2xl border border-dashed p-10 text-center">
              <CheckCircle2 className="mx-auto h-6 w-6 text-muted-foreground" />
              <p className="mt-2 text-sm text-muted-foreground">
                No active subscriptions yet.{" "}
                <Link to="/tools" className="text-primary hover:underline">
                  Browse tools
                </Link>{" "}
                to purchase access.
              </p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {activeOrders.map((o) => {
                const t = getTool(o.tool_slug);
                if (!t) return null;
                return (
                  <Link
                    key={o.id}
                    to="/orders"
                    className="group flex items-center gap-3 rounded-xl border bg-card p-4 shadow-card transition hover:border-primary/40"
                  >
                    <ToolBrandMark tool={t} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{t.name}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                        <span className="rounded-full bg-success/15 px-1.5 py-0.5 font-semibold uppercase tracking-wide text-success">
                          Active
                        </span>
                        {o.access_type ? (
                          <span className="capitalize">{o.access_type}</span>
                        ) : null}
                        {o.billing_period ? (
                          <span className="capitalize">· {o.billing_period}</span>
                        ) : null}
                      </div>
                    </div>
                    <ExternalLink className="h-4 w-4 text-muted-foreground group-hover:text-primary" />
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-10">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">My reviews</h2>
            <span className="text-xs text-muted-foreground">One review per tool. A repurchase unlocks one update.</span>
          </div>
          {reviewItems.length === 0 ? (
            <div className="rounded-2xl border border-dashed p-10 text-center">
              <MessageSquare className="mx-auto h-6 w-6 text-muted-foreground" />
              <p className="mt-2 text-sm text-muted-foreground">
                After a successful purchase you'll be able to leave a verified review here.
              </p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {reviewItems.map(({ eligibility: e, tool: t }) => {
                let label = "Write a Review";
                let updateAvailable = false;
                if (e.review && e.canEdit) { label = "Update Your Review"; updateAvailable = true; }
                else if (e.review) { label = "Review Submitted"; }
                else if (!e.canReview) { label = "Not eligible yet"; }
                const submitted = e.review?.submitted_at
                  ? new Date(e.review.submitted_at).toLocaleDateString()
                  : "—";
                return (
                  <Link
                    key={t.slug}
                    to="/tools/$slug"
                    params={{ slug: t.slug }}
                    hash="reviews"
                    className="group flex items-center gap-3 rounded-xl border bg-card p-4 shadow-card transition hover:border-primary/40"
                  >
                    <ToolBrandMark tool={t} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{t.name}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                        {e.review ? (
                          <span className="inline-flex items-center gap-0.5 font-semibold text-amber-600">
                            {"★".repeat(e.review.rating)}
                            <span className="text-muted-foreground">({e.review.status})</span>
                          </span>
                        ) : null}
                        <span>· Submitted {submitted}</span>
                        {updateAvailable ? (
                          <span className="rounded-full bg-primary/15 px-1.5 py-0.5 font-semibold uppercase tracking-wide text-primary">
                            Update available
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <span className="text-xs font-medium text-primary group-hover:underline">{label} →</span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-10 grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <Section
              title="Recently used"
              empty={{
                icon: Clock,
                text: "No recent activity yet — launch a tool to get started.",
              }}
              items={recentTools}
            />
            <div className="mt-8">
              <Section
                title="Your favourites"
                empty={{ icon: Star, text: "No favourites yet — tap the star on any tool to save it here." }}
                items={favTools}
              />
            </div>
          </div>

          <aside className="rounded-2xl border bg-card p-6 shadow-card">
            <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
              <User className="h-5 w-5" />
            </div>
            <div className="text-lg font-semibold">Account</div>
            <dl className="mt-4 space-y-3 text-sm">
              <div>
                <dt className="text-muted-foreground">Email</dt>
                <dd className="truncate font-medium">{user.email}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Active tools</dt>
                <dd className="font-medium">{activeOrders.length}</dd>
              </div>
            </dl>
            <div className="mt-5 flex flex-col gap-2">
              <Link to="/profile" className="rounded-md border border-input px-3 py-2 text-center text-sm font-medium hover:bg-muted">
                Profile settings
              </Link>
              <Link to="/orders" className="rounded-md border border-input px-3 py-2 text-center text-sm font-medium hover:bg-muted">
                My subscriptions
              </Link>
            </div>
          </aside>
        </div>
      </section>
    </SiteLayout>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof CreditCard;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border bg-card p-5 shadow-card">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="h-4 w-4" /> {label}
      </div>
      <div className="mt-2 text-2xl font-bold tracking-tight">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

function Section({
  title,
  items,
  empty,
}: {
  title: string;
  items: (typeof TOOLS)[number][];
  empty: { icon: typeof Clock; text: string };
}) {
  return (
    <div>
      <h2 className="mb-3 text-lg font-semibold">{title}</h2>
      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-10 text-center">
          <empty.icon className="mx-auto h-6 w-6 text-muted-foreground" />
          <p className="mt-2 text-sm text-muted-foreground">{empty.text}</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {items.slice(0, 6).map((t) => (
              <Link
                key={t.slug}
                to="/tools/$slug"
                params={{ slug: t.slug }}
                className="group flex items-center gap-3 rounded-xl border bg-card p-4 shadow-card transition hover:border-primary/40"
              >
                <ToolBrandMark tool={t} size="sm" />
                <div className="min-w-0">
                  <div className="truncate font-medium">{t.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{t.tagline}</div>
                </div>
              </Link>
          ))}
        </div>
      )}
    </div>
  );
}
