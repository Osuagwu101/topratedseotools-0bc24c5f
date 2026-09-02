/**
 * Admin dashboard — focused day-to-day operating view.
 *
 * The analytics backend remains unchanged. This page intentionally surfaces
 * only the figures and actions an admin needs most often.
 */
import { AdminShell } from "@/components/admin/AdminShell";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  ClipboardList,
  CreditCard,
  History,
  PackageCheck,
  Settings2,
  UserCheck,
  Users,
  Wallet,
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
  beforeLoad: async () => {
    await requireAdminOrRedirect();
  },
  component: AdminDashboardPage,
});

function money(n: number) {
  return "₦" + Math.round(n).toLocaleString();
}

function AdminDashboardPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-overview", 30],
    queryFn: () => getAdminOverview({ data: { trendDays: 30 } }),
  });

  return (
    <AdminShell>
      <section className="mx-auto max-w-6xl px-4 py-7 sm:px-6 lg:px-8">
        <header className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            A quick view of customers, payments and work that needs attention.
          </p>
        </header>

        {error && (
          <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {(error as Error).message}
          </div>
        )}

        {isLoading || !data ? (
          <div className="rounded-xl border bg-card p-10 text-center text-sm text-muted-foreground">
            Loading dashboard…
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

  const attentionItems = [
    {
      label: "Awaiting assignment",
      detail: "Private orders that still need fulfilment",
      count: a.privatePending,
      to: "/admin/awaiting-assignments" as const,
    },
    {
      label: "Failed payments",
      detail: "Payments that did not complete successfully",
      count: r.failedPayments,
      to: "/admin/transactions" as const,
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
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Revenue this month" value={money(r.thisMonth)} icon={Wallet} />
        <StatCard label="Customers" value={c.totalUsers} icon={Users} />
        <StatCard label="Active subscribers" value={c.activeSubscribers} icon={UserCheck} />
        <StatCard label="Pending orders" value={c.pendingOrders} icon={ClipboardList} />
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-[1.35fr_0.65fr]">
        <section className="rounded-xl border bg-card shadow-card">
          <div className="flex items-center gap-2 border-b px-4 py-3.5">
            <AlertTriangle className="h-4 w-4 text-warning" />
            <div>
              <h2 className="text-sm font-semibold">Needs attention</h2>
              <p className="text-xs text-muted-foreground">
                Only items that require action are shown here.
              </p>
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
            <QuickAction
              to="/admin/settings/custom-payments"
              icon={CreditCard}
              label="Create custom payment"
            />
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
          {data.recentActivity.slice(0, 6).map((event) => (
            <div
              key={event.id}
              className="flex items-start justify-between gap-4 px-4 py-3 text-sm"
            >
              <div className="min-w-0">
                <div className="font-medium">{event.label}</div>
                {event.detail && (
                  <div className="truncate text-xs text-muted-foreground">{event.detail}</div>
                )}
              </div>
              <div className="shrink-0 text-[11px] text-muted-foreground">
                {new Date(event.at).toLocaleString()}
              </div>
            </div>
          ))}
          {data.recentActivity.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              No recent activity.
            </div>
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
}: {
  label: string;
  value: string | number;
  icon: LucideIcon;
}) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-card">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight">{value}</div>
    </div>
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
