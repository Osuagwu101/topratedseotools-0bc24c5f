import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CreditCard, Sparkles, Star, Clock, User, CheckCircle2, ExternalLink, MessageSquare, KeyRound } from "lucide-react";
import { SiteLayout } from "@/components/site/SiteLayout";
import { ToolBrandMark } from "@/components/tools/ToolBrandMark";
import { supabase } from "@/integrations/supabase/client";
import { TOOLS, getTool } from "@/lib/tools-data";
import { listMyOrders, listToolSettings } from "@/lib/access.functions";
import { getMyGrantedAccess } from "@/lib/grant-access.functions";
import { listMyReviewEligibility } from "@/lib/reviews.functions";
import { launchTool } from "@/lib/tool-launcher";
import {
  getMyStealthWriterExperience,
  removeMyStealthWriterDevice,
} from "@/lib/stealthwriter-controls.functions";

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
  const qc = useQueryClient();
  const usesAdminIssuedPassword =
    (user.user_metadata as { admin_issued_password?: boolean } | null)
      ?.admin_issued_password === true;

  const { data: ordersData } = useQuery({
    queryKey: ["my-orders"],
    queryFn: () => listMyOrders(),
  });

  const { data: grantsData } = useQuery({
    queryKey: ["my-granted-access"],
    queryFn: () => getMyGrantedAccess(),
  });

  const { data: toolSettingsData } = useQuery({
    queryKey: ["tool-settings"],
    queryFn: () => listToolSettings(),
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

  const { data: profile } = useQuery({
    queryKey: ["profile-name", user.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", user.id)
        .maybeSingle();
      return data ?? null;
    },
  });

  // Customer-facing greeting: never surface role names ("Admin", "User", etc.)
  // as an identity. Extract only the first name from the user's profile.
  // If no valid first name is available, use a neutral "Welcome back".
  const RESERVED_NAMES = new Set([
    "admin",
    "administrator",
    "superadmin",
    "super",
    "root",
    "staff",
    "support",
    "moderator",
    "owner",
    "user",
    "customer",
  ]);
  const extractFirstName = (raw?: string | null): string | undefined => {
    const trimmed = raw?.trim();
    if (!trimmed) return undefined;
    const first = trimmed.split(/\s+/)[0];
    if (!first) return undefined;
    if (RESERVED_NAMES.has(first.toLowerCase())) return undefined;
    if (first.includes("@")) return undefined;
    return first;
  };
  const firstName =
    extractFirstName(profile?.full_name) ??
    extractFirstName(user.user_metadata?.full_name as string | undefined) ??
    extractFirstName(user.user_metadata?.name as string | undefined) ??
    extractFirstName(user.user_metadata?.first_name as string | undefined);
  const greeting = firstName ? `Welcome back, ${firstName}` : "Welcome back";

  const now = Date.now();
  const orders = ordersData?.orders ?? [];
  const activeOrders = orders.filter(
    (o) =>
      o.status === "approved" &&
      (!o.expires_at || new Date(o.expires_at).getTime() > now),
  );
  const activeGrants = grantsData?.grants ?? [];
  const paidSlugs = new Set(activeOrders.map((o) => o.tool_slug));
  const grantOnly = activeGrants.filter((g) => !paidSlugs.has(g.tool_slug));
  const activeStealthWriterOrder = activeOrders.find((o) => o.tool_slug === "stealthwriter");
  const activeStealthWriterGrant = activeGrants.find((g) => g.tool_slug === "stealthwriter");
  const hasStealthWriterAccess = !!activeStealthWriterOrder || !!activeStealthWriterGrant;
  const activeToolCount = new Set([
    ...activeOrders.map((o) => o.tool_slug),
    ...activeGrants.map((g) => g.tool_slug),
  ]).size;

  const { data: stealthWriterExperience } = useQuery({
    queryKey: ["my-stealthwriter-experience", user.id],
    queryFn: () => getMyStealthWriterExperience(),
    enabled: hasStealthWriterAccess,
    staleTime: 15_000,
  });

  const removeStealthWriterDevice = useMutation({
    mutationFn: (deviceId: string) =>
      removeMyStealthWriterDevice({ data: { deviceId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-stealthwriter-experience", user.id] });
    },
  });

  const stealthWriterTool = getTool("stealthwriter");
  const stealthWriterSetting = toolSettingsData?.settings.find(
    (setting) => setting.tool_slug === "stealthwriter",
  );

  const stealthWriterExpiry = activeStealthWriterOrder?.expires_at
    ? new Date(activeStealthWriterOrder.expires_at)
    : null;
  const stealthWriterDaysLeft = stealthWriterExpiry
    ? Math.max(0, Math.ceil((stealthWriterExpiry.getTime() - now) / 86_400_000))
    : null;
  const stealthWriterDurationDays = Math.max(
    1,
    Number(activeStealthWriterOrder?.duration_days ?? 28),
  );
  const stealthWriterProgress =
    stealthWriterDaysLeft == null
      ? 100
      : Math.max(
          0,
          Math.min(
            100,
            Math.round((stealthWriterDaysLeft / stealthWriterDurationDays) * 100),
          ),
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
        {usesAdminIssuedPassword ? (
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
            <div className="flex items-start gap-2">
              <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
              <div>
                <p className="font-medium">You are using a temporary password issued by Admin.</p>
                <p className="text-muted-foreground">You can continue using it, or change it whenever you want.</p>
              </div>
            </div>
            <Link to="/profile" className="font-medium text-primary hover:underline">
              Change password
            </Link>
          </div>
        ) : null}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <h1 className="truncate text-3xl font-bold tracking-tight">{greeting}</h1>

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

        {hasStealthWriterAccess && stealthWriterTool ? (
          <div className="mt-8 space-y-5">
            <div className="grid gap-5 lg:grid-cols-3">
              <div className="lg:col-span-2 rounded-2xl border bg-card p-6 shadow-card">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm text-muted-foreground">Welcome back,</div>
                    <div className="text-xl font-bold">
                      {profile?.full_name || user.email || "Customer"}
                    </div>
                  </div>
                  <span className="rounded-full bg-success/15 px-3 py-1 text-xs font-semibold text-success">
                    {stealthWriterDaysLeft == null
                      ? "Active"
                      : `${stealthWriterDaysLeft} day(s) left`}
                  </span>
                </div>
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-primary"
                    style={{ width: `${stealthWriterProgress}%` }}
                  />
                </div>
                <div className="mt-2 text-xs text-muted-foreground">
                  {stealthWriterExpiry
                    ? `Subscription active — expires ${stealthWriterExpiry.toISOString().replace("T", " ").replace(".000Z", " UTC")}`
                    : "StealthWriter access is active."}
                </div>
              </div>

              <Link
                to="/tools"
                className="rounded-2xl bg-gradient-primary p-6 text-primary-foreground shadow-card"
              >
                <div className="text-lg font-bold">Browse Tools</div>
                <div className="mt-2 text-sm opacity-90">
                  See everything available on Top Rated SEO Tools.
                </div>
                <div className="mt-4 w-fit rounded-full bg-white/15 px-3 py-1 text-xs">
                  Browse tools →
                </div>
              </Link>
            </div>

            <div>
              <h2 className="mb-4 text-lg font-semibold">Your Tools</h2>
              <div className="max-w-md overflow-hidden rounded-2xl border bg-card shadow-card">
                <div className="flex h-24 items-center justify-center border-b bg-muted/20">
                  <ToolBrandMark tool={stealthWriterTool} size="lg" />
                </div>
                <div className="p-5">
                  <div className="font-semibold">{stealthWriterTool.name}</div>
                  <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                    <div>
                      AI Detector:{" "}
                      <strong className="text-foreground">
                        {stealthWriterExperience?.features.ai_detector.used ?? 0} /{" "}
                        {stealthWriterExperience?.features.ai_detector.limit ?? 20}
                      </strong>{" "}
                      used today
                    </div>
                    <div>
                      Humanizer:{" "}
                      <strong className="text-foreground">
                        {stealthWriterExperience?.features.humanizer.used ?? 0} /{" "}
                        {stealthWriterExperience?.features.humanizer.limit ?? 20}
                      </strong>{" "}
                      used today
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={!stealthWriterSetting?.one_click_auth_enabled}
                    onClick={() => {
                      if (!stealthWriterSetting) return;
                      void launchTool(stealthWriterTool, stealthWriterSetting, {
                        grantAccess: !!activeStealthWriterGrant,
                      });
                    }}
                    className="mt-4 w-full rounded-lg bg-gradient-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-glow hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Access Stealth Writer
                  </button>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border bg-card p-6 shadow-card">
              <h2 className="font-semibold">
                Devices ({stealthWriterExperience?.devices.length ?? 0} /{" "}
                {stealthWriterExperience?.device_limit ?? 2})
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Remove a device you no longer use to free up a slot.
              </p>
              <div className="mt-4 divide-y">
                {(stealthWriterExperience?.devices ?? []).map((device) => (
                  <div
                    key={device.id}
                    className="flex items-center justify-between gap-4 py-3 text-sm"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium">{device.label || "Device"}</div>
                      <div className="text-xs text-muted-foreground">
                        Last used{" "}
                        {new Date(device.last_seen_at)
                          .toISOString()
                          .replace("T", " ")
                          .replace(".000Z", " UTC")}
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={removeStealthWriterDevice.isPending}
                      onClick={() => {
                        if (!window.confirm("Remove this device?")) return;
                        removeStealthWriterDevice.mutate(device.id);
                      }}
                      className="shrink-0 text-xs font-medium text-destructive hover:underline disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </div>
                ))}
                {(stealthWriterExperience?.devices.length ?? 0) === 0 ? (
                  <div className="py-3 text-sm text-muted-foreground">
                    No devices registered yet — the first one is added when you access StealthWriter.
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <StatCard
            icon={CheckCircle2}
            label="Active tools"
            value={String(activeToolCount)}
            hint={pendingCount ? `${pendingCount} awaiting payment` : undefined}
          />
          <StatCard icon={Clock} label="Next renewal" value={nextRenewalDate} />
          <StatCard icon={Star} label="Favourites" value={String(favTools.length)} />
        </div>

        {!hasStealthWriterAccess || activeToolCount > 1 ? (
        <div className="mt-10">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Your active tools</h2>
            <Link to="/tools" className="text-xs font-medium text-primary hover:underline">
              Browse tools →
            </Link>
          </div>
          {activeToolCount === 0 ? (
            <div className="rounded-2xl border border-dashed p-10 text-center">
              <CheckCircle2 className="mx-auto h-6 w-6 text-muted-foreground" />
              <p className="mt-2 text-sm text-muted-foreground">
                No active tools yet.{" "}
                <Link to="/tools" className="text-primary hover:underline">
                  Browse tools
                </Link>{" "}
                to get started.
              </p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {activeOrders.filter((o) => o.tool_slug !== "stealthwriter").map((o) => {
                const t = getTool(o.tool_slug);
                if (!t) return null;
                return (
                  <Link
                    key={`order:${o.id}`}
                    to="/tools/$slug"
                    params={{ slug: t.slug }}
                    className="group flex items-center gap-3 rounded-xl border bg-card p-4 shadow-card transition hover:border-primary/40"
                  >
                    <ToolBrandMark tool={t} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{t.name}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                        <span className="rounded-full bg-success/15 px-1.5 py-0.5 font-semibold uppercase tracking-wide text-success">
                          Active
                        </span>
                        {o.access_type ? <span className="capitalize">{o.access_type}</span> : null}
                        {o.billing_period ? <span className="capitalize">· {o.billing_period}</span> : null}
                      </div>
                    </div>
                    <ExternalLink className="h-4 w-4 text-muted-foreground group-hover:text-primary" />
                  </Link>
                );
              })}

              {grantOnly.filter((g) => g.tool_slug !== "stealthwriter").map((g) => {
                const t = getTool(g.tool_slug);
                if (!t) return null;
                return (
                  <Link
                    key={`grant:${g.grant_id}`}
                    to="/tools/$slug"
                    params={{ slug: t.slug }}
                    className="group flex items-center gap-3 rounded-xl border bg-card p-4 shadow-card transition hover:border-primary/40"
                  >
                    <ToolBrandMark tool={t} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{t.name}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                        <span className="rounded-full bg-primary/15 px-1.5 py-0.5 font-semibold uppercase tracking-wide text-primary">
                          Lifetime
                        </span>
                        <span className="capitalize">{g.access_type}</span>
                      </div>
                    </div>
                    <ExternalLink className="h-4 w-4 text-muted-foreground group-hover:text-primary" />
                  </Link>
                );
              })}
            </div>
          )}
        </div>
        ) : null}

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
                <dd className="font-medium">{activeToolCount}</dd>
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
