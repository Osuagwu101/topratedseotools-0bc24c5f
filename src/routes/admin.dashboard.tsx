/**
 * Admin overview — branded analytics + day-to-day operating view.
 */
import { AdminShell } from "@/components/admin/AdminShell";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  Ban,
  CalendarClock,
  ClipboardList,
  Clock3,
  CreditCard,
  ExternalLink,
  History,
  PackageCheck,
  Settings2,
  UserCheck,
  Users,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { getAdminOverview } from "@/lib/admin-analytics.functions";
import { requireAdminOrRedirect } from "@/lib/admin-gate";

export const Route = createFileRoute("/admin/dashboard")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Overview — Top Rated SEO Tools" },
      { name: "robots", content: "noindex" },
    ],
  }),
  beforeLoad: async () => {
    await requireAdminOrRedirect();
  },
  component: AdminDashboardPage,
});

function AdminDashboardPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-overview", 14],
    queryFn: () => getAdminOverview({ data: { trendDays: 14 } }),
    refetchInterval: 60_000,
  });

  return (
    <AdminShell>
      <section className="mx-auto max-w-[1500px] px-4 py-6 sm:px-6 lg:px-8">
        <header className="mb-5">
          <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Live platform analytics, subscriptions, tool activity and operational status.
          </p>
        </header>

        {error && (
          <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {(error as Error).message}
          </div>
        )}

        {isLoading || !data ? (
          <div className="rounded-xl border bg-card p-10 text-center text-sm text-muted-foreground shadow-card">
            Loading overview…
          </div>
        ) : (
          <DashboardBody data={data} />
        )}
      </section>
    </AdminShell>
  );
}

type Overview = Awaited<ReturnType<typeof getAdminOverview>>;

function DashboardBody({ data }: { data: Overview }) {
  const c = data.cards;
  const a = data.attention;

  const signupData = data.trend.days.map((day, index) => ({
    day,
    label: formatShortDate(day),
    signups: data.trend.registrations[index] ?? 0,
  }));

  const accessData = data.trend.days.map((day, index) => ({
    day,
    label: formatShortDate(day),
    accesses: data.trend.toolAccess[index] ?? 0,
  }));

  const attentionItems = [
    {
      label: "Awaiting assignment",
      detail: "Private orders that still need fulfilment",
      count: a.privatePending,
      to: "/admin/awaiting-assignments" as const,
    },
    {
      label: "Failed renewals",
      detail: "Subscriptions with renewal problems",
      count: a.failedRenewals,
      to: "/admin/orders" as const,
    },
    {
      label: "Payment reconciliation",
      detail: "Transactions that need a manual check",
      count: a.reconciliation,
      to: "/admin/settings/payment-recovery" as const,
    },
    {
      label: "Expiring soon",
      detail: "Subscriptions expiring within 7 days",
      count: a.expiringSoon,
      to: "/admin/orders" as const,
    },
  ];

  const activeAttention = attentionItems.filter((item) => item.count > 0);

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard
          label="Total Users"
          value={c.totalUsers}
          icon={Users}
          badgeClass="bg-blue-500/10 text-blue-700 dark:text-blue-300"
        />
        <StatCard
          label="Active Subscriptions"
          value={c.activeSubscriptions}
          icon={UserCheck}
          badgeClass="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
        />
        <StatCard
          label="Pending Activation"
          value={c.pendingActivation}
          icon={Clock3}
          badgeClass="bg-indigo-500/10 text-indigo-700 dark:text-indigo-300"
        />
        <StatCard
          label="Expiring in 7 Days"
          value={a.expiringSoon}
          icon={CalendarClock}
          badgeClass="bg-amber-500/10 text-amber-700 dark:text-amber-300"
        />
        <StatCard
          label="Suspended"
          value={c.suspendedUsers}
          icon={Ban}
          badgeClass="bg-red-500/10 text-red-700 dark:text-red-300"
        />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <AnalyticsPanel title="Signups — last 14 days">
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={signupData} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
              <defs>
                <linearGradient id="signupFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="var(--primary)" stopOpacity={0.03} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                axisLine={{ stroke: "var(--border)" }}
                tickLine={false}
                minTickGap={24}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip content={<ChartTooltip noun="signup" />} />
              <Area
                type="monotone"
                dataKey="signups"
                stroke="var(--primary)"
                strokeWidth={2.5}
                fill="url(#signupFill)"
                dot={{ r: 2, fill: "var(--primary)" }}
                activeDot={{ r: 4 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </AnalyticsPanel>

        <AnalyticsPanel title="Tool access — last 14 days">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={accessData} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                axisLine={{ stroke: "var(--border)" }}
                tickLine={false}
                minTickGap={24}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip content={<ChartTooltip noun="access" />} />
              <Bar dataKey="accesses" fill="var(--primary)" radius={[4, 4, 0, 0]} maxBarSize={46} />
            </BarChart>
          </ResponsiveContainer>
        </AnalyticsPanel>
      </div>

      <section className="mt-5 overflow-hidden rounded-xl border bg-card shadow-card">
        <div className="border-b px-4 py-3.5">
          <h2 className="text-sm font-semibold">Engine / Tool Status</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Authorised-session status for managed one-click tools.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-sm">
            <thead className="bg-muted/35 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Tool</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Session last updated</th>
                <th className="px-4 py-3 font-medium">Endpoint</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.engineStatus.map((row) => (
                <tr key={row.tool_slug} className="hover:bg-muted/20">
                  <td className="px-4 py-3 font-medium">{toolName(row.tool_slug)}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={row.status} />
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {row.updatedAt ? new Date(row.updatedAt).toLocaleString() : "—"}
                  </td>
                  <td className="px-4 py-3">
                    {row.endpoint ? (
                      <a
                        href={row.endpoint}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-primary hover:underline"
                      >
                        {row.endpoint.replace(/^https?:\/\//, "")}
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    ) : (
                      <span className="text-muted-foreground">Main-site launch</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1.35fr_0.65fr]">
        <section className="rounded-xl border bg-card shadow-card">
          <div className="flex items-center gap-2 border-b px-4 py-3.5">
            <AlertTriangle className="h-4 w-4 text-warning" />
            <div>
              <h2 className="text-sm font-semibold">Needs attention</h2>
              <p className="text-xs text-muted-foreground">Only items that require action are shown here.</p>
            </div>
          </div>

          {activeAttention.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <PackageCheck className="mx-auto h-7 w-7 text-success" />
              <p className="mt-2 text-sm font-medium">Nothing needs attention right now.</p>
              <p className="mt-1 text-xs text-muted-foreground">Your operational queue is clear.</p>
            </div>
          ) : (
            <div className="divide-y">
              {activeAttention.map((item) => (
                <div key={item.label} className="flex items-center gap-3 px-4 py-3.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{item.label}</div>
                    <div className="text-xs text-muted-foreground">{item.detail}</div>
                  </div>
                  <span className="rounded-full bg-warning/15 px-2 py-0.5 text-xs font-semibold text-warning">
                    {item.count}
                  </span>
                  <Link to={item.to} className="text-xs font-semibold text-primary hover:underline">
                    View
                  </Link>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-xl border bg-card p-4 shadow-card">
          <h2 className="text-sm font-semibold">Quick actions</h2>
          <p className="mt-1 text-xs text-muted-foreground">Common admin tasks.</p>
          <div className="mt-4 grid gap-2">
            <QuickAction to="/admin/tools" icon={Settings2} label="Manage tools" />
            <QuickAction to="/admin/customers" icon={Users} label="View customers" />
            <QuickAction to="/admin/orders" icon={ClipboardList} label="Manage orders" />
            <QuickAction to="/admin/settings/custom-payments" icon={CreditCard} label="Create custom payment" />
          </div>
        </section>
      </div>

      <section className="mt-5 rounded-xl border bg-card shadow-card">
        <div className="flex items-center gap-2 border-b px-4 py-3.5">
          <History className="h-4 w-4 text-primary" />
          <div>
            <h2 className="text-sm font-semibold">Recent activity</h2>
            <p className="text-xs text-muted-foreground">Latest platform events.</p>
          </div>
        </div>
        <div className="divide-y">
          {data.recentActivity.slice(0, 8).map((event) => (
            <div key={event.id} className="flex items-start justify-between gap-4 px-4 py-3 text-sm">
              <div className="min-w-0">
                <div className="font-medium">{event.label}</div>
                {event.detail && <div className="truncate text-xs text-muted-foreground">{event.detail}</div>}
              </div>
              <div className="shrink-0 text-[11px] text-muted-foreground">
                {new Date(event.at).toLocaleString()}
              </div>
            </div>
          ))}
          {data.recentActivity.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">No recent activity.</div>
          )}
        </div>
      </section>
    </>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  badgeClass,
}: {
  label: string;
  value: number;
  icon: LucideIcon;
  badgeClass: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-card">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="mt-2">
        <span className={`inline-flex min-w-9 items-center justify-center rounded-md px-2 py-0.5 text-2xl font-semibold tracking-tight ${badgeClass}`}>
          {value}
        </span>
      </div>
    </div>
  );
}

function AnalyticsPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border bg-card p-4 shadow-card">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function ChartTooltip({
  active,
  payload,
  label,
  noun,
}: {
  active?: boolean;
  payload?: Array<{ value?: number }>;
  label?: string;
  noun: string;
}) {
  if (!active || !payload?.length) return null;
  const value = payload[0]?.value ?? 0;
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg">
      <div className="font-medium">{label}</div>
      <div className="mt-0.5 text-muted-foreground">
        {value} {noun}{value === 1 ? "" : "es"}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: Overview["engineStatus"][number]["status"] }) {
  if (status === "active") {
    return (
      <span className="inline-flex rounded-full bg-emerald-500/12 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
        Active
      </span>
    );
  }
  if (status === "revoked") {
    return (
      <span className="inline-flex rounded-full bg-red-500/12 px-2 py-0.5 text-xs font-medium text-red-700 dark:text-red-300">
        Revoked
      </span>
    );
  }
  return (
    <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
      Not configured
    </span>
  );
}

function QuickAction({
  to,
  icon: Icon,
  label,
}: {
  to: "/admin/tools" | "/admin/customers" | "/admin/orders" | "/admin/settings/custom-payments";
  icon: LucideIcon;
  label: string;
}) {
  return (
    <Link
      to={to}
      className="flex items-center gap-3 rounded-lg border bg-background px-3 py-2.5 text-sm font-medium transition-colors hover:bg-muted"
    >
      <Icon className="h-4 w-4 text-primary" />
      <span>{label}</span>
    </Link>
  );
}

function formatShortDate(iso: string) {
  const date = new Date(`${iso}T00:00:00Z`);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

function toolName(slug: Overview["engineStatus"][number]["tool_slug"]) {
  if (slug === "stealthwriter") return "StealthWriter";
  if (slug === "phrasly") return "Phrasly";
  return "ChatGPT";
}
