import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, CreditCard, Loader2, ShieldCheck } from "lucide-react";
import { z } from "zod";
import { SiteLayout } from "@/components/site/SiteLayout";
import { APP_NAME } from "@/lib/site-config";
import { getCustomPaymentLink, initializeCustomPayment, verifyCustomPayment } from "@/lib/custom-payments.functions";

const searchSchema = z.object({ reference: z.string().optional(), trxref: z.string().optional() });

export const Route = createFileRoute("/pay/$token")({
  validateSearch: (s) => searchSchema.parse(s),
  loader: ({ params }) => getCustomPaymentLink({ data: { token: params.token } }),
  head: ({ loaderData }) => ({
    meta: [
      { title: `${loaderData?.title ?? "Custom Payment"} — ${APP_NAME}` },
      { name: "description", content: "Secure one-time payment via Paystack." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: CustomPaymentPage,
  errorComponent: () => (
    <SiteLayout>
      <div className="mx-auto max-w-lg px-4 py-24 text-center">
        <h1 className="text-2xl font-semibold">Payment link unavailable</h1>
        <p className="mt-2 text-sm text-muted-foreground">This link may be invalid or unavailable. Please contact the person who sent it to you.</p>
      </div>
    </SiteLayout>
  ),
});

function money(amount: number) {
  return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 2 }).format(amount);
}

function CustomPaymentPage() {
  const link = Route.useLoaderData();
  const { token } = Route.useParams();
  const search = Route.useSearch();
  const router = useRouter();
  const initPayment = useServerFn(initializeCustomPayment);
  const verifyPayment = useServerFn(verifyCustomPayment);
  const callbackReference = search.reference ?? search.trxref;

  const [payerName, setPayerName] = useState(link.recipient_name ?? "");
  const [payerEmail, setPayerEmail] = useState(link.recipient_email ?? "");
  const [busy, setBusy] = useState(false);
  const [verifyState, setVerifyState] = useState<"idle" | "checking" | "paid" | "error">(link.status === "paid" ? "paid" : "idle");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!callbackReference || link.status === "paid") return;
    let cancelled = false;
    setVerifyState("checking");
    verifyPayment({ data: { token, reference: callbackReference } })
      .then(async () => {
        if (cancelled) return;
        setVerifyState("paid");
        setMessage("Payment confirmed successfully.");
        await router.invalidate();
      })
      .catch((err) => {
        if (cancelled) return;
        setVerifyState("error");
        setMessage(err instanceof Error ? err.message : "Payment verification failed.");
      });
    return () => { cancelled = true; };
  }, [callbackReference, link.status, router, token, verifyPayment]);

  const effectiveStatus = verifyState === "paid" ? "paid" : link.status;
  const canPay = effectiveStatus === "active" && verifyState !== "checking";
  const expiryText = useMemo(() => link.expires_at ? new Date(link.expires_at).toLocaleString() : null, [link.expires_at]);

  async function pay() {
    if (!payerName.trim() || !payerEmail.trim()) {
      setMessage("Enter your name and email address to continue.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const result = await initPayment({ data: { token, payer_name: payerName.trim(), payer_email: payerEmail.trim() } });
      window.location.assign(result.authorization_url);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not start payment.");
      setBusy(false);
    }
  }

  return (
    <SiteLayout>
      <section className="bg-gradient-hero">
        <div className="mx-auto max-w-xl px-4 py-16 sm:px-6">
          <div className="rounded-3xl border bg-card p-6 shadow-card sm:p-8">
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-xl bg-primary/10 text-primary"><CreditCard className="h-5 w-5" /></div>
              <div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Custom Payment</p><h1 className="text-2xl font-bold tracking-tight">{link.title}</h1></div>
            </div>

            {link.description ? <p className="mt-5 whitespace-pre-line text-sm leading-6 text-muted-foreground">{link.description}</p> : null}

            <div className="mt-6 rounded-2xl border bg-background/50 p-5 text-center">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Amount due</div>
              <div className="mt-1 text-4xl font-bold tracking-tight">{money(link.amount_ngn)}</div>
              <div className="mt-1 text-xs text-muted-foreground">One-time payment · NGN</div>
            </div>

            {effectiveStatus === "paid" ? (
              <div className="mt-6 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-5 text-center">
                <CheckCircle2 className="mx-auto h-9 w-9 text-emerald-600" />
                <h2 className="mt-2 text-lg font-semibold">Payment received</h2>
                <p className="mt-1 text-sm text-muted-foreground">Thank you. This payment has been verified and recorded.</p>
                {callbackReference ? <p className="mt-2 break-all font-mono text-[11px] text-muted-foreground">Reference: {callbackReference}</p> : null}
              </div>
            ) : effectiveStatus === "disabled" || effectiveStatus === "expired" ? (
              <div className="mt-6 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm">
                {effectiveStatus === "expired" ? "This payment link has expired. Please ask the sender for a new link." : "This payment link has been disabled. Please contact the sender."}
              </div>
            ) : (
              <div className="mt-6 space-y-4">
                {verifyState === "checking" ? (
                  <div className="flex items-center justify-center gap-2 rounded-xl border p-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Confirming your payment with Paystack…</div>
                ) : (
                  <>
                    <div><label className="mb-1 block text-sm font-medium">Name</label><input value={payerName} onChange={(e) => setPayerName(e.target.value)} autoComplete="name" className="w-full rounded-md border border-input bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/30" placeholder="Your name" /></div>
                    <div><label className="mb-1 block text-sm font-medium">Email</label><input type="email" value={payerEmail} onChange={(e) => setPayerEmail(e.target.value)} autoComplete="email" className="w-full rounded-md border border-input bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/30" placeholder="you@example.com" /></div>
                    <button type="button" onClick={pay} disabled={busy || !canPay} className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-gradient-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-glow hover:opacity-90 disabled:opacity-60">
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                      {busy ? "Opening Paystack…" : `Pay ${money(link.amount_ngn)}`}
                    </button>
                  </>
                )}
              </div>
            )}

            {message && verifyState !== "paid" ? <p className={`mt-4 text-center text-sm ${verifyState === "error" ? "text-destructive" : "text-muted-foreground"}`}>{message}</p> : null}

            <div className="mt-6 border-t pt-4 text-center text-xs text-muted-foreground">
              <p className="inline-flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5" /> Secure payment processed by Paystack</p>
              {expiryText && effectiveStatus === "active" ? <p className="mt-1">Link expires {expiryText}</p> : null}
            </div>
          </div>
          <p className="mt-5 text-center text-xs text-muted-foreground">Payment page by <Link to="/" className="font-medium text-foreground hover:underline">{APP_NAME}</Link></p>
        </div>
      </section>
    </SiteLayout>
  );
}
