/**
 * Admin — Transactions list with search + Recheck + Reconcile.
 */
import { useMemo, useState } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { AdminShell } from "@/components/admin/AdminShell";
import { requireAdminOrRedirect } from "@/lib/admin-gate";
import {
  adminListTransactions,
  adminRecheckPaystackTransaction,
  adminUpdateReconciliation,
} from "@/lib/transactions.functions";
import { RECEIPT_STATUS_LABEL, type PaymentStatus } from "@/lib/transaction-status";
import { getTool } from "@/lib/tools-data";
import { formatAnyMoney } from "@/lib/currency-convert";
import {
  gatewayLabel,
  formatPaid,
  formatAccounting,
  paidCurrency,
  rateHint,
} from "@/lib/transaction-display";

import { Search, RefreshCw, Flag, Copy } from "lucide-react";

const txQuery = queryOptions({
  queryKey: ["admin-transactions"],
  queryFn: () => adminListTransactions({ data: {} }),
});

export const Route = createFileRoute("/admin/transactions")({
  ssr: false,
  beforeLoad: async () => {
    await requireAdminOrRedirect();
  },
  head: () => ({
    meta: [
      { title: "Transactions — Admin — Top Rated SEO Tools" },
      { name: "robots", content: "noindex" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(txQuery),
  component: AdminTransactionsPage,
});

const STATUSES = [
  "all",
  "initiated",
  "pending",
  "processing",
  "successful",
  "failed",
  "requires_review",
  "refunded",
  "reversed",
  "abandoned",
] as const;

function AdminTransactionsPage() {
  const { data } = useSuspenseQuery(txQuery);
  const router = useRouter();
  const recheck = useServerFn(adminRecheckPaystackTransaction);
  const reconcile = useServerFn(adminUpdateReconciliation);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [reconcileOpen, setReconcileOpen] = useState<string | null>(null);
  const [reconcileNote, setReconcileNote] = useState("");

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return data.transactions.filter((t) => {
      if (status !== "all" && t.payment_status !== status) return false;
      if (!s) return true;
      return (
        t.paystack_reference?.toLowerCase().includes(s) ||
        t.paystack_transaction_id?.toLowerCase().includes(s) ||
        t.order_id?.toLowerCase().includes(s) ||
        t.customer_email?.toLowerCase().includes(s) ||
        t.customer_profile_email?.toLowerCase().includes(s) ||
        t.customer_profile_name?.toLowerCase().includes(s) ||
        t.tool_slug.toLowerCase().includes(s)
      );
    });
  }, [data.transactions, search, status]);

  async function onRecheck(ref: string) {
    setBusy(ref);
    try {
      const r = await recheck({ data: { reference: ref } });
      toast.success(`Recheck: ${r.paystack_status ?? r.status}`);
      await router.invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Recheck failed");
    } finally {
      setBusy(null);
    }
  }

  async function onReconcile(
    ref: string,
    stat: "open" | "investigating" | "resolved" | "refunded" | "none",
  ) {
    setBusy(ref);
    try {
      await reconcile({
        data: {
          reference: ref,
          reconciliation_status: stat,
          note: reconcileNote.trim() || undefined,
        },
      });
      toast.success("Reconciliation updated");
      setReconcileOpen(null);
      setReconcileNote("");
      await router.invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <AdminShell>
      <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight">Transactions</h1>
        <p className="text-sm text-muted-foreground">
          Every payment attempt across all gateways. Customer paid shows the real
          charged currency; Accounting is the NGN equivalent used for revenue.
        </p>




        <div className="mt-4 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-md border bg-background px-2 py-1.5">
            <Search className="h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Reference, email, tool…"
              className="w-64 bg-transparent text-sm outline-none"
            />
          </div>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as (typeof STATUSES)[number])}
            className="rounded-md border bg-background px-2 py-1.5 text-sm"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s === "all" ? "All statuses" : RECEIPT_STATUS_LABEL[s as PaymentStatus]}
              </option>
            ))}
          </select>
          <span className="text-xs text-muted-foreground">
            {filtered.length} of {data.transactions.length}
          </span>
        </div>

        <div className="mt-4 overflow-x-auto rounded-xl border">
          <table className="w-full min-w-[1000px] text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Reference</th>
                <th className="px-3 py-2 text-left">Customer</th>
                <th className="px-3 py-2 text-left">Tool / plan</th>
                <th className="px-3 py-2 text-left">Gateway</th>
                <th className="px-3 py-2 text-left">Customer paid</th>
                <th className="px-3 py-2 text-left">Accounting (NGN)</th>
                <th className="px-3 py-2 text-left">Channel</th>

                <th className="px-3 py-2 text-left">Env</th>
                <th className="px-3 py-2 text-left">Initiated</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => {
                const tool = getTool(t.tool_slug);
                return (
                  <tr key={t.id} className="border-t align-top">
                    <td className="px-3 py-2 font-mono text-[11px]">
                      <div className="flex items-center gap-1">
                        {t.paystack_reference ?? "—"}
                        {t.paystack_reference && (
                          <button
                            onClick={() =>
                              navigator.clipboard.writeText(t.paystack_reference ?? "")
                            }
                            title="Copy"
                            className="text-muted-foreground hover:text-foreground"
                          >
                            <Copy className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                      {t.paystack_transaction_id && (
                        <div className="text-[10px] text-muted-foreground">
                          ps#{t.paystack_transaction_id}
                        </div>
                      )}
                      {t.order_id && (
                        <div className="text-[10px] text-muted-foreground">
                          ord {t.order_id.slice(0, 8)}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <div>{t.customer_profile_name ?? "—"}</div>
                      <div className="text-muted-foreground">
                        {t.customer_profile_email ?? t.customer_email ?? "—"}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <div className="font-medium">{tool?.name ?? t.tool_slug}</div>
                      <div className="text-muted-foreground">
                        {t.access_type ?? "—"} · {t.billing_period ?? "—"}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <span className="rounded bg-muted px-1.5 py-0.5 font-medium">
                        {gatewayLabel(t)}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <div className="font-medium">{formatPaid(t)}</div>
                      <div className="text-[11px] uppercase text-muted-foreground">
                        {paidCurrency(t)}
                        {t.international_fee_amount
                          ? ` · fee ${formatAnyMoney(t.international_fee_amount, paidCurrency(t))}`
                          : ""}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <div>{formatAccounting(t)}</div>
                      {rateHint(t) && (
                        <div className="text-[11px] text-muted-foreground">{rateHint(t)}</div>
                      )}
                    </td>

                    <td className="px-3 py-2 text-xs">{t.payment_channel ?? "—"}</td>
                    <td className="px-3 py-2 text-xs uppercase">{t.paystack_environment}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {new Date(t.initiated_at).toLocaleString()}
                    </td>
                    <td className="px-3 py-2">
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold">
                        {RECEIPT_STATUS_LABEL[t.payment_status as PaymentStatus] ?? t.payment_status}
                      </span>
                      {t.reconciliation_status !== "none" && (
                        <div className="mt-1 inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                          <Flag className="h-3 w-3" /> {t.reconciliation_status}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex flex-col items-end gap-1">
                        <button
                          onClick={() => t.paystack_reference && onRecheck(t.paystack_reference)}
                          disabled={busy === t.paystack_reference || !t.paystack_reference}
                          className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium hover:bg-muted disabled:opacity-50"
                        >
                          <RefreshCw className="h-3 w-3" /> Recheck
                        </button>
                        <button
                          onClick={() =>
                            setReconcileOpen(
                              reconcileOpen === t.paystack_reference ? null : t.paystack_reference,
                            )
                          }
                          className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium hover:bg-muted"
                        >
                          <Flag className="h-3 w-3" /> Reconcile
                        </button>
                        {reconcileOpen === t.paystack_reference && t.paystack_reference && (
                          <div className="mt-1 w-64 rounded-md border bg-card p-2 text-left">
                            <textarea
                              value={reconcileNote}
                              onChange={(e) => setReconcileNote(e.target.value)}
                              placeholder="Note (optional)"
                              rows={2}
                              className="mb-1 w-full rounded border bg-background p-1 text-xs"
                            />
                            <div className="flex flex-wrap gap-1">
                              {(["open", "investigating", "resolved", "refunded", "none"] as const).map(
                                (s) => (
                                  <button
                                    key={s}
                                    onClick={() =>
                                      t.paystack_reference && onReconcile(t.paystack_reference, s)
                                    }
                                    className="rounded border px-1.5 py-0.5 text-[10px] hover:bg-muted"
                                  >
                                    {s}
                                  </button>
                                ),
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-3 py-12 text-center text-sm text-muted-foreground">
                    No transactions match this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </AdminShell>
  );
}
