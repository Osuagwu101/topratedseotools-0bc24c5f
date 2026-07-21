import { createFileRoute, redirect } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { AdminShell } from "@/components/admin/AdminShell";
import { requireAdminOrRedirect } from "@/lib/admin-gate";
import { listAdminActivity } from "@/lib/admin-activity.functions";
import { getMyAdminContext } from "@/lib/admin-permissions.functions";

const activityQuery = queryOptions({
  queryKey: ["admin-activity", 1],
  queryFn: () => listAdminActivity({ data: { page: 1, pageSize: 100 } }),
});

export const Route = createFileRoute("/admin/settings/activity")({
  ssr: false,
  head: () => ({ meta: [{ title: "Admin Activity — Admin" }, { name: "robots", content: "noindex" }] }),
  beforeLoad: async () => {
    await requireAdminOrRedirect();
    const ctx = await getMyAdminContext();
    if (!ctx.isSuperAdmin && !ctx.permissions.includes("audit.view")) {
      throw redirect({ to: "/admin/dashboard" });
    }
  },
  loader: async ({ context }) => { await context.queryClient.ensureQueryData(activityQuery); },
  component: ActivityPage,
});

function ActivityPage() {
  const { data } = useSuspenseQuery(activityQuery);
  return (
    <AdminShell>
      <section className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Admin Activity</h1>
          <p className="text-sm text-muted-foreground">Append-only log of important admin actions. No secrets stored.</p>
        </div>
        <div className="rounded-2xl border bg-card shadow-card">
          <div className="grid grid-cols-[auto_1fr_auto_auto] gap-3 border-b p-3 text-xs font-semibold uppercase text-muted-foreground">
            <div>When</div>
            <div>Action</div>
            <div>Admin</div>
            <div>Status</div>
          </div>
          <ul className="divide-y">
            {data.rows.map((r) => (
              <li key={r.id} className="grid grid-cols-[auto_1fr_auto_auto] gap-3 p-3 text-sm">
                <div className="text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleString()}</div>
                <div>
                  <div className="font-medium">{r.action}</div>
                  <div className="text-xs text-muted-foreground">
                    {[r.area, r.targetType && `${r.targetType}${r.targetId ? `:${r.targetId.slice(0,8)}` : ""}`, r.reason]
                      .filter(Boolean).join(" · ")}
                  </div>
                </div>
                <div className="text-xs text-muted-foreground">{r.actorEmail ?? "—"}</div>
                <div className={`text-xs font-semibold ${r.success ? "text-emerald-600" : "text-destructive"}`}>
                  {r.success ? "ok" : "failed"}
                </div>
              </li>
            ))}
            {data.rows.length === 0 && <li className="p-6 text-sm text-muted-foreground">No activity yet.</li>}
          </ul>
        </div>
      </section>
    </AdminShell>
  );
}
