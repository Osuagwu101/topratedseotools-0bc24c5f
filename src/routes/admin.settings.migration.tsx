import { createFileRoute, redirect } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAdminOrRedirect } from "@/lib/admin-gate";
import { getMyAdminContext } from "@/lib/admin-permissions.functions";
import { getMigrationChecklist } from "@/lib/system-ops.functions";

const checklistQuery = queryOptions({
  queryKey: ["migration-checklist"],
  queryFn: () => getMigrationChecklist(),
});

export const Route = createFileRoute("/admin/settings/migration")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Migration & Launch — Admin" }, { name: "robots", content: "noindex" }],
  }),
  beforeLoad: async () => {
    await requireAdminOrRedirect();
    const ctx = await getMyAdminContext();
    if (!ctx.isSuperAdmin && !ctx.permissions.includes("migration.access")) {
      throw redirect({ to: "/admin/dashboard" });
    }
  },
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(checklistQuery);
  },
  component: MigrationPage,
});

function StatusIcon({ status }: { status: "ok" | "warn" | "fail" }) {
  if (status === "ok") return <CheckCircle2 className="h-5 w-5 text-emerald-600" />;
  if (status === "warn") return <AlertTriangle className="h-5 w-5 text-amber-600" />;
  return <XCircle className="h-5 w-5 text-destructive" />;
}

function MigrationPage() {
  const { data } = useSuspenseQuery(checklistQuery);
  return (
    <AdminShell>
      <section className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Migration Centre</h1>
          <p className="text-sm text-muted-foreground">
            Everything you need in place before moving hosting providers. Anything with a warning or
            failure below needs attention.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Readiness checklist</CardTitle>
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
