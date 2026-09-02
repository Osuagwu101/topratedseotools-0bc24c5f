import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { AdminShell } from "@/components/admin/AdminShell";
import { getSettingsOverview } from "@/lib/admin-overview.functions";
import { AlertTriangle, Activity, Zap, ListChecks } from "lucide-react";

const overviewQuery = queryOptions({
  queryKey: ["admin-settings-overview"],
  queryFn: () => getSettingsOverview(),
});

export const Route = createFileRoute("/admin/settings/")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Settings Overview — Admin" }, { name: "robots", content: "noindex" }],
  }),
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(overviewQuery);
  },
  component: SettingsOverviewPage,
});

function SettingsOverviewPage() {
  const { data } = useSuspenseQuery(overviewQuery);
  return (
    <AdminShell>
      <section className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Settings Overview</h1>
          <p className="text-sm text-muted-foreground">
            Everything you need to run and monitor the platform.
          </p>
        </div>

        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2">
          <Card icon={<AlertTriangle className="h-4 w-4" />} title="Requires Attention">
            {data.attention.length === 0 ? (
              <p className="text-sm text-muted-foreground">All clear.</p>
            ) : (
              <ul className="divide-y">
                {data.attention.map((item) => (
                  <li
                    key={item.id}
                    className="flex items-center justify-between gap-3 py-2 text-sm"
                  >
                    <Link to={item.href} className="min-w-0 truncate hover:underline">
                      {item.label}
                    </Link>
                    <span className="shrink-0 rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-semibold text-destructive">
                      {item.count}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card icon={<Zap className="h-4 w-4" />} title="Quick Actions">
            <div className="grid gap-2 text-sm">
              <Link
                to="/admin/settings/custom-payments"
                className="truncate rounded-md border px-3 py-2 hover:bg-muted"
              >
                Create a Custom Payment link
              </Link>
              <Link
                to="/admin/settings/browser-auth"
                className="truncate rounded-md border px-3 py-2 hover:bg-muted"
              >
                Configure One-Click Browser Login
              </Link>
              <Link
                to="/admin/settings/staff"
                className="truncate rounded-md border px-3 py-2 hover:bg-muted"
              >
                Manage staff, roles &amp; permissions
              </Link>
              <Link
                to="/admin/access-health"
                className="truncate rounded-md border px-3 py-2 hover:bg-muted"
              >
                Check access health
              </Link>
              <Link
                to="/admin/settings/activity"
                className="truncate rounded-md border px-3 py-2 hover:bg-muted"
              >
                View admin activity
              </Link>
              <Link
                to="/admin/settings/analytics"
                className="truncate rounded-md border px-3 py-2 hover:bg-muted"
              >
                Business analytics
              </Link>
            </div>
          </Card>

          <Card icon={<Activity className="h-4 w-4" />} title="Recent Admin Activity">
            {data.recentActivity.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No recent activity visible to your role.
              </p>
            ) : (
              <ul className="divide-y text-sm">
                {data.recentActivity.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 py-2">
                    <span className="min-w-0 truncate">
                      <span className="font-medium">{r.action}</span>
                      {r.actorEmail && (
                        <span className="text-muted-foreground"> · {r.actorEmail}</span>
                      )}
                    </span>
                    <span
                      className={`shrink-0 text-xs ${r.success ? "text-emerald-600" : "text-destructive"}`}
                    >
                      {r.success ? "ok" : "failed"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card icon={<ListChecks className="h-4 w-4" />} title="Phase Progress">
            <ul className="divide-y text-sm">
              {data.phaseProgress.map((p) => (
                <li key={p.phase} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0 truncate">
                    Phase {p.phase} — {p.name}
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${p.status === "Active" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}
                  >
                    {p.status}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </section>
    </AdminShell>
  );
}

function Card({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-2xl border bg-card p-5 shadow-card">
      <div className="mb-3 inline-flex items-center gap-2 text-sm font-semibold">
        {icon} {title}
      </div>
      {children}
    </div>
  );
}
