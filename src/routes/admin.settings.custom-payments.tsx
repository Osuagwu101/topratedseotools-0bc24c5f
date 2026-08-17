import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Copy, CreditCard, ExternalLink, Info, Loader2, Plus, Power, PowerOff } from "lucide-react";
import { toast } from "sonner";
import { AdminShell } from "@/components/admin/AdminShell";
import {
  adminCreateCustomPaymentLink,
  adminGetCustomPaymentCurrencyOptions,
  adminListCustomPaymentLinks,
  adminSetCustomPaymentLinkStatus,
} from "@/lib/custom-payments.functions";
import { formatCustomPaymentMoney } from "@/lib/custom-payment-currency";

export const Route = createFileRoute("/admin/settings/custom-payments")({
  ssr: false,
  head: () => ({ meta: [{ title: "Custom Payments — Admin" }, { name: "robots", content: "noindex" }] }),
  component: Page,
});

const inputCls = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30";

function Page() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ["custom-payment-links"], queryFn: () => adminListCustomPaymentLinks() });
  const currenciesQuery = useQuery({ queryKey: ["custom-payment-currencies"], queryFn: () => adminGetCustomPaymentCurrencyOptions(), staleTime: 5 * 60_000 });
  const [title, setTitle] = useState("Custom Payment");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("NGN");
  const [description, setDescription] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [expiresHours, setExpiresHours] = useState("24");
  const [latestUrl, setLatestUrl] = useState<string | null>(null);

  const currencyOptions = currenciesQuery.data?.currencies ?? [];
  useEffect(() => {
    if (!currencyOptions.length) return;
    if (!currencyOptions.some((c) => c.code === currency)) setCurrency(currencyOptions[0].code);
  }, [currencyOptions, currency]);

  const create = useMutation({
    mutationFn: () => adminCreateCustomPaymentLink({ data: {
      title: title.trim(),
      amount: Number(amount),
      currency,
      description: description.trim() || null,
      recipient_name: recipientName.trim() || null,
      recipient_email: recipientEmail.trim() || null,
      expires_hours: expiresHours ? Number(expiresHours) : null,
    } }),
    onSuccess: async (r) => {
      setLatestUrl(r.payment_url);
      setAmount("");
      setDescription("");
      await qc.invalidateQueries({ queryKey: ["custom-payment-links"] });
      try {
        await navigator.clipboard.writeText(r.payment_url);
        toast.success("Payment link created and copied");
      } catch {
        toast.success("Payment link created");
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggle = useMutation({
    mutationFn: (d: { id: string; status: "active" | "disabled" }) => adminSetCustomPaymentLinkStatus({ data: d }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["custom-payment-links"] });
      toast.success("Payment link updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const copy = async (url: string) => {
    try { await navigator.clipboard.writeText(url); toast.success("Link copied"); }
    catch { toast.error("Copy failed"); }
  };
  const links = query.data?.links ?? [];
  const txs = query.data?.transactions ?? [];
  const numericAmount = Number(amount);
  const selectedCurrency = currencyOptions.find((c) => c.code === currency);

  return <AdminShell><section className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
    <div>
      <div className="flex items-center gap-2"><CreditCard className="h-6 w-6 text-primary"/><h1 className="text-2xl font-semibold">Custom Payments</h1></div>
      <p className="mt-1 text-sm text-muted-foreground">Create a one-time Paystack link for an agreed bill. Currency handling here is isolated from normal tool pricing and never grants tool access.</p>
    </div>

    <div className="grid gap-6 lg:grid-cols-[440px_1fr]">
      <div className="rounded-2xl border bg-card p-5 shadow-card">
        <h2 className="font-semibold">Create payment link</h2>
        <div className="mt-4 space-y-3">
          <F label="Title"><input className={inputCls} value={title} onChange={e=>setTitle(e.target.value)}/></F>
          <div className="grid grid-cols-[1fr_130px] gap-2">
            <F label="Amount"><input className={inputCls} type="number" min="0.01" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="2000"/></F>
            <F label="Currency">
              <select className={inputCls} value={currency} onChange={e=>setCurrency(e.target.value)} disabled={currenciesQuery.isLoading || !currencyOptions.length}>
                {currencyOptions.length ? currencyOptions.map(c => <option key={c.code} value={c.code}>{c.code}</option>) : <option value="NGN">NGN</option>}
              </select>
            </F>
          </div>

          <div className="rounded-xl border bg-muted/25 p-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Paystack currency view</div>
            <div className="mt-1 text-xl font-bold">{numericAmount > 0 ? formatCustomPaymentMoney(numericAmount, currency) : "Enter an amount"}</div>
            {selectedCurrency ? <div className="mt-1 text-xs text-muted-foreground">{selectedCurrency.name}{selectedCurrency.countries.length ? ` · Paystack availability: ${selectedCurrency.countries.join(", ")}` : ""}</div> : null}
            {currencyOptions.length > 1 ? <div className="mt-3 flex flex-wrap gap-1.5">{currencyOptions.filter(c=>c.code!==currency).map(c=><span key={c.code} className="rounded-full border bg-background px-2 py-1 text-[11px]">{c.code}</span>)}</div> : null}
            <div className="mt-3 flex gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 p-2.5 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600"/>
              <span><strong className="text-foreground">Paystack-only FX rule:</strong> Paystack’s public API provides supported currencies but does not expose a live FX quote endpoint for custom API integrations. No Google/XE/open.er-api rate is used here, so numeric equivalents in the other currencies are deliberately not invented.</span>
            </div>
          </div>

          {currenciesQuery.isError ? <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">Could not load Paystack currencies. {currenciesQuery.error instanceof Error ? currenciesQuery.error.message : "Try again."}</div> : null}
          <F label="Description (optional)"><textarea className={inputCls} rows={3} value={description} onChange={e=>setDescription(e.target.value)}/></F>
          <F label="Recipient name (optional)"><input className={inputCls} value={recipientName} onChange={e=>setRecipientName(e.target.value)}/></F>
          <F label="Recipient email (optional)"><input className={inputCls} type="email" value={recipientEmail} onChange={e=>setRecipientEmail(e.target.value)}/></F>
          <F label="Expires after (hours)"><input className={inputCls} type="number" min="1" max="720" value={expiresHours} onChange={e=>setExpiresHours(e.target.value)}/></F>
          <button onClick={()=>create.mutate()} disabled={create.isPending || currenciesQuery.isLoading || !title.trim() || !numericAmount || !currencyOptions.length} className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-gradient-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50">
            {create.isPending?<Loader2 className="h-4 w-4 animate-spin"/>:<Plus className="h-4 w-4"/>} Create & copy link
          </button>
        </div>
        {latestUrl && <div className="mt-4 rounded-xl border border-primary/30 bg-primary/5 p-3"><div className="text-xs font-semibold text-primary">READY TO SEND</div><div className="mt-1 break-all text-xs">{latestUrl}</div><div className="mt-2 flex gap-2"><button onClick={()=>copy(latestUrl)} className="rounded border px-2 py-1 text-xs"><Copy className="mr-1 inline h-3 w-3"/>Copy</button><a href={latestUrl} target="_blank" rel="noreferrer" className="rounded border px-2 py-1 text-xs"><ExternalLink className="mr-1 inline h-3 w-3"/>Open</a></div></div>}
      </div>

      <div className="rounded-2xl border bg-card p-5 shadow-card">
        <div className="flex justify-between"><h2 className="font-semibold">Payment links</h2><span className="text-xs text-muted-foreground">{links.length} total</span></div>
        {query.isLoading?<p className="mt-5 text-sm text-muted-foreground">Loading…</p>:links.length===0?<p className="mt-5 rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">No links yet.</p>:
        <div className="mt-4 space-y-3">{links.map((l:any)=>{const last=txs.find((t:any)=>t.link_id===l.id);return <div key={l.id} className="rounded-xl border p-4">
          <div className="flex justify-between gap-3"><div><div className="font-semibold">{l.title}</div><div className="text-sm font-bold">{formatCustomPaymentMoney(Number(l.amount), String(l.currency))}</div><div className="text-xs text-muted-foreground">{l.recipient_name||"Any recipient"}{l.recipient_email?` · ${l.recipient_email}`:""}</div></div><span className="h-fit rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold">{l.public_status}</span></div>
          <div className="mt-3 flex flex-wrap gap-2"><button onClick={()=>copy(l.payment_url)} className="rounded border px-2 py-1 text-xs"><Copy className="mr-1 inline h-3 w-3"/>Copy</button><a href={l.payment_url} target="_blank" rel="noreferrer" className="rounded border px-2 py-1 text-xs"><ExternalLink className="mr-1 inline h-3 w-3"/>Open</a>
          {l.public_status!=="paid"&&<button onClick={()=>toggle.mutate({id:l.id,status:l.status==="disabled"?"active":"disabled"})} className="rounded border px-2 py-1 text-xs">{l.status==="disabled"?<Power className="mr-1 inline h-3 w-3"/>:<PowerOff className="mr-1 inline h-3 w-3"/>}{l.status==="disabled"?"Enable":"Disable"}</button>}</div>
          {last&&<div className="mt-3 border-t pt-2 text-[11px] text-muted-foreground">Latest: {last.status} · {last.payer_email} · {formatCustomPaymentMoney(Number(last.amount), String(last.currency))} · <span className="font-mono">{last.reference}</span></div>}
          {l.paid_reference&&<div className="mt-1 text-[11px] text-emerald-700">Paid: <span className="font-mono">{l.paid_reference}</span></div>}
        </div>})}</div>}
      </div>
    </div>
  </section></AdminShell>;
}

function F({label,children}:{label:string;children:React.ReactNode}){return <label className="block"><span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>{children}</label>}
