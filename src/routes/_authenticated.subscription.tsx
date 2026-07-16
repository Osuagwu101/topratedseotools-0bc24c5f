import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, ArrowUpRight, Pause, Play, XCircle } from "lucide-react";
import { SiteLayout } from "@/components/site/SiteLayout";
import { supabase } from "@/integrations/supabase/client";
import { PRICING_PLANS } from "@/lib/pricing-data";

export const Route = createFileRoute("/_authenticated/subscription")({
  head: () => ({
    meta: [
      { title: "Subscription — Nexus AI" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SubscriptionPage,
});

function SubscriptionPage() {
  const { user } = Route.useRouteContext();
  const qc = useQueryClient();

  const { data: sub } = useQuery({
    queryKey: ["subscription", user.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_subscriptions")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();
      return data;
    },
  });

  const plan = sub?.plan ?? "free";
  const status = sub?.status ?? "inactive";

  async function setStatus(newStatus: string) {
    const payload = {
      user_id: user.id,
      plan,
      status: newStatus,
    };
    const { error } = await supabase.from("user_subscriptions").upsert(payload, { onConflict: "user_id" });
    if (error) return toast.error(error.message);
    toast.success("Subscription updated");
    qc.invalidateQueries({ queryKey: ["subscription", user.id] });
  }

  return (
    <SiteLayout>
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
        <h1 className="text-3xl font-bold tracking-tight">Manage subscription</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Upgrade, downgrade, pause or cancel your plan.
        </p>

        <div className="mt-6 rounded-2xl border bg-card p-6 shadow-card">
          <div className="text-sm text-muted-foreground">Currently on</div>
          <div className="mt-1 flex items-baseline gap-3">
            <div className="text-2xl font-bold capitalize">{plan}</div>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium capitalize">{status}</span>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            {status !== "canceled" && (
              <button
                onClick={() => setStatus("canceled")}
                className="inline-flex items-center gap-1.5 rounded-md border border-destructive/30 px-3 py-2 text-sm font-medium text-destructive hover:bg-destructive/10"
              >
                <XCircle className="h-4 w-4" /> Cancel subscription
              </button>
            )}
            {status === "canceled" && (
              <button
                onClick={() => setStatus("active")}
                className="inline-flex items-center gap-1.5 rounded-md border border-input px-3 py-2 text-sm font-medium hover:bg-muted"
              >
                <Play className="h-4 w-4" /> Resume subscription
              </button>
            )}
            {status === "active" && (
              <button
                onClick={() => setStatus("paused")}
                className="inline-flex items-center gap-1.5 rounded-md border border-input px-3 py-2 text-sm font-medium hover:bg-muted"
              >
                <Pause className="h-4 w-4" /> Pause billing
              </button>
            )}
          </div>

          {status === "canceled" && (
            <div className="mt-4 flex items-start gap-2 rounded-md bg-warning/10 p-3 text-xs text-warning-foreground">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              Your subscription is canceled. You'll keep access until the end of the current billing period.
            </div>
          )}
        </div>

        <h2 className="mt-10 text-xl font-semibold">Change plan</h2>
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          {PRICING_PLANS.map((p) => {
            const isCurrent = p.id === plan;
            return (
              <div key={p.id} className="flex flex-col rounded-2xl border bg-card p-6 shadow-card">
                <div className="text-lg font-semibold">{p.name}</div>
                <div className="mt-1 text-sm text-muted-foreground">{p.tagline}</div>
                <div className="mt-4 text-3xl font-bold">${p.monthly}<span className="text-sm font-normal text-muted-foreground">/mo</span></div>
                <button
                  disabled={isCurrent}
                  onClick={() =>
                    supabase
                      .from("user_subscriptions")
                      .upsert(
                        { user_id: user.id, plan: p.id, status: "active" },
                        { onConflict: "user_id" },
                      )
                      .then(() => {
                        toast.success(`Switched to ${p.name}`);
                        qc.invalidateQueries({ queryKey: ["subscription", user.id] });
                      })
                  }
                  className="mt-6 inline-flex items-center justify-center gap-1.5 rounded-md bg-gradient-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-glow hover:opacity-90 disabled:opacity-50"
                >
                  {isCurrent ? "Current plan" : <>Switch to {p.name} <ArrowUpRight className="h-4 w-4" /></>}
                </button>
              </div>
            );
          })}
        </div>

        <p className="mt-8 text-xs text-muted-foreground">
          Payments are processed via Stripe. See{" "}
          <Link to="/billing" className="underline hover:text-foreground">Billing</Link> for invoices and payment methods.
        </p>
      </div>
    </SiteLayout>
  );
}
