import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  listTurnitinJobsNeedingAttention,
  reverifyTurnitinJob,
  restoreTurnitinJobCredit,
} from "@/lib/turnitin-admin-gateway.functions";

const STATE_LABEL: Record<string, string> = {
  uploading: "Uploading (not yet accepted by provider)",
  queued: "Queued at provider",
  processing: "Processing at provider",
  completed: "Completed at provider",
  failed: "Failed — confirmed by provider",
  gateway_unavailable: "Provider unavailable — nothing changed",
  unknown: "Unknown / not found at provider — nothing changed",
};
const ACTION_LABEL: Record<string, string> = {
  refund_consumed_credit: "Restore 1 checking credit",
  release_reserved_credit: "Release 1 reserved credit",
  void_postpaid_charge: "Void the postpaid charge",
};

export function TurnitinJobCreditPanel({ onChanged }: { onChanged?: () => void }) {
  const jobs = useQuery({
    queryKey: ["admin-turnitin-attention"],
    queryFn: () => listTurnitinJobsNeedingAttention(),
    refetchInterval: 60000,
  });
  const [active, setActive] = useState<{ jobId: string; correlationId: string } | null>(null);
  const [reason, setReason] = useState("");
  const verify = useMutation({
    mutationFn: (v: { jobId: string; correlationId: string }) => reverifyTurnitinJob({ data: v }),
  });
  const restore = useMutation({
    mutationFn: () =>
      restoreTurnitinJobCredit({ data: { jobId: active!.jobId, reason, correlationId: active!.correlationId } }),
    onSuccess: () => { setReason(""); void jobs.refetch(); onChanged?.(); },
  });
  const start = (jobId: string) => {
    const c = { jobId, correlationId: crypto.randomUUID() };
    setActive(c); setReason(""); restore.reset(); verify.mutate(c);
  };
  const v = verify.data && active && verify.data.jobId === active.jobId ? verify.data : null;
  const list = (jobs.data?.jobs ?? []) as any[];

  return (
    <section className="space-y-3 rounded-lg border bg-card p-4">
      <h2 className="text-lg font-semibold">Turnitin jobs needing attention</h2>
      <p className="text-sm text-muted-foreground">
        Every action re-checks the job live with the provider first. Credits are restored only when the provider
        confirms failure. These are usage credits only — no money is refunded. Every check and action is audited.
      </p>
      {jobs.isLoading && <p>Checking jobs…</p>}
      {jobs.isError && <p role="alert" className="text-destructive">Could not load jobs needing attention.</p>}
      {!jobs.isLoading && !jobs.isError && list.length === 0 && (
        <p className="text-sm">No failed jobs with outstanding credits and no long-running jobs right now.</p>
      )}
      {list.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead><tr>{["Created", "File", "Job", "Customer", "Status", "Credit", "Why listed", ""].map((h) => <th key={h} className="p-2">{h}</th>)}</tr></thead>
            <tbody>
              {list.map((j) => (
                <tr key={j.id} className="border-t">
                  <td className="p-2 whitespace-nowrap">{new Date(j.created_at).toLocaleString()}</td>
                  <td className="p-2">{j.original_filename ?? "—"}</td>
                  <td className="p-2 font-mono text-xs">{String(j.id).slice(0, 12)}</td>
                  <td className="p-2 font-mono text-xs">{String(j.user_id).slice(0, 12)}</td>
                  <td className="p-2">{j.status}</td>
                  <td className="p-2">{j.credit_state}{j.billing_mode === "postpaid" ? " (postpaid)" : ""}</td>
                  <td className="p-2">{j.attention === "long_running" ? "Running over 2 hours" : "Failed with credit held"}</td>
                  <td className="p-2"><button type="button" className="rounded border px-2 py-1" disabled={verify.isPending} onClick={() => start(j.id)}>Re-verify with provider</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {active && (
        <div className="space-y-2 rounded border p-3 text-sm" aria-live="polite">
          <p className="font-semibold">Job {active.jobId.slice(0, 12)} · reference {active.correlationId.slice(0, 8)}</p>
          {verify.isPending && <p>Asking the provider…</p>}
          {verify.isError && <p role="alert" className="text-destructive">{verify.error instanceof Error ? verify.error.message : "Verification failed"}</p>}
          {v && <>
            <p><strong>Provider result:</strong> {STATE_LABEL[v.gatewayState] ?? v.gatewayState}{v.upstreamStatus ? ` (provider status "${v.upstreamStatus}")` : ""}</p>
            <p>{v.decision.explanation}</p>
            {v.decision.eligible && !restore.isSuccess && <>
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason" placeholder="Reason (10–500 characters)" className="w-full rounded border bg-background p-2" />
              <div className="flex gap-2">
                <button type="button" className="rounded bg-primary px-3 py-2 text-primary-foreground" disabled={restore.isPending || reason.trim().length < 10} onClick={() => restore.mutate()}>
                  {restore.isPending ? "Working…" : ACTION_LABEL[v.decision.action] ?? "Confirm"}
                </button>
                <button type="button" className="rounded border px-3 py-2" onClick={() => setActive(null)}>Cancel</button>
              </div>
            </>}
          </>}
          {restore.isError && <p role="alert" className="text-destructive">{restore.error instanceof Error ? restore.error.message : "Action failed"}</p>}
          {restore.data && <p role="status">{restore.data.outcome === "restored" ? "Done. The change was applied and audited." : "This job had already been restored. No additional credit was added."}</p>}
        </div>
      )}
    </section>
  );
}
