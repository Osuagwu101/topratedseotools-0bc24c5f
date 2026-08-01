/**
 * Customer — transaction history / payment receipts list.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { SiteLayout } from "@/components/site/SiteLayout";
import { listMyTransactions } from "@/lib/transactions.functions";
import { RECEIPT_STATUS_LABEL, type PaymentStatus } from "@/lib/transaction-status";
import { getTool } from "@/lib/tools-data";
import { formatAnyMoney } from "@/lib/currency-convert";
import { Receipt, ExternalLink } from "lucide-react";

const txQuery = queryOptions({
  queryKey: ["my-transactions"],
  queryFn: () => listMyTransactions(),
});

export const Route = createFileRoute("/_authenticated/transactions")({
  head: () => ({
    meta: [
      { title: "Transactions — Top Rated SEO Tools" },
      { name: "robots", content: "noindex" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(txQuery),
  component: TransactionsPage,
});

const STATUS_COLOR: Record<PaymentStatus, string> = {
  initiated: "bg-muted text-foreground",
  pending: "bg-amber-500/10 text-amber-600",
  processing: "bg-blue-500/10 text-blue-600",
  successful: "bg-emerald-500/10 text-emerald-600",
  failed: "bg-red-500/10 text-red-600",
  requires_review: "bg-orange-500/10 text-orange-600",
  refunded: "bg-slate-500/10 text-slate-600",
  reversed: "bg-slate-500/10 text-slate-600",
  abandoned: "bg-slate-500/10 text-slate-600",
};

function TransactionsPage() {
  const { data } = useSuspenseQuery(txQuery);
  return (
    <SiteLayout>
      <section className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Receipt className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Transactions</h1>
            <p className="text-sm text-muted-foreground">
              Every payment attempt on your account. Only you can see these.
            </p>
          </div>
        </div>

        {data.transactions.length === 0 ? (
          <div className="mt-8 rounded-2xl border border-dashed p-10 text-center text-sm text-muted-foreground">
            No transactions yet. Purchase a tool to see your receipts here.
          </div>
        ) : (
          <div className="mt-6 overflow-x-auto rounded-xl border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Reference</th>
                  <th className="px-3 py-2 text-left">Tool</th>
                  <th className="px-3 py-2 text-left">Amount</th>
                  <th className="px-3 py-2 text-left">Date</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {data.transactions.map((t) => {
                  const tool = getTool(t.tool_slug);
                  const st = t.payment_status as PaymentStatus;
                  return (
                    <tr key={t.id} className="border-t">
                      <td className="px-3 py-2 font-mono text-xs">
                        {t.paystack_reference ?? "—"}
                      </td>
                      <td className="px-3 py-2">{tool?.name ?? t.tool_slug}</td>
                      <td className="px-3 py-2">
                        {formatAnyMoney(t.final_amount ?? t.amount, t.payment_currency)}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {new Date(t.initiated_at).toLocaleString()}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_COLOR[st] ?? "bg-muted"}`}
                        >
                          {RECEIPT_STATUS_LABEL[st] ?? st}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        {t.paystack_reference && (
                          <Link
                            to="/receipt/$reference"
                            params={{ reference: t.paystack_reference }}
                            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                          >
                            View receipt <ExternalLink className="h-3 w-3" />
                          </Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </SiteLayout>
  );
}
