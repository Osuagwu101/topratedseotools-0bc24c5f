/**
 * My subscriptions — user-side view of every tool_orders row.
 * Approved rows = active access. Pending = awaiting admin confirmation.
 */
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { toast } from "sonner";
import { Clock, CheckCircle2, XCircle, PauseCircle } from "lucide-react";
import { SiteLayout } from "@/components/site/SiteLayout";
import { ToolBrandMark } from "@/components/tools/ToolBrandMark";
import { getTool } from "@/lib/tools-data";
import {
  listMyOrders,
  cancelMyOrder,
  type ToolOrderStatus,
} from "@/lib/access.functions";

const ordersQuery = queryOptions({
  queryKey: ["my-orders"],
  queryFn: () => listMyOrders(),
});

export const Route = createFileRoute("/_authenticated/orders")({
  head: () => ({
    meta: [
      { title: "My subscriptions — Top Rated SEO Tools" },
      { name: "robots", content: "noindex" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(ordersQuery),
  component: MyOrdersPage,
});

const STATUS: Record<
  ToolOrderStatus,
  { label: string; cls: string; icon: typeof Clock }
> = {
  pending: { label: "Pending confirmation", cls: "bg-warning/15 text-warning", icon: Clock },
  approved: { label: "Active", cls: "bg-success/15 text-success", icon: CheckCircle2 },
  rejected: { label: "Rejected", cls: "bg-destructive/10 text-destructive", icon: XCircle },
  cancelled: { label: "Cancelled", cls: "bg-muted text-muted-foreground", icon: PauseCircle },
  expired: { label: "Expired", cls: "bg-muted text-muted-foreground", icon: PauseCircle },
};

function MyOrdersPage() {
  const { data } = useSuspenseQuery(ordersQuery);
  const cancel = useServerFn(cancelMyOrder);
  const router = useRouter();

  async function onCancel(id: string) {
    try {
      await cancel({ data: { id } });
      toast.success("Order cancelled");
      router.invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not cancel");
    }
  }

  const now = Date.now();
  const orders = data.orders.map((o) => {
    const s: ToolOrderStatus =
      o.status === "approved" && o.expires_at && new Date(o.expires_at).getTime() < now
        ? "expired"
        : o.status;
    return { ...o, effectiveStatus: s };
  });

  return (
    <SiteLayout>
      <section className="mx-auto max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">My subscriptions</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Every tool you've requested. Approved subscriptions are ready to launch.
            </p>
          </div>
          <Link
            to="/tools"
            className="inline-flex items-center rounded-md bg-gradient-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-glow hover:opacity-90"
          >
            Browse tools
          </Link>
        </div>

        {orders.length === 0 ? (
          <div className="mt-10 rounded-2xl border border-dashed p-12 text-center">
            <p className="text-sm text-muted-foreground">
              You don't have any subscriptions yet.
            </p>
            <Link
              to="/tools"
              className="mt-4 inline-flex text-sm font-medium text-primary hover:underline"
            >
              Explore the tool catalog →
            </Link>
          </div>
        ) : (
          <ul className="mt-8 space-y-3">
            {orders.map((o) => {
              const tool = getTool(o.tool_slug);
              const meta = STATUS[o.effectiveStatus];
              const Icon = meta.icon;
              return (
                <li
                  key={o.id}
                  className="flex flex-wrap items-center gap-4 rounded-2xl border bg-card p-5 shadow-card"
                >
                  {tool ? (
                    <ToolBrandMark tool={tool} size="sm" />
                  ) : (
                    <div className="h-12 w-12 rounded-lg bg-muted" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{tool?.name ?? o.tool_slug}</span>
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${meta.cls}`}
                      >
                        <Icon className="h-3 w-3" /> {meta.label}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {o.price_label && `${o.price_label} · `}
                      {o.price_amount !== null
                        ? `${o.currency}${o.price_amount.toLocaleString()}`
                        : "Custom pricing"}
                      {" · "}
                      {new Date(o.created_at).toLocaleDateString()}
                      {o.expires_at && ` · until ${new Date(o.expires_at).toLocaleDateString()}`}
                    </div>
                    {o.admin_notes && (
                      <div className="mt-1 text-xs italic text-muted-foreground">
                        Admin note: {o.admin_notes}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {o.effectiveStatus === "approved" && tool && (
                      <Link
                        to="/tools/$slug"
                        params={{ slug: tool.slug }}
                        className="rounded-md bg-gradient-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-glow hover:opacity-90"
                      >
                        Launch
                      </Link>
                    )}
                    {o.effectiveStatus === "pending" && (
                      <button
                        onClick={() => onCancel(o.id)}
                        className="rounded-md border border-input px-3 py-1.5 text-xs font-medium hover:bg-muted"
                      >
                        Cancel
                      </button>
                    )}
                    {(o.effectiveStatus === "rejected" ||
                      o.effectiveStatus === "cancelled" ||
                      o.effectiveStatus === "expired") &&
                      tool && (
                        <Link
                          to="/order/$slug"
                          params={{ slug: tool.slug }}
                          className="rounded-md border border-input px-3 py-1.5 text-xs font-medium hover:bg-muted"
                        >
                          Order again
                        </Link>
                      )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </SiteLayout>
  );
}
