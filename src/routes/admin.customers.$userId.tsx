/**
 * Admin — single customer page. Shows details, assigned tools, active vs
 * expired subscriptions, online vs offline payments, admin notes, and audit
 * log. Admin can assign a new tool (offline payment), edit notes, or cancel
 * admin-assigned subscriptions without deleting payment history.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { AdminShell } from "@/components/admin/AdminShell";
import { AssignToolDialog } from "@/components/admin/AssignToolDialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  adminCancelAssignedOrder,
  adminGetCustomerDetail,
  adminResetCustomerPassword,
  adminUpdateCustomerMeta,
} from "@/lib/customer-admin.functions";
import { adminGetCustomerCommunicationHistory } from "@/lib/customer-communication.functions";
import { requireAdminOrRedirect } from "@/lib/admin-gate";
import { Wallet, XCircle, ShieldCheck, KeyRound, Mail } from "lucide-react";
import { Link } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/customers/$userId")({
  ssr: false,
  head: () => ({ meta: [{ title: "Customer — Admin" }, { name: "robots", content: "noindex" }] }),
  beforeLoad: async () => { await requireAdminOrRedirect(); },
  component: CustomerPage,
});

function money(n: number) { return "₦" + Math.round(n).toLocaleString(); }

function CustomerPage() {
  const { userId } = Route.useParams();
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["admin-customer", userId],
    queryFn: () => adminGetCustomerDetail({ data: { userId } }),
  });

  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [primed, setPrimed] = useState(false);
  if (data && !primed) {
    setPhone(data.meta?.phone ?? "");
    setNotes(data.meta?.adminNotes ?? "");
    setPrimed(true);
  }

  const saveMeta = useMutation({
    mutationFn: () => adminUpdateCustomerMeta({ data: { userId, phone, notes } }),
    onSuccess: () => { toast.success("Customer details saved"); refetch(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancel = useMutation({
    mutationFn: (orderId: string) =>
      adminCancelAssignedOrder({ data: { orderId, reason: "Cancelled by admin" } }),
    onSuccess: () => {
      toast.success("Subscription cancelled");
      qc.invalidateQueries({ queryKey: ["admin-customer", userId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <AdminShell>
      <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        {isLoading ? (
          <div className="rounded-2xl border bg-card p-10 text-center text-sm text-muted-foreground">
            Loading customer…
          </div>
        ) : error || !data ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
            {(error as Error | null)?.message ?? "Customer not found"}
          </div>
        ) : (
          <>
            <header className="mb-6 flex flex-wrap items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-primary text-primary-foreground shadow-glow">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <h1 className="truncate text-xl font-semibold">{data.profile.fullName ?? data.profile.email ?? "Customer"}</h1>
                <p className="text-xs text-muted-foreground">
                  {data.profile.email} · Registered {new Date(data.profile.registeredAt).toLocaleDateString()}
                </p>
              </div>
              <ResetPasswordButton userId={userId} />
              <AssignToolDialog userId={userId} onDone={() => refetch()} />
            </header>

            {/* Totals */}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard label="Total paid" value={money(data.totals.totalPaid)} />
              <StatCard label="Online (Paystack)" value={money(data.totals.onlinePaid)} />
              <StatCard label="Offline (manual)" value={money(data.totals.offlinePaid)} />
              <StatCard
                label="Active / expired"
                value={`${data.totals.activeSubscriptions} / ${data.totals.expiredSubscriptions}`}
              />
            </div>

            {/* Meta */}
            <div className="mt-6 rounded-2xl border bg-card p-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Customer details</h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                  <Label>Phone</Label>
                  <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
                </div>
                <div>
                  <Label>Last payment</Label>
                  <Input readOnly value={data.totals.lastPaymentAt ? new Date(data.totals.lastPaymentAt).toLocaleString() : "—"} />
                </div>
                <div className="sm:col-span-2">
                  <Label>Admin notes</Label>
                  <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
                </div>
              </div>
              <div className="mt-3">
                <Button size="sm" onClick={() => saveMeta.mutate()} disabled={saveMeta.isPending}>
                  {saveMeta.isPending ? "Saving…" : "Save details"}
                </Button>
              </div>
            </div>

            {/* Subscriptions */}
            <div className="mt-6 overflow-hidden rounded-2xl border bg-card">
              <div className="border-b p-3 text-sm font-semibold">Assigned tools & subscriptions</div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-left text-[11px] uppercase text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">Tool</th>
                      <th className="px-3 py-2">Access</th>
                      <th className="px-3 py-2">Period</th>
                      <th className="px-3 py-2">Origin</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Expires</th>
                      <th className="px-3 py-2 text-right">Amount</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {data.orders.map((o) => (
                      <tr key={o.id}>
                        <td className="px-3 py-2 font-medium">{o.toolSlug}</td>
                        <td className="px-3 py-2">{o.accessType ?? "—"}</td>
                        <td className="px-3 py-2">{o.billingPeriod ?? "—"}</td>
                        <td className="px-3 py-2">
                          <span className={o.origin === "offline"
                            ? "rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-semibold uppercase text-warning"
                            : "rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold uppercase text-primary"}>
                            {o.origin}
                          </span>
                        </td>
                        <td className="px-3 py-2">{o.status}{o.fulfilmentStatus === "pending" ? " · fulfil pending" : ""}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {o.expiresAt ? new Date(o.expiresAt).toLocaleDateString() : "—"}
                        </td>
                        <td className="px-3 py-2 text-right">{o.amount != null ? money(o.amount) : "—"}</td>
                        <td className="px-3 py-2 text-right">
                          {o.origin === "offline" && o.status === "approved" && (
                            <Button
                              size="sm" variant="ghost"
                              onClick={() => {
                                if (confirm("Cancel this admin-assigned subscription? Payment history will be kept.")) cancel.mutate(o.id);
                              }}
                            >
                              <XCircle className="h-3.5 w-3.5 mr-1" /> Cancel
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {data.orders.length === 0 && (
                      <tr><td colSpan={8} className="px-3 py-6 text-center text-xs text-muted-foreground">No subscriptions yet.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Payments */}
            <div className="mt-6 overflow-hidden rounded-2xl border bg-card">
              <div className="flex items-center justify-between border-b p-3">
                <div className="text-sm font-semibold flex items-center gap-1.5"><Wallet className="h-4 w-4" /> Payment history</div>
                <div className="text-[11px] text-muted-foreground">Records are kept — corrections do not delete history.</div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-left text-[11px] uppercase text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">Paid at</th>
                      <th className="px-3 py-2">Tool</th>
                      <th className="px-3 py-2">Source</th>
                      <th className="px-3 py-2">Method</th>
                      <th className="px-3 py-2">Type</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Reference</th>
                      <th className="px-3 py-2 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {data.payments.map((p) => (
                      <tr key={p.id}>
                        <td className="px-3 py-2 text-xs">{p.paidAt ? new Date(p.paidAt).toLocaleString() : "—"}</td>
                        <td className="px-3 py-2">{p.toolSlug}</td>
                        <td className="px-3 py-2">
                          <span className={p.source === "offline"
                            ? "rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-semibold uppercase text-warning"
                            : "rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold uppercase text-primary"}>
                            {p.source}
                          </span>
                        </td>
                        <td className="px-3 py-2">{p.paymentMethod ?? "—"}</td>
                        <td className="px-3 py-2">{p.paymentType}</td>
                        <td className="px-3 py-2">{p.status}</td>
                        <td className="px-3 py-2 text-xs">{p.referenceNote ?? "—"}</td>
                        <td className="px-3 py-2 text-right">{money(p.amount)}</td>
                      </tr>
                    ))}
                    {data.payments.length === 0 && (
                      <tr><td colSpan={8} className="px-3 py-6 text-center text-xs text-muted-foreground">No payments recorded.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Audit */}
            <div className="mt-6 rounded-2xl border bg-card p-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Admin audit log</h2>
              <ul className="mt-2 space-y-1.5 text-xs">
                {data.audit.map((a) => (
                  <li key={a.id} className="flex items-start gap-2">
                    <span className="text-muted-foreground min-w-32">{new Date(a.at).toLocaleString()}</span>
                    <span className="font-medium">{a.action}</span>
                    {a.details && <span className="text-muted-foreground truncate">{a.details}</span>}
                  </li>
                ))}
                {data.audit.length === 0 && <li className="text-xs text-muted-foreground">No admin activity yet.</li>}
              </ul>
            </div>

            {/* Communication history */}
            <CommunicationHistoryCard userId={userId} />
          </>
        )}
      </section>
    </AdminShell>
  );
}

function CommunicationHistoryCard({ userId }: { userId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["customer-comm-history", userId],
    queryFn: () => adminGetCustomerCommunicationHistory({ data: { userId, limit: 50 } }),
  });
  const rows = data?.messages ?? [];
  return (
    <div className="mt-6 overflow-hidden rounded-2xl border bg-card">
      <div className="flex items-center justify-between border-b p-3">
        <div className="text-sm font-semibold flex items-center gap-1.5">
          <Mail className="h-4 w-4" /> Communication history
        </div>
        <Link
          to="/admin/settings/communications"
          className="text-xs text-primary hover:underline"
        >
          Open Communication Centre →
        </Link>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-[11px] uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Subject</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((m) => (
              <tr key={m.id}>
                <td className="px-3 py-2 text-xs">{new Date(m.createdAt).toLocaleString()}</td>
                <td className="px-3 py-2 text-xs">{m.templateKey}</td>
                <td className="px-3 py-2 truncate max-w-[280px]">{m.subject ?? "—"}</td>
                <td className="px-3 py-2">
                  <span
                    className={
                      "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase " +
                      (m.status === "sent"
                        ? "bg-success/15 text-success"
                        : m.status === "failed"
                          ? "bg-destructive/15 text-destructive"
                          : m.status === "cancelled"
                            ? "bg-muted text-muted-foreground"
                            : "bg-warning/15 text-warning")
                    }
                  >
                    {m.status}
                  </span>
                </td>
              </tr>
            ))}
            {rows.length === 0 && !isLoading && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-xs text-muted-foreground">
                  No emails sent to this customer yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}



function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-card p-3 shadow-card">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold leading-tight">{value}</div>
    </div>
  );
}

function randomPassword(): string {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = new Uint32Array(14);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += chars[b % chars.length];
  return out + "!";
}

function ResetPasswordButton({ userId }: { userId: string }) {
  const [issued, setIssued] = useState<string | null>(null);
  const mut = useMutation({
    mutationFn: (pw: string) =>
      adminResetCustomerPassword({ data: { userId, temporaryPassword: pw } }),
    onSuccess: (_r, pw) => {
      setIssued(pw);
      toast.success("Temporary password issued");
    },
    onError: (e: Error) => toast.error(e.message),
  });
  if (issued) {
    return (
      <div className="flex flex-col items-end gap-1">
        <div className="rounded-md border bg-amber-500/10 px-2 py-1 font-mono text-xs">{issued}</div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(issued); toast.success("Copied"); }}>
            Copy
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setIssued(null)}>Hide</Button>
        </div>
        <p className="text-[10px] text-muted-foreground">Send securely — will not be shown again.</p>
      </div>
    );
  }
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={mut.isPending}
      onClick={() => {
        if (!confirm("Issue a new temporary password? The customer must change it on next sign-in.")) return;
        mut.mutate(randomPassword());
      }}
    >
      <KeyRound className="h-3.5 w-3.5 mr-1" /> {mut.isPending ? "Resetting…" : "Reset password"}
    </Button>
  );
}
