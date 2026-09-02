/**
 * Admin — Payment Issue Resolution Centre.
 *
 * Aggregates the seven payment-issue categories (failed, pending,
 * paid-without-access, duplicates, webhook failures, refund requests,
 * cancelled) into a single dashboard with one-click resolution actions.
 */
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AdminShell } from "@/components/admin/AdminShell";
import { requireAdminOrRedirect } from "@/lib/admin-gate";
import {
  adminListPaymentIssues,
  retryAccessAssignment,
  retryWebhookEvent,
  markPaymentReconciled,
  type RecoveryIssue,
} from "@/lib/payment-recovery.functions";
import { adminRecheckPaystackTransaction } from "@/lib/transactions.functions";
import {
  AlertTriangle,
  CircleDollarSign,
  Clock,
  Copy,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Users,
  Webhook,
  XCircle,
} from "lucide-react";

const issuesQuery = queryOptions({
  queryKey: ["admin-payment-issues"],
  queryFn: () => adminListPaymentIssues(),
});

export const Route = createFileRoute("/admin/settings/payment-recovery")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Payment Management — Admin" }, { name: "robots", content: "noindex" }],
  }),
  beforeLoad: async () => {
    await requireAdminOrRedirect();
  },
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(issuesQuery);
  },
  component: PaymentRecoveryPage,
});

type Category = RecoveryIssue["category"];

const CATEGORY_META: Record<Category, { label: string; icon: typeof AlertTriangle; tint: string }> =
  {
    paid_no_access: { label: "Paid — no access", icon: ShieldAlert, tint: "text-destructive" },
    failed_payment: { label: "Failed payments", icon: XCircle, tint: "text-destructive" },
    pending_payment: { label: "Pending payments", icon: Clock, tint: "text-warning" },
    duplicate_attempt: { label: "Duplicate attempts", icon: Users, tint: "text-warning" },
    webhook_failed: { label: "Webhook failures", icon: Webhook, tint: "text-destructive" },
    refund_requested: { label: "Refund / flagged", icon: CircleDollarSign, tint: "text-warning" },
    cancelled_transaction: { label: "Cancelled", tint: "text-muted-foreground", icon: XCircle },
  };

const CATEGORY_ORDER: Category[] = [
  "paid_no_access",
  "webhook_failed",
  "failed_payment",
  "pending_payment",
  "duplicate_attempt",
  "refund_requested",
  "cancelled_transaction",
];

function money(v: number | null, cur: string) {
  if (v == null) return "—";
  return `${cur === "NGN" ? "₦" : ""}${Math.round(v).toLocaleString()}`;
}

function PaymentRecoveryPage() {
  const { data } = useSuspenseQuery(issuesQuery);
  const router = useRouter();
  const retryAssign = useServerFn(retryAccessAssignment);
  const retryWebhook = useServerFn(retryWebhookEvent);
  const recheck = useServerFn(adminRecheckPaystackTransaction);
  const markRec = useServerFn(markPaymentReconciled);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<Category | "all">("all");

  const filtered = useMemo(
    () => (filter === "all" ? data.issues : data.issues.filter((i) => i.category === filter)),
    [data.issues, filter],
  );

  async function runAction(issue: RecoveryIssue) {
    setBusy(issue.id);
    try {
      if (issue.action_key === "retry_access_assignment" && issue.order_id) {
        const r = await retryAssign({ data: { order_id: issue.order_id } });
        toast.success(
          r.assignment_id
            ? "Access re-assigned from the pool."
            : r.approved
              ? "Order approved — no free pool slot, awaiting assignment."
              : "Order was already approved.",
        );
      } else if (issue.action_key === "retry_webhook") {
        const id = issue.id.replace(/^wh:/, "");
        await retryWebhook({ data: { event_id: id } });
        toast.success("Webhook re-processed.");
      } else if (issue.action_key === "recheck_payment" && issue.reference) {
        const r = await recheck({ data: { reference: issue.reference } });
        toast.success(`Paystack reports: ${r.status}`);
      } else if (issue.action_key === "mark_reconciled" && issue.payment_id) {
        await markRec({ data: { payment_id: issue.payment_id, status: "resolved" } });
        toast.success("Marked as resolved.");
      } else {
        toast.error("No automatic action available for this issue.");
      }
      await router.invalidate();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const total = data.issues.length;

  return (
    <AdminShell>
      <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <header className="mb-6 flex flex-wrap items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-primary text-primary-foreground shadow-glow">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">Payment Management</h1>
            <p className="text-sm text-muted-foreground">
              Fix payment issues without touching code. Every action is logged in the admin activity
              feed.
            </p>
          </div>
          <button
            onClick={() => router.invalidate()}
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
        </header>

        {/* Summary cards */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          {CATEGORY_ORDER.map((c) => {
            const meta = CATEGORY_META[c];
            const Icon = meta.icon;
            const count = data.summary[c] ?? 0;
            const isSel = filter === c;
            return (
              <button
                key={c}
                onClick={() => setFilter(isSel ? "all" : c)}
                className={`rounded-xl border bg-card p-3 text-left transition hover:border-primary/50 ${
                  isSel ? "border-primary bg-primary/5" : ""
                }`}
              >
                <div
                  className={`flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide ${meta.tint}`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {meta.label}
                </div>
                <div className="mt-1 text-2xl font-semibold tabular-nums">{count}</div>
              </button>
            );
          })}
        </div>

        <div className="mt-4 flex items-center justify-between">
          <div className="text-xs text-muted-foreground">
            Showing {filtered.length} of {total} issue{total === 1 ? "" : "s"}
            {filter !== "all" && ` in "${CATEGORY_META[filter].label}"`}
          </div>
          {filter !== "all" && (
            <button
              onClick={() => setFilter("all")}
              className="text-xs text-primary underline underline-offset-2"
            >
              Show all
            </button>
          )}
        </div>

        {/* Issues list */}
        {filtered.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-dashed p-12 text-center text-sm text-muted-foreground">
            <ShieldCheck className="mx-auto mb-2 h-8 w-8 text-success" />
            No open issues in this category. Everything looks healthy.
          </div>
        ) : (
          <ul className="mt-4 space-y-2">
            {filtered.map((issue) => {
              const meta = CATEGORY_META[issue.category];
              const Icon = meta.icon;
              const isBusy = busy === issue.id;
              return (
                <li key={issue.id} className="rounded-2xl border bg-card p-4 shadow-card">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div
                        className={`flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide ${meta.tint}`}
                      >
                        <Icon className="h-3.5 w-3.5" /> {meta.label}
                      </div>
                      <div className="mt-1 font-semibold">{issue.title}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {issue.tool_slug && <>{issue.tool_slug} · </>}
                        {issue.customer_email && <>{issue.customer_email} · </>}
                        {money(issue.amount, issue.currency)} ·{" "}
                        {new Date(issue.created_at).toLocaleString()}
                      </div>
                      <p className="mt-2 text-sm text-muted-foreground">{issue.detail}</p>
                      {issue.reference && (
                        <div className="mt-2 flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
                          <span>{issue.reference}</span>
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(issue.reference!);
                              toast.success("Reference copied");
                            }}
                            className="rounded p-0.5 hover:bg-muted"
                            aria-label="Copy reference"
                          >
                            <Copy className="h-3 w-3" />
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <button
                        onClick={() => runAction(issue)}
                        disabled={isBusy}
                        className="rounded-md bg-gradient-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-glow hover:opacity-90 disabled:opacity-60"
                      >
                        {isBusy ? "Working…" : issue.recommended_action}
                      </button>
                      {issue.payment_id && issue.action_key !== "mark_reconciled" && (
                        <button
                          onClick={() =>
                            markRec({
                              data: { payment_id: issue.payment_id!, status: "resolved" },
                            })
                              .then(() => {
                                toast.success("Marked resolved");
                                router.invalidate();
                              })
                              .catch((e) => toast.error((e as Error).message))
                          }
                          className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
                        >
                          Ignore
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </AdminShell>
  );
}
