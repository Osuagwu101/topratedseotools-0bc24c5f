/**
 * Admin — order queue. Approve/reject/expire tool_orders rows.
 */
import { requireAdminOrRedirect } from "@/lib/admin-gate";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, XCircle, Clock, Inbox, ShieldAlert } from "lucide-react";
import { SiteLayout } from "@/components/site/SiteLayout";
import { getTool } from "@/lib/tools-data";
import { getIsAdmin } from "@/lib/site-settings.functions";
import {
  adminListOrders,
  adminUpdateOrder,
  adminFulfilPrivateOrder,
  type ToolOrderStatus,
} from "@/lib/access.functions";
import { AdminNav } from "./admin.tools";

const ordersQuery = queryOptions({
  queryKey: ["admin-orders"],
  queryFn: () => adminListOrders(),
});

export const Route = createFileRoute("/admin/orders")({
  ssr: false,
  beforeLoad: async () => { await requireAdminOrRedirect(); },
  head: () => ({
    meta: [
      { title: "Order queue — Admin — Top Rated SEO Tools" },
      { name: "robots", content: "noindex" },
    ],
  }),
  loader: async ({ context }) => {
    const [{ isAdmin }] = await Promise.all([
      getIsAdmin(),
      context.queryClient.ensureQueryData(ordersQuery),
    ]);
    return { isAdmin };
  },
  component: AdminOrdersPage,
});

function daysFromNow(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

const STATUS_FILTERS: (ToolOrderStatus | "all")[] = [
  "pending",
  "approved",
  "rejected",
  "cancelled",
  "expired",
  "all",
];

function AdminOrdersPage() {
  const { isAdmin } = Route.useLoaderData();
  const { data } = useSuspenseQuery(ordersQuery);
  const update = useServerFn(adminUpdateOrder);
  const fulfil = useServerFn(adminFulfilPrivateOrder);
  const router = useRouter();
  const [filter, setFilter] = useState<ToolOrderStatus | "all">("pending");
  const [busy, setBusy] = useState<string | null>(null);
  const [fulfilOpen, setFulfilOpen] = useState<string | null>(null);
  const [fulfilText, setFulfilText] = useState("");

  if (!isAdmin) {
    return (
      <SiteLayout>
        <div className="mx-auto max-w-md px-4 py-24 text-center">
          <ShieldAlert className="mx-auto h-10 w-10 text-muted-foreground" />
          <h1 className="mt-3 text-2xl font-semibold">Admins only</h1>
        </div>
      </SiteLayout>
    );
  }

  const filtered = useMemo(
    () => (filter === "all" ? data.orders : data.orders.filter((o) => o.status === filter)),
    [data.orders, filter],
  );

  async function act(
    id: string,
    patch: { status?: ToolOrderStatus; expires_at?: string | null; admin_notes?: string },
  ) {
    setBusy(id);
    try {
      await update({ data: { id, ...patch } });
      toast.success("Order updated");
      await router.invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusy(null);
    }
  }

  async function submitFulfil(id: string) {
    if (!fulfilText.trim()) {
      toast.error("Enter the private-account handover details first");
      return;
    }
    setBusy(id);
    try {
      await fulfil({ data: { id, admin_notes: fulfilText.trim() } });
      toast.success("Private access marked as fulfilled");
      setFulfilOpen(null);
      setFulfilText("");
      await router.invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Fulfilment failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <SiteLayout>
      <section className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-primary text-primary-foreground shadow-glow">
            <Inbox className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-semibold tracking-tight">Order queue</h1>
            <p className="text-sm text-muted-foreground">
              Approve or reject subscription requests. Approving grants access immediately.
            </p>
          </div>
          <AdminNav />
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                filter === f ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"
              }`}
            >
              {f}
              {f !== "all" && (
                <span className="ml-1 text-[10px] opacity-70">
                  ({data.orders.filter((o) => o.status === f).length})
                </span>
              )}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="mt-10 rounded-2xl border border-dashed p-12 text-center text-sm text-muted-foreground">
            No orders with status "{filter}".
          </div>
        ) : (
          <ul className="mt-6 space-y-3">
            {filtered.map((o) => {
              const tool = getTool(o.tool_slug);
              const isBusy = busy === o.id;
              return (
                <li
                  key={o.id}
                  className="rounded-2xl border bg-card p-5 shadow-card"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{tool?.name ?? o.tool_slug}</span>
                        {(o as any).access_type && (
                          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                            {(o as any).access_type}
                          </span>
                        )}
                        {(o as any).billing_period && (
                          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide capitalize">
                            {(o as any).billing_period}
                          </span>
                        )}
                        {(o as any).fulfilment_status === "pending_fulfilment" && (
                          <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning-foreground">
                            Awaiting private fulfilment
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {o.price_label && `${o.price_label} · `}
                        {o.price_amount !== null
                          ? `${o.currency}${o.price_amount.toLocaleString()}`
                          : "Custom pricing"}
                        {" · "}
                        {new Date(o.created_at).toLocaleString()}
                      </div>
                      <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                        user {o.user_id.slice(0, 8)}…
                      </div>
                      {o.notes && (
                        <div className="mt-2 rounded-lg bg-muted/50 p-2 text-xs">
                          <span className="font-medium">User note:</span> {o.notes}
                        </div>
                      )}
                      {o.admin_notes && (
                        <div className="mt-2 rounded-lg bg-primary/5 p-2 text-xs">
                          <span className="font-medium">Admin note:</span> {o.admin_notes}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <StatusBadge status={o.status} />
                      {o.expires_at && (
                        <div className="text-[11px] text-muted-foreground">
                          expires {new Date(o.expires_at).toLocaleDateString()}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {o.status === "pending" && (
                      <>
                        <button
                          onClick={() =>
                            act(o.id, { status: "approved", expires_at: daysFromNow(30) })
                          }
                          disabled={isBusy}
                          className="rounded-md bg-gradient-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-glow hover:opacity-90 disabled:opacity-60"
                        >
                          Approve · 30 days
                        </button>
                        <button
                          onClick={() =>
                            act(o.id, { status: "approved", expires_at: daysFromNow(365) })
                          }
                          disabled={isBusy}
                          className="rounded-md border border-input px-3 py-1.5 text-xs font-medium hover:bg-muted"
                        >
                          Approve · 1 year
                        </button>
                        <button
                          onClick={() => act(o.id, { status: "approved", expires_at: null })}
                          disabled={isBusy}
                          className="rounded-md border border-input px-3 py-1.5 text-xs font-medium hover:bg-muted"
                        >
                          Approve · lifetime
                        </button>
                        <button
                          onClick={() => act(o.id, { status: "rejected" })}
                          disabled={isBusy}
                          className="rounded-md border border-destructive/40 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10"
                        >
                          Reject
                        </button>
                      </>
                    )}
                    {o.status === "approved" && (
                      <>
                        <button
                          onClick={() => act(o.id, { status: "expired" })}
                          disabled={isBusy}
                          className="rounded-md border border-input px-3 py-1.5 text-xs font-medium hover:bg-muted"
                        >
                          Revoke access
                        </button>
                        <button
                          onClick={() =>
                            act(o.id, { expires_at: daysFromNow(30) })
                          }
                          disabled={isBusy}
                          className="rounded-md border border-input px-3 py-1.5 text-xs font-medium hover:bg-muted"
                        >
                          Extend +30 days
                        </button>
                      </>
                    )}
                    {o.status === "approved" &&
                      (o as any).access_type === "private" &&
                      (o as any).fulfilment_status === "pending_fulfilment" && (
                        <button
                          onClick={() => {
                            setFulfilOpen(fulfilOpen === o.id ? null : o.id);
                            setFulfilText(o.admin_notes ?? "");
                          }}
                          className="rounded-md bg-gradient-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-glow hover:opacity-90"
                        >
                          Assign private account
                        </button>
                      )}
                  </div>

                  {fulfilOpen === o.id && (
                    <div className="mt-4 rounded-lg border bg-muted/30 p-3">
                      <label className="text-xs font-medium text-muted-foreground">
                        Private-account handover (shown to customer)
                      </label>
                      <textarea
                        value={fulfilText}
                        onChange={(e) => setFulfilText(e.target.value)}
                        rows={4}
                        placeholder={"Email: private-user@example.com\nPassword: ••••••\nAny setup notes…"}
                        className="mt-1 w-full rounded-md border border-input bg-background p-2 text-xs"
                      />
                      <div className="mt-2 flex gap-2">
                        <button
                          onClick={() => submitFulfil(o.id)}
                          disabled={isBusy}
                          className="rounded-md bg-gradient-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-glow hover:opacity-90 disabled:opacity-60"
                        >
                          Mark fulfilled
                        </button>
                        <button
                          onClick={() => { setFulfilOpen(null); setFulfilText(""); }}
                          className="rounded-md border border-input px-3 py-1.5 text-xs font-medium hover:bg-muted"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </SiteLayout>
  );
}

function StatusBadge({ status }: { status: ToolOrderStatus }) {
  const cfg: Record<ToolOrderStatus, { label: string; cls: string; Icon: typeof Clock }> = {
    pending: { label: "Pending", cls: "bg-warning/15 text-warning", Icon: Clock },
    approved: { label: "Approved", cls: "bg-success/15 text-success", Icon: CheckCircle2 },
    rejected: { label: "Rejected", cls: "bg-destructive/10 text-destructive", Icon: XCircle },
    cancelled: { label: "Cancelled", cls: "bg-muted text-muted-foreground", Icon: XCircle },
    expired: { label: "Expired", cls: "bg-muted text-muted-foreground", Icon: Clock },
  };
  const { label, cls, Icon } = cfg[status];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls}`}
    >
      <Icon className="h-3 w-3" /> {label}
    </span>
  );
}
