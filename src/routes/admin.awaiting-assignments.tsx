/**
 * /admin/awaiting-assignments — Paid customers with no active pool
 * assignment, plus a one-click "Assign now" that runs the pool selector.
 */
import { requireAdminOrRedirect } from "@/lib/admin-gate";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { queryOptions, useSuspenseQuery, useQueryClient } from "@tanstack/react-query";
import { AdminShell } from "@/components/admin/AdminShell";
import { listAwaitingAssignments, assignAwaitingCustomer } from "@/lib/access-health.functions";
import { toast } from "sonner";

const q = queryOptions({
  queryKey: ["awaiting-assignments"],
  queryFn: () => listAwaitingAssignments(),
});

export const Route = createFileRoute("/admin/awaiting-assignments")({
  ssr: false,
  beforeLoad: async () => { await requireAdminOrRedirect(); },
  head: () => ({ meta: [{ title: "Awaiting assignment — Admin" }, { name: "robots", content: "noindex" }] }),
  loader: async ({ context }) => { await context.queryClient.ensureQueryData(q); },
  component: AwaitingPage,
});

function AwaitingPage() {
  const { data } = useSuspenseQuery(q);
  const qc = useQueryClient();
  const assign = useServerFn(assignAwaitingCustomer);

  return (
    <AdminShell>
      <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-semibold tracking-tight">Awaiting assignment</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Paid customers who don't yet have a pool assignment. They see "Awaiting account assignment" — never legacy or unrelated credentials.
        </p>

        <div className="mt-6 overflow-x-auto rounded-2xl border bg-card shadow-card">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Customer</th>
                <th className="px-3 py-2 text-left">Tool</th>
                <th className="px-3 py-2 text-left">Type</th>
                <th className="px-3 py-2 text-left">Billing</th>
                <th className="px-3 py-2 text-left">Paid</th>
                <th className="px-3 py-2 text-left">Expires</th>
                <th className="px-3 py-2 text-left">Reason</th>
                <th className="px-3 py-2 text-left">Compatible</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.order_id} className="border-b last:border-0 align-top">
                  <td className="px-3 py-2">
                    <div className="font-medium">{r.profile?.full_name ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">{r.profile?.email ?? r.user_id.slice(0,8)}</div>
                  </td>
                  <td className="px-3 py-2">
                    <Link to="/admin/tools/$slug" params={{ slug: r.tool_slug }} className="text-primary hover:underline">
                      {r.tool_slug}
                    </Link>
                  </td>
                  <td className="px-3 py-2 capitalize">{r.access_type}</td>
                  <td className="px-3 py-2 capitalize">{r.billing_period ?? "—"}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{r.paid_at ? new Date(r.paid_at).toLocaleDateString() : "—"}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{r.expires_at ? new Date(r.expires_at).toLocaleDateString() : "—"}</td>
                  <td className="px-3 py-2">{r.reason}</td>
                  <td className="px-3 py-2 text-xs">
                    {r.available_accounts.length === 0 ? <span className="text-muted-foreground">None</span> :
                      r.available_accounts.map((a: any) => (
                        <div key={a.id}>{a.label} <span className="text-muted-foreground">({a.available} free)</span></div>
                      ))}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      disabled={r.available_accounts.length === 0}
                      onClick={async () => {
                        try {
                          await assign({ data: { order_id: r.order_id } });
                          toast.success("Assigned.");
                          qc.invalidateQueries({ queryKey: ["awaiting-assignments"] });
                        } catch (e: any) { toast.error(e?.message ?? "Failed"); }
                      }}
                      className="rounded-md border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
                    >Assign now</button>
                  </td>
                </tr>
              ))}
              {data.rows.length === 0 && (
                <tr><td colSpan={9} className="px-3 py-8 text-center text-sm text-muted-foreground">Nobody is awaiting assignment.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </AdminShell>
  );
}
