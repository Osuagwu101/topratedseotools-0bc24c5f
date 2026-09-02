import { createFileRoute, redirect } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAdminOrRedirect } from "@/lib/admin-gate";
import { getMyAdminContext } from "@/lib/admin-permissions.functions";
import { getSystemHealth } from "@/lib/system-ops.functions";

const healthQuery = queryOptions({
  queryKey: ["system-health"],
  queryFn: () => getSystemHealth(),
  refetchInterval: 60_000,
});

export const Route = createFileRoute("/admin/settings/system-health")({
  ssr: false,
  head: () => ({
    meta: [{ title: "System Health & Repair — Admin" }, { name: "robots", content: "noindex" }],
  }),
  beforeLoad: async () => {
    await requireAdminOrRedirect();
    const ctx = await getMyAdminContext();
    if (!ctx.isSuperAdmin && !ctx.permissions.includes("system_health.access")) {
      throw redirect({ to: "/admin/dashboard" });
    }
  },
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(healthQuery);
  },
  component: HealthPage,
});

function StatusIcon({ status }: { status: "ok" | "warn" | "fail" }) {
  if (status === "ok") return <CheckCircle2 className="h-5 w-5 text-emerald-600" />;
  if (status === "warn") return <AlertTriangle className="h-5 w-5 text-amber-600" />;
  return <XCircle className="h-5 w-5 text-destructive" />;
}

function HealthPage() {
  const { data } = useSuspenseQuery(healthQuery);
  return (
    <AdminShell>
      <section className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">System Health</h1>
          <p className="text-sm text-muted-foreground">
            Live status of the services this site depends on. Refreshes every minute.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <StatCard label="OK" count={data.summary.ok} className="text-emerald-600" />
          <StatCard label="Warnings" count={data.summary.warn} className="text-amber-600" />
          <StatCard label="Failures" count={data.summary.fail} className="text-destructive" />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Checks</CardTitle>
            <CardDescription>
              Generated {new Date(data.generatedAt).toLocaleString()}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {data.checks.map((c) => (
                <li key={c.key} className="flex items-start gap-3 py-3">
                  <StatusIcon status={c.status} />
                  <div className="flex-1">
                    <div className="font-medium">{c.label}</div>
                    <div className="text-sm text-muted-foreground">{c.detail}</div>
                    {c.fix && <div className="mt-1 text-xs text-amber-700">Action: {c.fix}</div>}
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </section>
    </AdminShell>
  );
}

function StatCard({
  label,
  count,
  className,
}: {
  label: string;
  count: number;
  className?: string;
}) {
  return (
    <div className="rounded-2xl border bg-card p-3 shadow-card">
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className={`text-2xl font-semibold ${className ?? ""}`}>{count}</div>
    </div>
  );
}
