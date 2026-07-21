import { AdminShell } from "@/components/admin/AdminShell";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useSuspenseQuery, queryOptions, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { requireAdminOrRedirect } from "@/lib/admin-gate";
import {
  listMarketingEvents,
  retryFailedEvent,
} from "@/lib/marketing/integrations.functions";

const q = queryOptions({
  queryKey: ["admin-marketing-events"],
  queryFn: () => listMarketingEvents({ data: { limit: 200 } }),
});

export const Route = createFileRoute("/admin/marketing/events")({
  ssr: false,
  beforeLoad: async () => {
    await requireAdminOrRedirect();
  },
  head: () => ({
    meta: [
      { title: "Marketing events — Admin" },
      { name: "robots", content: "noindex" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(q),
  component: EventsPage,
});

function EventsPage() {
  const { data } = useSuspenseQuery(q);
  const retry = useServerFn(retryFailedEvent);
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("");

  const filtered = statusFilter
    ? data.events.filter((e) => e.status === statusFilter)
    : data.events;

  async function onRetry(id: string) {
    setBusy(id);
    try {
      const r = await retry({ data: { id } });
      if (r.status === "sent") toast.success("Retried and sent.");
      else if (r.status === "deduplicated") toast.message("Already sent (deduped).");
      else toast.error(r.error ?? r.status);
      qc.invalidateQueries({ queryKey: ["admin-marketing-events"] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Retry failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <AdminShell>
      <section className="mx-auto max-w-6xl space-y-4 p-6">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Event history</h1>
            <p className="text-sm text-muted-foreground">
              Server-side audit trail. Duplicates are enforced by a unique
              index on (platform, event_id) for status=sent — safe to retry.
            </p>
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-md border bg-background px-2 py-1 text-sm"
          >
            <option value="">All statuses</option>
            <option value="sent">Sent</option>
            <option value="failed">Failed</option>
            <option value="deduplicated">Deduplicated</option>
            <option value="skipped">Skipped</option>
          </select>
        </header>

        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="p-2">Time</th>
                <th className="p-2">Event</th>
                <th className="p-2">Platform</th>
                <th className="p-2">Status</th>
                <th className="p-2">Order / tool</th>
                <th className="p-2 text-right">Amount</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={e.id} className="border-t">
                  <td className="p-2 whitespace-nowrap">{new Date(e.created_at).toLocaleString()}</td>
                  <td className="p-2">{e.event_name}</td>
                  <td className="p-2">{e.platform}</td>
                  <td className="p-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        e.status === "sent"
                          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                          : e.status === "failed"
                            ? "bg-destructive/10 text-destructive"
                            : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {e.status}
                    </span>
                    {e.error_message ? (
                      <div className="mt-1 max-w-xs truncate text-[11px] text-destructive" title={e.error_message}>
                        {e.error_message}
                      </div>
                    ) : null}
                  </td>
                  <td className="p-2 text-xs">
                    {e.tool_slug ?? "—"}
                    {e.order_id ? <div className="text-muted-foreground">{e.order_id.slice(0, 8)}…</div> : null}
                  </td>
                  <td className="p-2 text-right">
                    {e.amount ? `${e.currency ?? "NGN"} ${Number(e.amount).toLocaleString()}` : "—"}
                  </td>
                  <td className="p-2">
                    {e.status === "failed" ? (
                      <button
                        onClick={() => onRetry(e.id)}
                        disabled={busy === e.id}
                        className="rounded-md border px-2 py-1 text-xs hover:bg-muted disabled:opacity-60"
                      >
                        Retry
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-6 text-center text-sm text-muted-foreground">
                    No events yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </AdminShell>
  );
}
