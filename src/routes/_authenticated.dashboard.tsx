import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CreditCard, LayoutGrid, Sparkles, Star, Clock, User } from "lucide-react";
import { SiteLayout } from "@/components/site/SiteLayout";
import { ToolBrandMark } from "@/components/tools/ToolBrandMark";
import { supabase } from "@/integrations/supabase/client";
import { TOOLS, getTool } from "@/lib/tools-data";

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

  const { data: sub } = useQuery({
    queryKey: ["subscription", user.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_subscriptions")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();
      return data;
    },
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

  const displayName =
    (user.user_metadata?.full_name as string | undefined) ??
    user.email?.split("@")[0] ??
    "there";

  const plan = sub?.plan ?? "free";
  const status = sub?.status ?? "inactive";
  const renewal = sub?.current_period_end
    ? new Date(sub.current_period_end).toLocaleDateString()
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
              to="/billing"
              className="inline-flex items-center gap-2 rounded-md border border-input px-4 py-2 text-sm font-medium hover:bg-muted"
            >
              <CreditCard className="h-4 w-4" /> Billing
            </Link>
          </div>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            icon={CreditCard}
            label="Plan"
            value={plan[0].toUpperCase() + plan.slice(1)}
            hint={`Status: ${status}`}
          />
          <StatCard icon={Clock} label="Next renewal" value={renewal} />
          <StatCard icon={LayoutGrid} label="Available tools" value={String(TOOLS.length)} />
          <StatCard icon={Star} label="Favourites" value={String(favTools.length)} />
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
                <dt className="text-muted-foreground">Plan</dt>
                <dd className="font-medium capitalize">{plan}</dd>
              </div>
            </dl>
            <div className="mt-5 flex flex-col gap-2">
              <Link to="/profile" className="rounded-md border border-input px-3 py-2 text-center text-sm font-medium hover:bg-muted">
                Profile settings
              </Link>
              <Link to="/subscription" className="rounded-md border border-input px-3 py-2 text-center text-sm font-medium hover:bg-muted">
                Manage subscription
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
