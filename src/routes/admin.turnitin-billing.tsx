import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { requireAdminOrRedirect } from "@/lib/admin-gate";
import {
  adminGetPostpaidBillingOverview, adminGetPostpaidStatement, adminGeneratePostpaidInvoice, adminSetPostpaidBillingSettings,
} from "@/lib/turnitin-postpaid-billing.functions";
import { adminRecordPostpaidPayment } from "@/lib/turnitin-postpaid-payments.functions";
import { monthlyPeriod } from "@/lib/turnitin-postpaid-billing";

export const Route = createFileRoute("/admin/turnitin-billing")({
  ssr: false,
  beforeLoad: async () => { await requireAdminOrRedirect(); },
  head: () => ({ meta: [{ title: "Turnitin Postpaid Billing — Admin" }, { name: "robots", content: "noindex" }] }),
  component: BillingPage,
});

const ngn = (v: unknown) => "₦" + Number(v ?? 0).toLocaleString();
const dt = (v: unknown) => (v ? new Date(String(v)).toLocaleString() : "—");
const STATE: Record<string, string> = { not_due: "Not yet due", due: "Due", partially_paid: "Partially paid",
  overdue: "Overdue", settled: "Settled", voided: "Voided" };
const TABS = ["Balances", "Invoices", "Statement", "Reconciliation", "Audit"] as const;
const lastMonth = () => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return monthlyPeriod(d); };

function BillingPage() {
  const q = useQuery({ queryKey: ["turnitin-postpaid-billing"], queryFn: () => adminGetPostpaidBillingOverview(), refetchInterval: 60000 });
  const [tab, setTab] = useState<(typeof TABS)[number]>("Balances");
  const d = q.data as any;
  const totals = useMemo(() => {
    const c = (d?.customers ?? []) as any[];
    return { customers: c.length, outstanding: c.reduce((t, x) => t + x.outstanding, 0),
      unallocated: c.reduce((t, x) => t + x.unallocated, 0),
      overdue: (d?.invoices ?? []).filter((i: any) => i.derived.state === "overdue").length,
      errors: (d?.exceptions ?? []).filter((e: any) => e.severity === "error").length };
  }, [d]);
  return (
    <AdminShell><main className="mx-auto max-w-[1500px] space-y-4 p-6">
      <header className="flex flex-wrap justify-between gap-3">
        <div><h1 className="text-2xl font-semibold">Turnitin Postpaid Billing</h1>
          <p className="text-sm text-muted-foreground">Balances, invoices, statements and reconciliation. Payment status always comes from recorded payments; nothing here marks an invoice paid.</p></div>
        <button className="rounded border px-3 py-2" onClick={() => void q.refetch()}>Refresh</button>
      </header>
      {q.isLoading && <p>Loading billing records…</p>}
      {q.error && <p role="alert" className="text-destructive">{q.error instanceof Error ? q.error.message : "Unable to load billing"}</p>}
      {d && <>
        {d.limited && <p className="text-amber-700">A 5,000-record limit was reached; totals may be incomplete.</p>}
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {[["Postpaid customers", totals.customers], ["Outstanding", ngn(totals.outstanding)], ["Unallocated payments", ngn(totals.unallocated)],
            ["Overdue invoices", totals.overdue], ["Reconciliation errors", totals.errors]].map(([k, v]) =>
            <div key={String(k)} className="rounded-lg border bg-card p-3"><p className="text-xs text-muted-foreground">{k}</p><p className="text-xl font-semibold">{v}</p></div>)}
        </section>
        <nav className="flex flex-wrap gap-2">{TABS.map((t) =>
          <button key={t} type="button" onClick={() => setTab(t)} className={"rounded border px-3 py-2 " + (tab === t ? "bg-primary text-primary-foreground" : "")}>{t}</button>)}</nav>
        {tab === "Balances" && <Balances d={d} onChanged={() => void q.refetch()} />}
        {tab === "Invoices" && <Invoices d={d} onChanged={() => void q.refetch()} />}
        {tab === "Statement" && <Statement d={d} />}
        {tab === "Reconciliation" && <Recon d={d} />}
        {tab === "Audit" && <Audit d={d} />}
        <p className="text-xs text-muted-foreground">Generated {dt(d.generatedAt)}.</p>
      </>}
    </main></AdminShell>
  );
}

function Table({ head, rows, empty }: { head: string[]; rows: React.ReactNode[][]; empty: string }) {
  return <div className="overflow-x-auto rounded-lg border"><table className="w-full text-left text-sm">
    <thead><tr>{head.map((h) => <th key={h} className="p-2">{h}</th>)}</tr></thead>
    <tbody>{rows.map((r, i) => <tr key={i} className="border-t">{r.map((c, j) => <td key={j} className="p-2 align-top">{c}</td>)}</tr>)}</tbody>
  </table>{!rows.length && <p className="p-4 text-center text-sm text-muted-foreground">{empty}</p>}</div>;
}

function Balances({ d, onChanged }: { d: any; onChanged: () => void }) {
  const [edit, setEdit] = useState<any>(null); const [dueDays, setDueDays] = useState(""); const [reason, setReason] = useState("");
  const save = useMutation({ mutationFn: () => adminSetPostpaidBillingSettings({ data: { userId: edit.userId, billingPeriod: "monthly",
    dueDays: dueDays.trim() === "" ? null : Number(dueDays), reason } }), onSuccess: () => { setEdit(null); onChanged(); } });
  const [pay, setPay] = useState<any>(null); const [amount, setAmount] = useState(""); const [note, setNote] = useState("");
  const [method, setMethod] = useState<"bank_transfer" | "whatsapp" | "offline" | "other">("bank_transfer");
  const amt = Number(amount || 0);
  const record = useMutation({ mutationFn: () => adminRecordPostpaidPayment({ data: { userId: pay.userId, amountNgn: amt, method, note } }),
    onSuccess: () => { setPay(null); onChanged(); } });
  return <section className="space-y-3">
    <Table head={["Customer", "Billed", "Paid", "Outstanding", "Open charges", "Voided", "Confirmed payments", "Unallocated", "Overdue invoices", "Billing", ""]}
      empty="No postpaid customers." rows={(d.customers as any[]).map((c) => [
        <span key="c">{c.email ?? c.name ?? c.userId.slice(0, 12)}</span>, ngn(c.billed), ngn(c.paid), <strong key="o">{ngn(c.outstanding)}</strong>,
        c.openCharges, c.voidedCharges, ngn(c.confirmedPayments), ngn(c.unallocated), c.overdueInvoices,
        `Monthly${c.dueDays == null ? ", no due date" : `, due in ${c.dueDays} days`}`,
        <span key="b" className="flex flex-wrap gap-1">
          {c.outstanding > 0 && <button className="rounded bg-primary px-2 py-1 text-primary-foreground" onClick={() => { setPay(c); setAmount(String(c.outstanding)); setMethod("bank_transfer"); setNote(""); record.reset(); setEdit(null); }}>Record payment</button>}
          <button className="rounded border px-2 py-1" onClick={() => { setEdit(c); setPay(null); setDueDays(c.dueDays == null ? "" : String(c.dueDays)); setReason(""); save.reset(); }}>Billing settings</button>
        </span>])} />
    {pay && <div className="space-y-2 rounded border-2 border-primary p-3 text-sm">
      <p className="font-semibold">Record a payment received outside the website — {pay.email ?? pay.userId}</p>
      <p>Currently owes <strong>{ngn(pay.outstanding)}</strong>. Enter the amount you actually received. It is applied to this customer's unpaid checks and cannot exceed what they owe.</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col">Amount received (₦)
          <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" aria-label="Amount received" className="w-40 rounded border bg-background p-2" /></label>
        <button type="button" className="rounded border px-2 py-2" onClick={() => setAmount(String(pay.outstanding))}>Full balance</button>
        <label className="flex flex-col">How they paid
          <select value={method} onChange={(e) => setMethod(e.target.value as any)} aria-label="Payment method" className="rounded border bg-background p-2">
            <option value="bank_transfer">Bank transfer</option><option value="whatsapp">WhatsApp arrangement</option>
            <option value="offline">Cash / offline</option><option value="other">Other</option></select></label>
      </div>
      <textarea value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note" placeholder="Note — e.g. bank name, transfer reference and date (required)" className="w-full rounded border bg-background p-2" />
      {amt > pay.outstanding && <p role="alert" className="text-destructive">That is more than the customer owes ({ngn(pay.outstanding)}).</p>}
      <div className="flex gap-2">
        <button className="rounded bg-primary px-3 py-2 text-primary-foreground" disabled={record.isPending || amt < 1 || amt > pay.outstanding || note.trim().length < 3} onClick={() => record.mutate()}>
          {record.isPending ? "Recording…" : `Record ${ngn(amt)} payment`}</button>
        <button className="rounded border px-3 py-2" onClick={() => setPay(null)}>Cancel</button>
      </div>
      {record.isError && <p role="alert" className="text-destructive">{record.error instanceof Error ? record.error.message : "Failed"}</p>}
    </div>}
    {record.data && !pay && <p role="status" className="rounded border border-green-600 p-2 text-sm">Payment of {ngn(record.data.amountNgn)} recorded. The balance above has been updated.</p>}
    {edit && <div className="space-y-2 rounded border p-3 text-sm">
      <p className="font-semibold">Billing settings for {edit.email ?? edit.userId}</p>
      <p className="text-muted-foreground">Billing period: monthly. Leave due days blank for no due date; invoices without a due date are never marked overdue. Only change this when it matches the customer's agreed terms.</p>
      <label className="block">Due days after period end <input value={dueDays} onChange={(e) => setDueDays(e.target.value)} inputMode="numeric" className="ml-2 w-24 rounded border bg-background p-1" aria-label="Due days" /></label>
      <textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required)" aria-label="Reason" className="w-full rounded border bg-background p-2" />
      <div className="flex gap-2"><button className="rounded bg-primary px-3 py-2 text-primary-foreground" disabled={save.isPending || reason.trim().length < 5} onClick={() => save.mutate()}>Save</button>
        <button className="rounded border px-3 py-2" onClick={() => setEdit(null)}>Cancel</button></div>
      {save.isError && <p role="alert" className="text-destructive">{save.error instanceof Error ? save.error.message : "Failed"}</p>}
    </div>}
    <h2 className="pt-2 text-lg font-semibold">Open charges</h2>
    <Table head={["Charged", "Customer", "Submission", "Rate at use", "Amount", "Paid", "Status"]} empty="No open charges."
      rows={(d.openCharges as any[]).map((c) => [dt(c.charged_at), c.email ?? c.user_id.slice(0, 12), <span key="j" className="font-mono text-xs">{String(c.job_id ?? "—").slice(0, 12)}</span>,
        ngn(c.rate_ngn), ngn(c.amount_ngn), ngn(c.paid_amount_ngn), c.status])} />
    <h2 className="pt-2 text-lg font-semibold">Confirmed payments</h2>
    <Table head={["Confirmed", "Customer", "Amount", "Allocated", "Method", "Reference"]} empty="No confirmed payments."
      rows={(d.settlements as any[]).map((s) => [dt(s.confirmed_at), s.email ?? s.user_id.slice(0, 12), ngn(s.amount_ngn), ngn(s.allocated_amount_ngn),
        s.method ?? s.payment_gateway ?? "—", <span key="r" className="break-all font-mono text-xs">{s.payment_reference ?? s.gateway_reference ?? "—"}</span>])} />
  </section>;
}

function Invoices({ d, onChanged }: { d: any; onChanged: () => void }) {
  const lm = lastMonth();
  const [userId, setUserId] = useState(""); const [start, setStart] = useState(lm.start); const [end, setEnd] = useState(lm.end); const [reason, setReason] = useState("");
  const gen = useMutation({ mutationFn: () => adminGeneratePostpaidInvoice({ data: { userId, periodStart: start, periodEnd: end, reason } }), onSuccess: () => onChanged() });
  return <section className="space-y-3">
    <div className="space-y-2 rounded border p-3 text-sm">
      <p className="font-semibold">Generate invoice</p>
      <p className="text-muted-foreground">Safe to repeat: if an invoice already exists for this customer and period, the existing one is returned. Voided charges are excluded and each line keeps the rate in force when the check was used.</p>
      <div className="flex flex-wrap gap-2">
        <select value={userId} onChange={(e) => setUserId(e.target.value)} aria-label="Customer" className="rounded border bg-background p-2">
          <option value="">Choose customer…</option>{(d.customers as any[]).map((c) => <option key={c.userId} value={c.userId}>{c.email ?? c.userId}</option>)}</select>
        <input type="date" value={start} onChange={(e) => setStart(e.target.value)} aria-label="Period start" className="rounded border bg-background p-2" />
        <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} aria-label="Period end (exclusive)" className="rounded border bg-background p-2" />
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" aria-label="Reason" className="min-w-[220px] flex-1 rounded border bg-background p-2" />
        <button className="rounded bg-primary px-3 py-2 text-primary-foreground" disabled={!userId || reason.trim().length < 5 || gen.isPending} onClick={() => gen.mutate()}>{gen.isPending ? "Working…" : "Generate"}</button>
      </div>
      <p className="text-xs text-muted-foreground">Period end is exclusive (e.g. 1 Oct to 1 Nov covers October).</p>
      {gen.isError && <p role="alert" className="text-destructive">{gen.error instanceof Error ? gen.error.message : "Failed"}</p>}
      {gen.data && <p role="status">Invoice {gen.data.invoice?.invoice_ref ?? ""} ready — {ngn(gen.data.invoice?.amount_due_ngn)}.</p>}
    </div>
    <Table head={["Invoice", "Customer", "Period", "Lines", "Billed", "Paid", "Outstanding", "Status", "Issued", "Due"]} empty="No invoices yet."
      rows={(d.invoices as any[]).map((i) => [<span key="r" className="font-mono text-xs">{i.invoice_ref}</span>, i.email ?? i.user_id.slice(0, 12),
        `${i.period_start} → ${i.period_end}`, i.lineCount, ngn(i.derived.billed), ngn(i.derived.paid), ngn(i.derived.outstanding),
        <strong key="s" className={i.derived.state === "overdue" ? "text-destructive" : ""}>{STATE[i.derived.state] ?? i.derived.state}</strong>, dt(i.issued_at), i.due_at ? dt(i.due_at) : "No due date"])} />
  </section>;
}

function Statement({ d }: { d: any }) {
  const cm = monthlyPeriod(new Date());
  const [userId, setUserId] = useState(""); const [from, setFrom] = useState(cm.start); const [to, setTo] = useState(cm.end);
  const st = useMutation({ mutationFn: () => adminGetPostpaidStatement({ data: { userId, from, to } }) });
  const s = st.data as any;
  return <section className="space-y-3">
    <div className="flex flex-wrap gap-2">
      <select value={userId} onChange={(e) => setUserId(e.target.value)} aria-label="Customer" className="rounded border bg-background p-2">
        <option value="">Choose customer…</option>{(d.customers as any[]).map((c) => <option key={c.userId} value={c.userId}>{c.email ?? c.userId}</option>)}</select>
      <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" className="rounded border bg-background p-2" />
      <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To (exclusive)" className="rounded border bg-background p-2" />
      <button className="rounded border px-3 py-2" disabled={!userId || st.isPending} onClick={() => st.mutate()}>Show statement</button>
    </div>
    {st.isError && <p role="alert" className="text-destructive">{st.error instanceof Error ? st.error.message : "Failed"}</p>}
    {s && <div className="space-y-3 rounded border p-4">
      <p className="font-semibold">Statement — {s.customer.email ?? s.customer.id} · {s.period.from} to {s.period.to} (end exclusive)</p>
      <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-6">
        {[["Opening balance", s.openingBalance], ["Charges", s.charges], ["Payments", s.payments], ["Voided", s.voids], ["Closing balance", s.closingBalance], ["Outstanding", s.outstanding]]
          .map(([k, v]) => <div key={String(k)} className="rounded border p-2"><p className="text-xs text-muted-foreground">{k}</p><p className="font-semibold">{ngn(v)}</p></div>)}
      </div>
      <Table head={["Date", "Submission", "Rate at use", "Amount", "Paid", "Status", "Voided"]} empty="No usage in this period."
        rows={(s.chargeLines as any[]).map((c) => [dt(c.charged_at), <span key="j" className="font-mono text-xs">{String(c.upstream_submission_id ?? c.job_id ?? "—")}</span>,
          ngn(c.rate_ngn), ngn(c.amount_ngn), ngn(c.paid_amount_ngn), c.status, c.voided_at ? `${dt(c.voided_at)}${c.void_reason ? " — " + c.void_reason : ""}` : "—"])} />
      <Table head={["Confirmed", "Amount", "Allocated", "Method", "Reference"]} empty="No payments in this period."
        rows={(s.paymentLines as any[]).map((p) => [dt(p.confirmed_at), ngn(p.amount_ngn), ngn(p.allocated_amount_ngn), p.method ?? p.payment_gateway ?? "—",
          <span key="r" className="break-all font-mono text-xs">{p.payment_reference ?? p.gateway_reference ?? "—"}</span>])} />
      <button className="rounded border px-3 py-2" onClick={() => window.print()}>Print</button>
    </div>}
  </section>;
}

function Recon({ d }: { d: any }) {
  const ex = d.exceptions as any[];
  return <section className="space-y-2">
    <p className="text-sm text-muted-foreground">Read-only checks across charges, payments, allocations and invoices. Investigate the source records before correcting anything; corrections are made through the existing settlement and void controls on the customer page, which are audited.</p>
    {!ex.some((e) => e.severity === "error") && <p role="status" className="font-semibold">No reconciliation errors. {ex.length ? `${ex.length} informational item(s).` : ""}</p>}
    <Table head={["Severity", "Check", "Customer", "Record", "Detail"]} empty="Everything reconciles."
      rows={ex.map((e) => [<strong key="s" className={e.severity === "error" ? "text-destructive" : ""}>{e.severity}</strong>, e.kind.replace(/_/g, " "),
        e.userId ? <a key="u" className="underline" href={`/admin/customers/${e.userId}`}>{e.userId.slice(0, 12)}</a> : "—",
        <span key="r" className="font-mono text-xs">{String(e.ref).slice(0, 18)}</span>, e.detail])} />
  </section>;
}

function Audit({ d }: { d: any }) {
  return <Table head={["When", "Admin", "Action", "Target", "Result", "Reason"]} empty="No billing actions recorded yet."
    rows={(d.audit as any[]).map((a) => [dt(a.created_at), a.actor_email ?? String(a.actor_user_id ?? "").slice(0, 12), a.action.replace(/_/g, " "),
      `${a.target_type ?? ""} ${String(a.target_id ?? "").slice(0, 12)}`, a.success ? "OK" : "Failed", a.reason ?? "—"])} />;
}
