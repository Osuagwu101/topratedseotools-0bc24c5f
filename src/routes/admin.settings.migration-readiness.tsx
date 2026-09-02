import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAdminOrRedirect } from "@/lib/admin-gate";
import { getMyAdminContext } from "@/lib/admin-permissions.functions";
import { getMigrationReadiness } from "@/lib/system-ops.functions";

const readinessQuery = queryOptions({
  queryKey: ["migration-readiness"],
  queryFn: () => getMigrationReadiness(),
});

export const Route = createFileRoute("/admin/settings/migration-readiness")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Migration Readiness — Admin" },
      {
        name: "description",
        content:
          "Consolidated migration readiness checklist covering environment variables, integrations, database, cron and webhooks.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  beforeLoad: async () => {
    await requireAdminOrRedirect();
    const ctx = await getMyAdminContext();
    if (!ctx.isSuperAdmin && !ctx.permissions.includes("migration.access")) {
      throw redirect({ to: "/admin/dashboard" });
    }
  },
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(readinessQuery);
  },
  component: ReadinessPage,
});

function StatusIcon({ status }: { status: "ok" | "warn" | "fail" }) {
  if (status === "ok") return <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />;
  if (status === "warn") return <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />;
  return <XCircle className="h-5 w-5 text-destructive shrink-0" />;
}

function ReadinessPage() {
  const { data } = useSuspenseQuery(readinessQuery);
  const { ok, warn, fail } = data.summary;
  const overall = fail > 0 ? "Not ready" : warn > 0 ? "Ready with warnings" : "Migration ready";
  const overallColor =
    fail > 0 ? "text-destructive" : warn > 0 ? "text-amber-600" : "text-emerald-600";

  return (
    <AdminShell>
      <section className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Migration Readiness Centre</h1>
          <p className="text-sm text-muted-foreground">
            Everything a new hosting provider needs before switching over. Secret values are never
            shown — only whether each item is configured.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>
              Overall: <span className={overallColor}>{overall}</span>
            </CardTitle>
            <CardDescription>
              {ok} passing · {warn} warning · {fail} failing · Generated{" "}
              {new Date(data.generatedAt).toLocaleString()}
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm space-y-1">
            <div>Companion pages:</div>
            <ul className="list-disc pl-5">
              <li>
                <Link className="underline" to="/admin/settings/migration-guide">
                  Migration Guide
                </Link>{" "}
                — full text runbook for the new host.
              </li>
              <li>
                <Link className="underline" to="/admin/settings/backup">
                  Backup &amp; Recovery
                </Link>{" "}
                — take a snapshot before migrating.
              </li>
              <li>
                <Link className="underline" to="/admin/settings/system-health">
                  System Health
                </Link>{" "}
                — live probes.
              </li>
            </ul>
          </CardContent>
        </Card>

        {data.sections.map((section) => (
          <Card key={section.key}>
            <CardHeader>
              <CardTitle>{section.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y">
                {section.items.map((item) => (
                  <li key={item.label} className="flex items-start gap-3 py-3">
                    <StatusIcon status={item.status} />
                    <div className="flex-1">
                      <div className="font-medium">{item.label}</div>
                      <div className="text-sm text-muted-foreground">{item.detail}</div>
                      {item.fix && (
                        <div className="mt-1 text-xs text-amber-700">Action: {item.fix}</div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))}
      </section>
    </AdminShell>
  );
}
