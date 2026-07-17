import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { SiteLayout } from "@/components/site/SiteLayout";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/subscription")({
  head: () => ({
    meta: [
      { title: "Subscription — Top Rated SEO Tools" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SubscriptionPage,
});

function SubscriptionPage() {
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

  return (
    <SiteLayout>
      <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
        <h1 className="text-3xl font-bold tracking-tight">Subscription</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Top Rated SEO Tools uses per-tool access. Head to{" "}
          <Link to="/tools" className="underline hover:text-foreground">Tools</Link>{" "}
          to purchase a tool, or{" "}
          <Link to="/orders" className="underline hover:text-foreground">My orders</Link>{" "}
          to view active subscriptions and login credentials.
        </p>

        <div className="mt-6 rounded-2xl border bg-card p-6 shadow-card">
          <div className="text-sm text-muted-foreground">Legacy plan record</div>
          <div className="mt-1 flex items-baseline gap-3">
            <div className="text-2xl font-bold capitalize">{plan}</div>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium capitalize">{status}</span>
          </div>

          <div className="mt-4 flex items-start gap-2 rounded-md bg-warning/10 p-3 text-xs text-warning-foreground">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            Plan changes are made automatically when a payment is confirmed by Paystack. Contact support if this record looks wrong.
          </div>
        </div>
      </div>
    </SiteLayout>
  );
}
