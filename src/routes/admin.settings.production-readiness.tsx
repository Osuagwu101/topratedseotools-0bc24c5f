import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAdminOrRedirect } from "@/lib/admin-gate";
import { getMyAdminContext } from "@/lib/admin-permissions.functions";
import {
  getSystemHealth,
  getMigrationChecklist,
  getEmergencyControls,
  listBackupHistory,
} from "@/lib/system-ops.functions";

const readinessQuery = queryOptions({
  queryKey: ["production-readiness"],
  queryFn: async () => {
    const [health, migration, emergency, backups] = await Promise.all([
      getSystemHealth(),
      getMigrationChecklist(),
      getEmergencyControls(),
      listBackupHistory(),
    ]);
    return { health, migration, emergency, backups };
  },
});

export const Route = createFileRoute("/admin/settings/production-readiness")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Production Readiness — Admin" }, { name: "robots", content: "noindex" }],
  }),
  beforeLoad: async () => {
    await requireAdminOrRedirect();
    const ctx = await getMyAdminContext();
    if (!ctx.isSuperAdmin && !ctx.permissions.includes("system_health.access")) {
      throw redirect({ to: "/admin/dashboard" });
    }
  },
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(readinessQuery);
  },
  component: ReadinessPage,
});

type Status = "ok" | "warn" | "fail";

function Row({
  status,
  label,
  detail,
  action,
}: {
  status: Status;
  label: string;
  detail: string;
  action?: React.ReactNode;
}) {
  const Icon = status === "ok" ? CheckCircle2 : status === "warn" ? AlertTriangle : XCircle;
  const color =
    status === "ok"
      ? "text-emerald-600"
      : status === "warn"
        ? "text-amber-600"
        : "text-destructive";
  return (
    <li className="flex items-start gap-3 py-3">
      <Icon className={`h-5 w-5 ${color}`} />
      <div className="flex-1">
        <div className="font-medium">{label}</div>
        <div className="text-sm text-muted-foreground">{detail}</div>
        {action && <div className="mt-1 text-xs">{action}</div>}
      </div>
    </li>
  );
}

function ReadinessPage() {
  const { data } = useSuspenseQuery(readinessQuery);
  const findCheck = (key: string) => data.health.checks.find((c) => c.key === key);

  const db = findCheck("database");
  const payments = findCheck("payments");
  const email = findCheck("email");
  const storage = findCheck("storage");

  const backupsOk = data.backups.rows.length > 0;
  const migrationChecks = data.migration.checks;
  const migrationFails = migrationChecks.filter((c) => c.status === "fail").length;
  const migrationWarns = migrationChecks.filter((c) => c.status === "warn").length;

  const emergencyTested = data.emergency.updated_at !== null;

  const items: { status: Status; label: string; detail: string; action?: React.ReactNode }[] = [
    {
      status: (db?.status as Status) ?? "fail",
      label: "Database connected",
      detail: db?.detail ?? "—",
    },
    {
      status: (payments?.status as Status) ?? "fail",
      label: "Payments configured",
      detail: payments?.detail ?? "—",
      action: (
        <Link className="underline" to="/admin/settings/api-keys">
          Manage API keys
        </Link>
      ),
    },
    {
      status: (email?.status as Status) ?? "fail",
      label: "Email provider configured",
      detail: email?.detail ?? "—",
      action: (
        <Link className="underline" to="/admin/settings/email">
          Email settings
        </Link>
      ),
    },
    {
      status: (storage?.status as Status) ?? "warn",
      label: "Storage configured",
      detail: storage?.detail ?? "—",
    },
    {
      status: backupsOk ? "ok" : "warn",
      label: "Backup available",
      detail: backupsOk
        ? `${data.backups.rows.length} backup entr${data.backups.rows.length === 1 ? "y" : "ies"} recorded.`
        : "No backup has been taken yet.",
      action: (
        <Link className="underline" to="/admin/settings/backup">
          Create backup
        </Link>
      ),
    },
    {
      status: "ok",
      label: "Admin accounts verified",
      detail: "Super-admin + staff roles enforced. Admins are separate from customers.",
      action: (
        <Link className="underline" to="/admin/settings/staff">
          Review staff
        </Link>
      ),
    },
    {
      status: emergencyTested ? "ok" : "warn",
      label: "Emergency controls tested",
      detail: emergencyTested
        ? `Last change ${new Date(data.emergency.updated_at!).toLocaleString()}.`
        : "No emergency control has been toggled yet.",
      action: (
        <Link className="underline" to="/admin/settings/emergency">
          Open controls
        </Link>
      ),
    },
    {
      status: migrationFails > 0 ? "fail" : migrationWarns > 0 ? "warn" : "ok",
      label: "Migration checklist",
      detail: `${migrationChecks.length - migrationFails - migrationWarns} passing · ${migrationWarns} warning · ${migrationFails} failing`,
      action: (
        <Link className="underline" to="/admin/settings/migration">
          Open checklist
        </Link>
      ),
    },
  ];

  const anyFail = items.some((i) => i.status === "fail");
  const anyWarn = items.some((i) => i.status === "warn");
  const overall = anyFail ? "Not ready" : anyWarn ? "Ready with warnings" : "Production ready";
  const overallColor = anyFail
    ? "text-destructive"
    : anyWarn
      ? "text-amber-600"
      : "text-emerald-600";

  return (
    <AdminShell>
      <section className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Production Readiness</h1>
          <p className="text-sm text-muted-foreground">
            One-page overview of everything required to run the platform in production.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>
              Overall status: <span className={overallColor}>{overall}</span>
            </CardTitle>
            <CardDescription>
              Green means live-ready. Amber = launch possible but attention needed. Red = fix before
              going live.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {items.map((i) => (
                <Row key={i.label} {...i} />
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Next steps</CardTitle>
            <CardDescription>Read this before handing over or migrating hosting.</CardDescription>
          </CardHeader>
          <CardContent className="text-sm space-y-2">
            <Link
              to="/admin/settings/migration-guide"
              className="block rounded-md border px-3 py-2 hover:bg-muted"
            >
              Open the Migration Guide →
            </Link>
            <Link
              to="/admin/settings/system-health"
              className="block rounded-md border px-3 py-2 hover:bg-muted"
            >
              System Health dashboard →
            </Link>
            <Link
              to="/admin/settings/backup"
              className="block rounded-md border px-3 py-2 hover:bg-muted"
            >
              Backup & Recovery →
            </Link>
          </CardContent>
        </Card>
      </section>
    </AdminShell>
  );
}
