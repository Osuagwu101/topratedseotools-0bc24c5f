import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CreditCard, Download, Receipt } from "lucide-react";
import { SiteLayout } from "@/components/site/SiteLayout";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/billing")({
  head: () => ({
    meta: [{ title: "Billing — Top Rated SEO Tools" }, { name: "robots", content: "noindex" }],
  }),
  component: BillingPage,
});

function BillingPage() {
  const { user } = Route.useRouteContext();

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
  const renewal = sub?.current_period_end
    ? new Date(sub.current_period_end).toLocaleDateString()
    : "—";

  return (
    <SiteLayout>
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
        <h1 className="text-3xl font-bold tracking-tight">Billing</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your subscription, payment method and invoices.
        </p>

        <div className="mt-6 rounded-2xl border bg-card p-6 shadow-card">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-sm text-muted-foreground">Current plan</div>
              <div className="mt-1 text-2xl font-bold capitalize">{plan}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                Status: <span className="capitalize">{status}</span> · Next renewal: {renewal}
              </div>
            </div>
            <Link
              to="/subscription"
              className="inline-flex items-center gap-2 rounded-md bg-gradient-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-glow hover:opacity-90"
            >
              Manage subscription
            </Link>
          </div>
        </div>

        <div className="mt-6 rounded-2xl border bg-card p-6 shadow-card">
          <div className="mb-3 flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Payment method</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            No payment method on file. Add one to upgrade to a paid plan.
          </p>
          <button className="mt-4 inline-flex items-center rounded-md border border-input px-4 py-2 text-sm font-medium hover:bg-muted">
            Add payment method
          </button>
        </div>

        <div className="mt-6 rounded-2xl border bg-card p-6 shadow-card">
          <div className="mb-3 flex items-center gap-2">
            <Receipt className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">Billing history</h2>
          </div>
          <div className="rounded-xl border border-dashed p-10 text-center">
            <Download className="mx-auto h-6 w-6 text-muted-foreground" />
            <p className="mt-2 text-sm text-muted-foreground">
              No invoices yet. They'll appear here after your first payment.
            </p>
          </div>
        </div>
      </div>
    </SiteLayout>
  );
}
