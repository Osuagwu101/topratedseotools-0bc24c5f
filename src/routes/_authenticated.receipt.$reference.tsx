/**
 * Customer — single transaction receipt.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { SiteLayout } from "@/components/site/SiteLayout";
import { getMyTransactionReceipt } from "@/lib/transactions.functions";
import {
  RECEIPT_STATUS_LABEL,
  receiptDisclaimer,
  type PaymentStatus,
} from "@/lib/transaction-status";
import { getTool } from "@/lib/tools-data";
import { ArrowLeft, Copy, Receipt } from "lucide-react";
import { toast } from "sonner";
import { CONTACT_EMAIL, WHATSAPP_LINK, WHATSAPP_NUMBER } from "@/lib/site-config";

export const Route = createFileRoute("/_authenticated/receipt/$reference")({
  head: () => ({
    meta: [
      { title: "Payment receipt — Top Rated SEO Tools" },
      { name: "robots", content: "noindex" },
    ],
  }),
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(
      queryOptions({
        queryKey: ["my-receipt", params.reference],
        queryFn: () => getMyTransactionReceipt({ data: { reference: params.reference } }),
      }),
    ),
  component: ReceiptPage,
});

function ReceiptPage() {
  const { reference } = Route.useParams();
  const { data } = useSuspenseQuery(
    queryOptions({
      queryKey: ["my-receipt", reference],
      queryFn: () => getMyTransactionReceipt({ data: { reference } }),
    }),
  );
  const t = data.transaction;
  const st = t.payment_status as PaymentStatus;
  const tool = getTool(t.tool_slug);
  const disclaimer = receiptDisclaimer(st);

  function copy() {
    navigator.clipboard.writeText(t.paystack_reference ?? "").then(
      () => toast.success("Reference copied"),
      () => toast.error("Copy failed"),
    );
  }

  return (
    <SiteLayout>
      <section className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
        <Link
          to="/transactions"
          className="mb-4 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" /> Back to transactions
        </Link>

        <div className="rounded-2xl border bg-card p-6 shadow-card">
          <div className="flex items-center gap-3">
            <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Receipt className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-lg font-semibold">Transaction receipt</h1>
              <p className="text-xs text-muted-foreground">
                {new Date(t.initiated_at).toLocaleString()}
              </p>
            </div>
          </div>

          <div className="mt-4 rounded-lg bg-primary/5 p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-semibold">{RECEIPT_STATUS_LABEL[st]}</div>
              <span className="rounded-full bg-background px-2 py-0.5 text-[11px] font-medium">
                {t.paystack_environment}
              </span>
            </div>
            {disclaimer && (
              <p className="mt-1 text-xs text-muted-foreground">{disclaimer}</p>
            )}
          </div>

          <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
            <Field label="Reference">
              <span className="font-mono text-xs">{t.paystack_reference}</span>
              <button
                onClick={copy}
                className="ml-1 inline-flex items-center text-muted-foreground hover:text-foreground"
              >
                <Copy className="h-3 w-3" />
              </button>
            </Field>
            <Field label="Customer email">{t.customer_email ?? "—"}</Field>
            <Field label="Tool">{tool?.name ?? t.tool_slug}</Field>
            <Field label="Access type">{t.access_type ?? "—"}</Field>
            <Field label="Billing period">{t.billing_period ?? "—"}</Field>
            <Field label="Amount">₦{Number(t.amount ?? 0).toLocaleString()}</Field>
            <Field label="Payment channel">{t.payment_channel ?? "—"}</Field>
            <Field label="Paid at">
              {t.paid_at ? new Date(t.paid_at).toLocaleString() : "—"}
            </Field>
          </dl>

          {data.history.length > 0 && (
            <div className="mt-6">
              <h2 className="text-xs font-semibold uppercase text-muted-foreground">
                Status history
              </h2>
              <ul className="mt-2 space-y-1.5 text-xs">
                {data.history.map((h) => (
                  <li key={h.id} className="flex flex-wrap gap-2 rounded bg-muted/40 px-2 py-1.5">
                    <span className="font-medium">
                      {h.from_status ? `${h.from_status} → ` : ""}
                      {h.to_status}
                    </span>
                    <span className="text-muted-foreground">
                      ({h.source}) · {new Date(h.created_at).toLocaleString()}
                    </span>
                    {h.note && <span className="text-muted-foreground">— {h.note}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-6 rounded-lg border bg-muted/30 p-3 text-xs">
            <p className="font-semibold">Need help with this transaction?</p>
            <p className="text-muted-foreground">
              Email <a className="underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>{" "}
              or WhatsApp <a className="underline" href={WHATSAPP_LINK}>{WHATSAPP_NUMBER}</a>{" "}
              with the reference above.
            </p>
          </div>
        </div>
      </section>
    </SiteLayout>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}
