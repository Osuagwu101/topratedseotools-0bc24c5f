/**
 * Admin — platform-wide dashboard.
 *
 * Every card, chart, and list represents the ENTIRE platform, computed by
 * getAdminOverview (service-role query gated by has_role('admin')). Never
 * scoped to the logged-in admin's own customer account.
 */
import { AdminShell } from "@/components/admin/AdminShell";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Users,
  UserCheck,
  History,
  Layers,
  Wallet,
  Clock,
  Timer,
  XCircle,
  AlertTriangle,
  TrendingUp,
  BarChart3,
  ShieldCheck,
} from "lucide-react";
import { getAdminOverview } from "@/lib/admin-analytics.functions";
import { requireAdminOrRedirect } from "@/lib/admin-gate";

export const Route = createFileRoute("/admin/dashboard")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Admin dashboard — Top Rated SEO Tools" },
      { name: "robots", content: "noindex" },
    ],
  }),
  beforeLoad: async () => { await requireAdminOrRedirect(); },
  component: AdminDashboardPage,
});

const RANGE_OPTS: { label: string; days: number }[] = [
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
  { label: "This year", days: 365 },
];

function money(n: number) {
  return "₦" + Math.round(n).toLocaleString();
}

function AdminDashboardPage() {
  const [trendDays, setTrendDays] = useState(30);
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-overview", trendDays],
    queryFn: () => getAdminOverview({ data: { trendDays } }),
  });

  return (
    <AdminShell>
      <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-6 flex flex-wrap items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-primary text-primary-foreground shadow-glow">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-semibold tracking-tight">Platform dashboard</h1>
            <p className="text-sm text-muted-foreground">
              Live figures across every customer, order and payment.
            </p>
          </div>
          <div className="flex gap-1 rounded-md border p-1">
            {RANGE_OPTS.map((o) => (
              <button
                key={o.days}
                onClick={() => setTrendDays(o.days)}
                className={`rounded px-2.5 py-1 text-xs font-medium ${
                  trendDays === o.days ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </header>

        {error && (
          <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {(error as Error).message}
          </div>
        )}
        {isLoading || !data ? (
          <div className="rounded-2xl border bg-card p-10 text-center text-sm text-muted-foreground">
            Loading platform analytics…
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
  const r = data.revenue;
  const a = data.attention;

  const row1 = [
    { label: "Total users", value: c.totalUsers, icon: Users, tone: "text-primary" },
    { label: "Active subscribers", value: c.activeSubscribers, icon: UserCheck, tone: "text-success" },
    { label: "All-time subscribers", value: c.allTimeSubscribers, icon: History, tone: "text-primary" },
    { label: "Active subscriptions", value: c.activeSubscriptions, icon: Layers, tone: "text-success" },
  ];
  const row2 = [
    { label: "Revenue this month", value: money(r.thisMonth), icon: Wallet, tone: "text-success" },
    { label: "Pending orders", value: c.pendingOrders, icon: Clock, tone: "text-warning" },
    { label: "Pending private fulfilment", value: c.pendingPrivateFulfilment, icon: Timer, tone: "text-warning" },
    { label: "Cancelled / expired", value: c.cancelledExpiredOrders, icon: XCircle, tone: "text-destructive" },
  ];

  const revenueBreakdown = [
    { label: "Today", value: r.today },
    { label: "This month", value: r.thisMonth },
    { label: "This year", value: r.thisYear },
    { label: "All time", value: r.allTime },
    { label: "Recurring", value: r.recurring },
    { label: "One-time", value: r.oneTime },
    { label: "Online (Paystack)", value: r.online },
    { label: "Offline (manual)", value: r.offline },
  ];

  const trendData = data.trend.days.map((d, i) => ({
    date: d.slice(5),
    registrations: data.trend.registrations[i],
    newSubscribers: data.trend.newSubscribers[i],
    revenueTotal: data.trend.revenueTotal[i],
    revenueRecurring: data.trend.revenueRecurring[i],
    revenueOneTime: data.trend.revenueOneTime[i],
  }));

  const accessPie = [
    { name: "Shared", value: data.breakdown.accessType.shared },
    { name: "Private", value: data.breakdown.accessType.private },
  ];
  const periodPie = [
    { name: "Monthly", value: data.breakdown.billingPeriod.monthly },
    { name: "Quarterly", value: data.breakdown.billingPeriod.quarterly },
    { name: "Yearly", value: data.breakdown.billingPeriod.yearly },
  ];
  const modelPie = [
    { name: "Recurring", value: data.breakdown.paymentModel.recurring },
    { name: "One-time", value: data.breakdown.paymentModel.oneTime },
  ];
  const PIE_COLORS = ["hsl(var(--primary))", "hsl(var(--warning))", "hsl(var(--success))"];

  const attentionItems: { label: string; count: number; to: string }[] = [
    { label: "Private orders pending fulfilment", count: a.privatePending, to: "/admin/orders" },
    { label: "Near 6-hour fulfilment deadline", count: a.privateNearDeadline, to: "/admin/orders" },
    { label: "Failed renewals", count: a.failedRenewals, to: "/admin/orders" },
    { label: "Payments requiring reconciliation", count: a.reconciliation, to: "/admin/orders" },
    { label: "Subscriptions expiring within 7 days", count: a.expiringSoon, to: "/admin/orders" },
    { label: "Cancelled orders", count: a.cancelledOrders, to: "/admin/orders" },
    { label: "Customers who disabled renewal", count: a.renewalDisabled, to: "/admin/orders" },
  ];

  return (
  const newCustomers = data.trend.registrations.reduce((s, n) => s + n, 0);
  const bestTool = data.topTools[0];

  return (
    <>
      {/* Phase 6 — Quick summary */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Revenue this month" value={money(r.thisMonth)} icon={Wallet} tone="text-success" />
        <StatCard label={`New customers (${data.trend.days.length}d)`} value={newCustomers} icon={Users} tone="text-primary" />
        <StatCard label="Failed payments" value={r.failedPayments} icon={XCircle} tone={r.failedPayments > 0 ? "text-destructive" : "text-muted-foreground"} />
        <StatCard label="Expiring ≤7d" value={a.expiringSoon} icon={Timer} tone={a.expiringSoon > 0 ? "text-warning" : "text-muted-foreground"} />
        <StatCard label="Best tool" value={bestTool ? bestTool.tool_slug : "—"} icon={TrendingUp} tone="text-primary" />
      </div>

      {/* Row 1 */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {row1.map((s) => <StatCard key={s.label} {...s} />)}
      </div>
      {/* Row 2 */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {row2.map((s) => <StatCard key={s.label} {...s} />)}
      </div>

      {/* Revenue snapshot */}
      <div className="mt-5 rounded-xl border bg-card p-4 shadow-card">
        <div className="flex items-center gap-2">
          <Wallet className="h-4 w-4 text-success" />
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Revenue (successful payments only)
          </h2>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {revenueBreakdown.map((s) => (
            <div key={s.label} className="rounded-lg border bg-background px-2.5 py-2">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{s.label}</div>
              <div className="mt-0.5 text-base font-semibold leading-tight">{money(s.value)}</div>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
          <span>Successful: <strong className="text-success">{r.successfulPayments}</strong></span>
          <span>Failed: <strong className="text-destructive">{r.failedPayments}</strong></span>
          <span>Refunds / reversed: <strong>{r.refunds}</strong></span>
        </div>
      </div>

      {/* Charts */}
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <ChartCard title="Users & subscribers trend" icon={TrendingUp}>
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="date" fontSize={11} />
              <YAxis fontSize={11} allowDecimals={false} />
              <Tooltip />
              <Legend />
              <Area type="monotone" dataKey="registrations" name="New registrations" stroke="hsl(var(--primary))" fill="hsl(var(--primary) / 0.2)" />
              <Area type="monotone" dataKey="newSubscribers" name="New subscribers" stroke="hsl(var(--success))" fill="hsl(var(--success) / 0.2)" />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Revenue trend" icon={BarChart3}>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="date" fontSize={11} />
              <YAxis fontSize={11} />
              <Tooltip formatter={(v: number) => money(v)} />
              <Legend />
              <Bar dataKey="revenueRecurring" name="Recurring" stackId="a" fill="hsl(var(--primary))" />
              <Bar dataKey="revenueOneTime" name="One-time" stackId="a" fill="hsl(var(--success))" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Lower area */}
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <ChartCard title="Most purchased tools" icon={Layers}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="py-1.5">Tool</th>
                  <th className="text-right">Purchases</th>
                  <th className="text-right">Active</th>
                  <th className="text-right">Revenue</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.topTools.map((t) => (
                  <tr key={t.tool_slug}>
                    <td className="py-1.5 font-medium">{t.tool_slug}</td>
                    <td className="text-right">{t.purchases}</td>
                    <td className="text-right">{t.active}</td>
                    <td className="text-right">{money(t.revenue)}</td>
                  </tr>
                ))}
                {data.topTools.length === 0 && (
                  <tr><td colSpan={4} className="py-4 text-center text-muted-foreground">No purchases yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </ChartCard>

        <ChartCard title="Subscription breakdown" icon={BarChart3}>
          <div className="grid gap-2 sm:grid-cols-3">
            <MiniPie title="Access" data={accessPie} colors={PIE_COLORS} />
            <MiniPie title="Billing" data={periodPie} colors={PIE_COLORS} />
            <MiniPie title="Model" data={modelPie} colors={PIE_COLORS} />
          </div>
        </ChartCard>
      </div>

      {/* Requires attention + Recent activity */}
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border bg-card shadow-card">
          <div className="flex items-center gap-2 border-b p-4">
            <AlertTriangle className="h-4 w-4 text-warning" />
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Requires attention</h2>
          </div>
          <ul className="divide-y">
            {attentionItems.map((i) => (
              <li key={i.label} className="flex items-center gap-3 p-3 text-sm">
                <span className="flex-1">{i.label}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${i.count > 0 ? "bg-warning/15 text-warning" : "bg-muted text-muted-foreground"}`}>
                  {i.count}
                </span>
                <Link to={i.to} className="text-xs font-semibold text-primary hover:underline">View</Link>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-2xl border bg-card shadow-card">
          <div className="flex items-center gap-2 border-b p-4">
            <History className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Recent activity</h2>
          </div>
          <ul className="divide-y max-h-[400px] overflow-y-auto">
            {data.recentActivity.map((e) => (
              <li key={e.id} className="p-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium">{e.label}</div>
                    <div className="truncate text-xs text-muted-foreground">{e.detail ?? "—"}</div>
                  </div>
                  <div className="text-[11px] text-muted-foreground whitespace-nowrap">
                    {new Date(e.at).toLocaleString()}
                  </div>
                </div>
              </li>
            ))}
            {data.recentActivity.length === 0 && (
              <li className="p-6 text-center text-sm text-muted-foreground">No recent activity.</li>
            )}
          </ul>
        </div>
      </div>
    </>
  );
}

function StatCard({ label, value, icon: Icon, tone }: {
  label: string; value: number | string; icon: typeof Users; tone: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-3 shadow-card">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
        <Icon className={`h-3.5 w-3.5 shrink-0 ${tone}`} />
      </div>
      <div className="mt-1.5 text-xl font-semibold leading-tight">{value}</div>
    </div>
  );
}

function ChartCard({ title, icon: Icon, children }: {
  title: string; icon: typeof Users; children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border bg-card p-4 shadow-card">
      <div className="mb-3 flex items-center gap-2">
        <Icon className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function MiniPie({ title, data, colors }: {
  title: string; data: { name: string; value: number }[]; colors: string[];
}) {
  const total = data.reduce((a, b) => a + b.value, 0);
  return (
    <div className="rounded-xl border bg-background p-3">
      <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">{title}</div>
      {total === 0 ? (
        <div className="py-6 text-center text-xs text-muted-foreground">No data</div>
      ) : (
        <ResponsiveContainer width="100%" height={140}>
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius={30} outerRadius={55}>
              {data.map((_, i) => <Cell key={i} fill={colors[i % colors.length]} />)}
            </Pie>
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 11 }} />
          </PieChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
