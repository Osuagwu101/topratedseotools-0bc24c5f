import { createFileRoute, redirect } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAdminOrRedirect } from "@/lib/admin-gate";
import { getMyAdminContext } from "@/lib/admin-permissions.functions";
import { createBackup, exportConfiguration, listBackupHistory } from "@/lib/system-ops.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/settings/backup")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Backup & Recovery — Admin" }, { name: "robots", content: "noindex" }],
  }),
  beforeLoad: async () => {
    await requireAdminOrRedirect();
    const ctx = await getMyAdminContext();
    if (!ctx.isSuperAdmin && !ctx.permissions.includes("backups.access")) {
      throw redirect({ to: "/admin/dashboard" });
    }
  },
  component: BackupPage,
});

function downloadJson(filename: string, json: string) {
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function BackupPage() {
  const history = useQuery({ queryKey: ["backup-history"], queryFn: () => listBackupHistory() });
  const [lastSummary, setLastSummary] = useState<string | null>(null);

  const backup = useMutation({
    mutationFn: () => createBackup(),
    onSuccess: (res) => {
      downloadJson(res.filename, res.json);
      setLastSummary(`Exported ${res.total_rows} rows across ${res.tables.length} tables.`);
      toast.success("Backup created and downloaded.");
      history.refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cfg = useMutation({
    mutationFn: () => exportConfiguration(),
    onSuccess: (res) => {
      downloadJson(res.filename, res.json);
      toast.success("Configuration exported.");
      history.refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <AdminShell>
      <section className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Backup & Recovery</h1>
          <p className="text-sm text-muted-foreground">
            Download a full business-data snapshot or a lightweight configuration export. Secrets,
            credentials, and passwords are never included.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Full backup</CardTitle>
              <CardDescription>
                Tools, pricing, orders, payments, customers, templates, admin settings. Sensitive
                fields are redacted.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button onClick={() => backup.mutate()} disabled={backup.isPending}>
                {backup.isPending ? "Preparing…" : "Create backup"}
              </Button>
              {lastSummary && <p className="text-xs text-muted-foreground">{lastSummary}</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Configuration export</CardTitle>
              <CardDescription>
                Tool catalogue, pricing plans, promotions, email templates, admin roles.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" onClick={() => cfg.mutate()} disabled={cfg.isPending}>
                {cfg.isPending ? "Preparing…" : "Export configuration"}
              </Button>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>History</CardTitle>
            <CardDescription>Latest backup and export activity.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y">
              {(history.data?.rows ?? []).map((r) => (
                <li key={r.id} className="grid grid-cols-[auto_1fr_auto] gap-3 py-3 text-sm">
                  <div className="text-xs text-muted-foreground">
                    {new Date(r.createdAt).toLocaleString()}
                  </div>
                  <div>
                    <div className="font-medium">{r.action}</div>
                    <div className="text-xs text-muted-foreground">{r.reference ?? "—"}</div>
                  </div>
                  <div
                    className={`text-xs font-semibold ${r.success ? "text-emerald-600" : "text-destructive"}`}
                  >
                    {r.success ? "ok" : "failed"}
                  </div>
                </li>
              ))}
              {history.data && history.data.rows.length === 0 && (
                <li className="py-6 text-sm text-muted-foreground">No backups yet.</li>
              )}
            </ul>
          </CardContent>
        </Card>
      </section>
    </AdminShell>
  );
}
