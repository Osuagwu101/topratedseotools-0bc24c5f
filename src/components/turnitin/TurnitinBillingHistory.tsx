/**
 * Customer — Turnitin postpaid billing history (summary, timeline, invoices, payments).
 * Only the signed-in customer's own records are returned by the server. Admin notes are never sent.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Clock, Download, FileText, History, Lock, Unlock, Wallet } from "lucide-react";
import {
  getMyTurnitinPostpaidInvoiceOverview,
  getMyTurnitinPostpaidBillingHistory,
  type PostpaidHistoryEvent,
} from "@/lib/turnitin-postpaid-invoices.functions";
import { downloadTopRatedInvoice } from "@/lib/turnitin-postpaid-invoice-pdf";

const ngn = (v: unknown) => "₦" + Math.round(Number(v ?? 0)).toLocaleString("en-NG");
const when = (v: unknown) =>
  v ? new Date(String(v)).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
const day = (v: unknown) => (v ? new Date(String(v)).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—");
const shortRef = (r: unknown) => (r ? String(r).slice(0, 14) + "…" : "");

const METHOD: Record<string, string> = {
  bank_transfer: "bank transfer", whatsapp: "arrangement with TopRated support", offline: "cash / offline payment",
  other: "other payment method", website: "online payment",
};

function planText(mode?: string | null, threshold?: number | null, dueDays?: number | null) {
  const base = mode === "files" ? `You are billed every ${threshold ?? "—"} successful checks.`
    : mode === "hybrid" ? `You are billed monthly or every ${threshold ?? "—"} successful checks, whichever comes first.`
    : "You are billed monthly.";
  return dueDays == null ? base : `${base} Invoices are due ${dueDays} day${dueDays === 1 ? "" : "s"} after they are issued.`;
}

type Cat = "invoices" | "payments" | "restrictions" | "account";
type Row = { at: string; cat: Cat; tone: "bad" | "good" | "info" | "neutral"; title: string; text: string; amount?: number | null; reconstructed?: boolean };

export function describe(e: PostpaidHistoryEvent): Row | null {
  const a = (k: string) => (e as any)[k];
  const base = { at: e.at, reconstructed: !!a("reconstructed") };
  switch (e.type) {
    case "account_postpaid_enabled":
      return { ...base, cat: "account", tone: "info", title: "Postpaid billing activated",
        text: a("rate_ngn") != null ? `Your Turnitin checks are billed after use at ${ngn(a("rate_ngn"))} per check.` : "Your Turnitin checks are billed after use." };
    case "account_postpaid_disabled":
      return { ...base, cat: "account", tone: "neutral", title: "Postpaid billing turned off", text: "Your account returned to prepaid checks." };
    case "account_rate_changed":
      return { ...base, cat: "account", tone: "info", title: "Price per check updated",
        text: `Price changed from ${ngn(a("previous_rate_ngn"))} to ${ngn(a("rate_ngn"))} per check. Earlier checks keep the price at the time they were used.` };
    case "plan_changed":
      return { ...base, cat: "account", tone: "info", title: "Billing plan updated",
        text: planText(a("trigger_mode"), a("file_threshold"), a("due_days")) };
    case "invoice_issued":
      return { ...base, cat: "invoices", tone: "neutral", title: "Invoice issued", amount: Number(a("amount_ngn")),
        text: `Invoice ${shortRef(a("invoice_ref"))} for ${a("file_count")} check${a("file_count") === 1 ? "" : "s"}. ` +
          (a("trigger_reason") === "file_threshold" ? "Issued because you reached your billing file limit." : "Issued at the end of your monthly billing period.") +
          (a("due_at") ? ` Due by ${day(a("due_at"))}.` : "") };
    case "invoice_settled":
      return { ...base, cat: "invoices", tone: "good", title: "Invoice paid in full", amount: Number(a("amount_ngn")),
        text: `Invoice ${shortRef(a("invoice_ref"))} has been fully paid.` };
    case "statement_issued":
      return { ...base, cat: "invoices", tone: "neutral", title: "Monthly statement issued", amount: Number(a("amount_ngn")),
        text: `Statement ${shortRef(a("invoice_ref"))} for ${day(a("period_start"))} to ${day(a("period_end"))}.` };
    case "payment_confirmed": {
      const refs = (a("invoice_refs") as string[] | null) ?? [];
      return { ...base, cat: "payments", tone: "good", title: "Payment received", amount: Number(a("amount_ngn")),
        text: `${ngn(a("amount_ngn"))} received by ${METHOD[a("method")] ?? "payment"}` +
          (a("reference") ? ` (reference ${a("reference")})` : "") + "." +
          (refs.length ? ` Applied to invoice ${refs.map(shortRef).join(", ")}.` : " Applied to your unpaid checks.") };
    }
    case "payment_pending":
      return { ...base, cat: "payments", tone: "neutral", title: "Online payment started", amount: Number(a("amount_ngn")),
        text: `${ngn(a("amount_ngn"))} is waiting for confirmation from the payment provider. Your balance updates once it is confirmed.` };
    case "payment_failed":
      return { ...base, cat: "payments", tone: "bad", title: "Online payment not completed", amount: Number(a("amount_ngn")),
        text: `The payment of ${ngn(a("amount_ngn"))} did not go through, so your balance was not changed.` };
    case "charge_voided":
      return { ...base, cat: "account", tone: "good", title: "Charge removed", amount: -Number(a("amount_ngn")),
        text: `A check that did not complete was removed from your bill${a("submission_ref") ? ` (submission ${a("submission_ref")})` : ""}.` };
    case "restriction_restricted": {
      const monthly = a("reason") === "monthly_period_end";
      return { ...base, cat: "restrictions", tone: "bad", title: "New checks paused — payment required",
        text: (monthly ? "Your monthly billing period ended" :
          `You reached your billing limit${a("charge_count") != null ? ` (${a("charge_count")} checks this cycle)` : ""}`) +
          (a("outstanding_ngn") != null ? ` with ${ngn(a("outstanding_ngn"))} unpaid.` : " with an unpaid balance.") +
          (a("invoice_ref") ? ` See invoice ${shortRef(a("invoice_ref"))}.` : "") + " Pay your balance to continue checking." };
    }
    case "restriction_lifted": {
      const r = a("reason");
      const text = r === "admin_payment" ? "Access restored after your payment. A new billing cycle has started; any amount still unpaid remains due."
        : r === "manual_lift" ? "Access restored by TopRated support. A new billing cycle has started; your outstanding balance remains due."
        : r === "full_settlement" ? "Access restored because your balance was paid in full. A new billing cycle has started."
        : r === "admin_override" ? "Access restored by TopRated support."
        : "Access restored.";
      return { ...base, cat: "restrictions", tone: "good", title: "Checks resumed", text };
    }
    case "restriction_cycle_reset":
      return { ...base, cat: "restrictions", tone: "info", title: "New billing cycle started",
        text: a("reason") === "admin_payment" ? "A new billing cycle started after your payment was recorded."
          : "A new billing cycle was started by TopRated support." };
    case "restriction_override_on":
      return { ...base, cat: "restrictions", tone: "good", title: "Billing limit paused by support",
        text: "TopRated support allowed checks to continue without the automatic billing limit." };
    case "restriction_override_off":
      return { ...base, cat: "restrictions", tone: "neutral", title: "Automatic billing limit reapplied",
        text: "Your account is back on the automatic billing limit for your plan." };
    default:
      return null;
  }
}

const TONE: Record<Row["tone"], { icon: any; cls: string }> = {
  bad: { icon: Lock, cls: "bg-red-500/10 text-red-600" },
  good: { icon: Unlock, cls: "bg-emerald-500/10 text-emerald-600" },
  info: { icon: History, cls: "bg-blue-500/10 text-blue-600" },
  neutral: { icon: FileText, cls: "bg-muted text-foreground" },
};
const FILTERS: Array<{ key: "all" | Cat; label: string }> = [
  { key: "all", label: "All" }, { key: "restrictions", label: "Restrictions" }, { key: "invoices", label: "Invoices" },
  { key: "payments", label: "Payments" }, { key: "account", label: "Plan & account" },
];
const INV_STATUS: Record<string, string> = { due: "Due", overdue: "Overdue", paid: "Paid", voided: "Voided" };

export function TurnitinBillingHistory() {
  const overview = useQuery({ queryKey: ["turnitin-postpaid-invoices"], queryFn: () => getMyTurnitinPostpaidInvoiceOverview() });
  const history = useQuery({
    queryKey: ["turnitin-postpaid-history"], queryFn: () => getMyTurnitinPostpaidBillingHistory(),
    enabled: !!overview.data?.postpaid,
  });
  const [filter, setFilter] = useState<"all" | Cat>("all");
  const [shown, setShown] = useState(20);
  const rows = useMemo(() => ((history.data?.events ?? []) as PostpaidHistoryEvent[])
    .map(describe).filter((r): r is Row => !!r), [history.data]);
  const visible = rows.filter((r) => filter === "all" || r.cat === filter);

  if (overview.isLoading) return <Card><p className="text-sm text-muted-foreground">Loading Turnitin billing…</p></Card>;
  if (overview.isError) return <Card><p className="text-sm text-red-600">We couldn't load your Turnitin billing right now. Please refresh the page.</p></Card>;
  if (!overview.data?.postpaid) return null;

  const d = overview.data;
  const p: any = d.policy ?? {};
  const atLimit = p.enforced && p.trigger_mode !== "monthly" && p.file_threshold != null &&
    Number(p.charge_count ?? 0) + Number(p.pending_count ?? 0) >= Number(p.file_threshold);
  const status = p.blocked ? { label: "Restricted — payment required", cls: "bg-red-500/10 text-red-600", icon: Lock }
    : atLimit ? { label: "Billing limit reached — checks still processing", cls: "bg-amber-500/10 text-amber-700", icon: Clock }
    : { label: "Active", cls: "bg-emerald-500/10 text-emerald-600", icon: CheckCircle2 };
  const StatusIcon = status.icon;

  return (
    <>
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2"><Wallet className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold">Turnitin postpaid billing</h2></div>
            <span className={`mt-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${status.cls}`}>
              <StatusIcon className="h-3.5 w-3.5" /> {status.label}
            </span>
            <p className="mt-3 text-sm text-muted-foreground">{p.enforced ? planText(p.trigger_mode, p.file_threshold, null) : "You are billed after use."}</p>
            {p.enforced && p.trigger_mode !== "monthly" && p.file_threshold != null && (
              <p className="mt-1 text-sm">Checks this cycle: <strong>{p.charge_count ?? 0} of {p.file_threshold}</strong>
                {Number(p.pending_count ?? 0) > 0 ? ` (${p.pending_count} still processing)` : ""}</p>)}
            {p.blocked && <p className="mt-2 flex items-center gap-1.5 text-sm text-red-600"><AlertCircle className="h-4 w-4" />
              New checks are paused until your outstanding balance is paid.</p>}
          </div>
          <div className="text-right">
            <div className="text-sm text-muted-foreground">Outstanding balance</div>
            <div className="mt-1 text-2xl font-bold">{ngn(d.totalOutstandingNgn)}</div>
            {Number(d.totalOutstandingNgn) > 0 && <a href="/turnitin"
              className="mt-3 inline-flex items-center rounded-md bg-gradient-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-glow hover:opacity-90">
              Pay now</a>}
          </div>
        </div>
      </Card>

      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2"><History className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Turnitin billing history</h2></div>
          <div className="flex flex-wrap gap-1.5">{FILTERS.map((f) =>
            <button key={f.key} type="button" onClick={() => { setFilter(f.key); setShown(20); }}
              className={"rounded-full border px-3 py-1 text-xs font-medium " + (filter === f.key ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted")}>
              {f.label}</button>)}</div>
        </div>
        {history.isLoading && <p className="text-sm text-muted-foreground">Loading history…</p>}
        {history.isError && <p className="text-sm text-red-600">We couldn't load your billing history. Please refresh the page.</p>}
        {history.data && !visible.length && <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">Nothing to show here yet.</p>}
        <ol className="divide-y">
          {visible.slice(0, shown).map((r, i) => {
            const T = TONE[r.tone]; const Icon = T.icon;
            return <li key={i} className="flex gap-3 py-3">
              <span className={`mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${T.cls}`}><Icon className="h-4 w-4" /></span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="font-medium">{r.title}</span>
                  {r.amount != null && !Number.isNaN(r.amount) && <span className={"text-sm font-semibold " + (r.amount < 0 ? "text-emerald-600" : "")}>
                    {r.amount < 0 ? "−" + ngn(-r.amount) : ngn(r.amount)}</span>}
                </div>
                <p className="text-sm text-muted-foreground">{r.text}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{when(r.at)}
                  {r.reconstructed && <span title="This entry was rebuilt from your invoices and account records."> · from account records</span>}</p>
              </div>
            </li>;
          })}
        </ol>
        {visible.length > shown && <button type="button" onClick={() => setShown(shown + 20)}
          className="mt-2 w-full rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted">Show more</button>}
      </Card>

      <Card>
        <div className="mb-3 flex items-center gap-2"><FileText className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold">Turnitin invoices</h2></div>
        {!d.invoices.length ? <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">No invoices yet.</p> :
          <div className="overflow-x-auto rounded-xl border"><table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground"><tr>
              <th className="px-3 py-2 text-left">Invoice</th><th className="px-3 py-2 text-left">Issued</th>
              <th className="px-3 py-2 text-left">Checks</th><th className="px-3 py-2 text-left">Amount</th>
              <th className="px-3 py-2 text-left">Balance</th><th className="px-3 py-2 text-left">Status</th><th className="px-3 py-2"></th></tr></thead>
            <tbody>{d.invoices.map((inv) => <tr key={inv.id} className="border-t">
              <td className="px-3 py-2 font-mono text-xs">{shortRef(inv.invoiceRef)}</td>
              <td className="px-3 py-2 text-muted-foreground">{day(inv.issuedAt)}</td>
              <td className="px-3 py-2">{inv.fileCount}</td>
              <td className="px-3 py-2">{ngn(inv.billedNgn)}</td>
              <td className="px-3 py-2 font-medium">{ngn(inv.outstandingNgn)}</td>
              <td className="px-3 py-2"><span className={"rounded-full px-2 py-0.5 text-[11px] font-semibold " +
                (inv.status === "paid" ? "bg-emerald-500/10 text-emerald-600" : inv.status === "overdue" ? "bg-red-500/10 text-red-600" : "bg-muted")}>
                {INV_STATUS[inv.status] ?? inv.status}</span></td>
              <td className="px-3 py-2 text-right"><button type="button"
                onClick={() => downloadTopRatedInvoice(inv, d.customerName, d.totalOutstandingNgn)}
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                <Download className="h-3 w-3" /> PDF</button></td>
            </tr>)}</tbody></table></div>}
      </Card>
    </>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="mt-6 rounded-2xl border bg-card p-6 shadow-card">{children}</div>;
}
