/**
 * /admin/access-health — cross-tool health center.
 *
 * Lists every account across every tool with utilisation, health, and
 * expiry flags. Highlights: full pools, needs-review, unhealthy status,
 * and expiring credentials.
 */
import { requireAdminOrRedirect } from "@/lib/admin-gate";
import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { adminListAllAccounts } from "@/lib/account-pool.functions";
import { AlertTriangle, Activity, ShieldCheck, Users2 } from "lucide-react";

const allAccountsQuery = queryOptions({
  queryKey: ["all-accounts"],
  queryFn: () => adminListAllAccounts(),
});

export const Route = createFileRoute("/admin/access-health")({
  ssr: false,
  beforeLoad: async () => { await requireAdminOrRedirect(); },
  head: () => ({
    meta: [
      { title: "Access Health — Admin" },
      { name: "robots", content: "noindex" },
    ],
  }),
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(allAccountsQuery);
  },
  component: AccessHealthPage,
});

function AccessHealthPage() {
  const { data } = useSuspenseQuery(allAccountsQuery);
  const [filter, setFilter] = useState<"all" | "full" | "review" | "unhealthy" | "expiring">("all");

  const now = Date.now();
  const soon = now + 7 * 86400_000;

  const flagged = useMemo(() => {
    return data.accounts.map((a) => {
      const expIso = a.expires_at;
      const expTs = expIso ? new Date(expIso).getTime() : null;
      const expiring = expTs !== null && expTs > now && expTs < soon;
      const full = a.available <= 0;
      const unhealthy = a.status !== "working";
      const review = a.needs_capacity_review;
      return { ...a, _flags: { full, review, unhealthy, expiring, expired: expTs !== null && expTs <= now } };
    });
  }, [data.accounts, now, soon]);

  const shown = flagged.filter((a) => {
    if (filter === "all") return true;
    if (filter === "full") return a._flags.full;
    if (filter === "review") return a._flags.review;
    if (filter === "unhealthy") return a._flags.unhealthy;
    if (filter === "expiring") return a._flags.expiring || a._flags.expired;
    return true;
  });

  const stats = {
    total: flagged.length,
    full: flagged.filter((a) => a._flags.full).length,
    review: flagged.filter((a) => a._flags.review).length,
    unhealthy: flagged.filter((a) => a._flags.unhealthy).length,
    expiring: flagged.filter((a) => a._flags.expiring || a._flags.expired).length,
  };

  return (
    <AdminShell>
      <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-semibold tracking-tight">Access Health</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Cross-tool account pool status. Fix full pools, review flagged capacities, and rotate unhealthy accounts.
        </p>

        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Kpi label="Accounts" value={stats.total} icon={ShieldCheck} tone="default" onClick={() => setFilter("all")} active={filter === "all"} />
          <Kpi label="Full pools" value={stats.full} icon={Users2} tone="destructive" onClick={() => setFilter("full")} active={filter === "full"} />
          <Kpi label="Needs review" value={stats.review} icon={AlertTriangle} tone="warning" onClick={() => setFilter("review")} active={filter === "review"} />
          <Kpi label="Unhealthy" value={stats.unhealthy} icon={Activity} tone="destructive" onClick={() => setFilter("unhealthy")} active={filter === "unhealthy"} />
          <Kpi label="Expiring 7d" value={stats.expiring} icon={AlertTriangle} tone="warning" onClick={() => setFilter("expiring")} active={filter === "expiring"} />
        </div>

        <div className="mt-6 overflow-hidden rounded-2xl border bg-card shadow-card">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Tool</th>
                <th className="px-3 py-2 text-left">Label</th>
                <th className="px-3 py-2 text-left">Type</th>
                <th className="px-3 py-2 text-left">Usage</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Expires</th>
                <th className="px-3 py-2 text-left">Flags</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((a) => (
                <tr key={a.id} className="border-b last:border-0">
                  <td className="px-3 py-2 font-medium">{a.tool_slug}</td>
                  <td className="px-3 py-2">{a.label}</td>
                  <td className="px-3 py-2 capitalize">{a.access_type}</td>
                  <td className="px-3 py-2">
                    {a.active_count}/{a.max_capacity}
                    <div className="mt-1 h-1 w-24 rounded-full bg-muted">
                      <div
                        className={`h-full rounded-full ${a.fill_pct >= 100 ? "bg-destructive" : a.fill_pct >= 80 ? "bg-amber-500" : "bg-primary"}`}
                        style={{ width: `${Math.min(100, a.fill_pct)}%` }}
                      />
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <span className={a.status === "working" ? "text-success" : "text-destructive"}>
                      {a.status.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {a.expires_at ? new Date(a.expires_at).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {a._flags.full && <Chip color="destructive">Full</Chip>}
                      {a._flags.review && <Chip color="warning">Review</Chip>}
                      {a._flags.unhealthy && <Chip color="destructive">Unhealthy</Chip>}
                      {a._flags.expiring && <Chip color="warning">Expiring</Chip>}
                      {a._flags.expired && <Chip color="destructive">Expired</Chip>}
                      {!a.enabled && <Chip color="muted">Disabled</Chip>}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Link
                      to="/admin/tools/$slug"
                      params={{ slug: a.tool_slug }}
                      className="text-xs text-primary hover:underline"
                    >
                      Manage →
                    </Link>
                  </td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-sm text-muted-foreground">
                    Nothing to show for this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </AdminShell>
  );
}

function Kpi({
  label, value, icon: Icon, tone, onClick, active,
}: {
  label: string; value: number; icon: any; tone: "default" | "warning" | "destructive"; onClick: () => void; active?: boolean;
}) {
  const toneCls =
    tone === "destructive" ? "text-destructive" : tone === "warning" ? "text-amber-600" : "text-primary";
  return (
    <button
      onClick={onClick}
      className={`rounded-xl border p-3 text-left transition ${active ? "border-primary bg-primary/5" : "hover:bg-muted"}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase text-muted-foreground">{label}</span>
        <Icon className={`h-3.5 w-3.5 ${toneCls}`} />
      </div>
      <div className={`mt-1 text-xl font-semibold ${toneCls}`}>{value}</div>
    </button>
  );
}

function Chip({ color, children }: { color: "destructive" | "warning" | "muted"; children: React.ReactNode }) {
  const cls =
    color === "destructive"
      ? "bg-destructive/10 text-destructive"
      : color === "warning"
        ? "bg-amber-500/15 text-amber-600"
        : "bg-muted text-muted-foreground";
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${cls}`}>{children}</span>;
}
