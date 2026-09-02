/**
 * Phase 5 — Customer Communication Centre.
 *
 * Search customers, view their message history, send a manual email or a
 * custom announcement, and act on expiring / renewal-failed subscriptions.
 * Uses the existing email queue so history and delivery status are captured
 * in the same place as system emails.
 */
import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AdminShell } from "@/components/admin/AdminShell";
import { requireAdminOrRedirect } from "@/lib/admin-gate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search, Send, Clock, AlertTriangle, User2, RefreshCw } from "lucide-react";
import {
  adminSearchCustomersLite,
  adminGetCustomerCommunicationHistory,
  adminSendManualEmail,
  adminResendPastEmail,
  adminListExpiringSubscriptions,
  adminExtendOrderExpiry,
  adminListCustomerSegment,
} from "@/lib/customer-communication.functions";
import { adminListEmailTemplates } from "@/lib/email/settings.functions";

export const Route = createFileRoute("/admin/settings/communications")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Customer Communications — Admin" }, { name: "robots", content: "noindex" }],
  }),
  beforeLoad: async () => {
    await requireAdminOrRedirect();
  },
  component: () => (
    <AdminShell>
      <CommunicationsPage />
    </AdminShell>
  ),
});

type Customer = {
  userId: string;
  email: string | null;
  fullName: string | null;
  registeredAt: string;
};

function CommunicationsPage() {
  const [selected, setSelected] = useState<Customer | null>(null);

  return (
    <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Customer communications</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Search customers, review their message history, and send announcements, access reminders,
          or receipts. Emails route through the same queue as system emails.
        </p>
      </header>

      <Tabs defaultValue="centre" className="space-y-4">
        <TabsList>
          <TabsTrigger value="centre">Communication Centre</TabsTrigger>
          <TabsTrigger value="expiring">Expiring & renewals</TabsTrigger>
          <TabsTrigger value="segments">Segments</TabsTrigger>
        </TabsList>

        <TabsContent value="centre">
          <div className="grid gap-4 md:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
            <CustomerPicker selected={selected} onSelect={setSelected} />
            <div className="space-y-4">
              {selected ? (
                <>
                  <CustomerHeader customer={selected} />
                  <SendPanel customer={selected} />
                  <HistoryPanel customer={selected} />
                </>
              ) : (
                <div className="rounded-2xl border bg-card p-10 text-center text-sm text-muted-foreground">
                  Search for a customer on the left to view their message history and send emails.
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="expiring">
          <ExpiringTab onOpenCustomer={setSelected} />
        </TabsContent>

        <TabsContent value="segments">
          <SegmentsTab onOpenCustomer={setSelected} />
        </TabsContent>
      </Tabs>
    </section>
  );
}

// ---------------------------------------------------------------- Picker

function CustomerPicker({
  selected,
  onSelect,
}: {
  selected: Customer | null;
  onSelect: (c: Customer) => void;
}) {
  const [q, setQ] = useState("");
  const { data, isFetching } = useQuery({
    queryKey: ["comms-customer-search", q],
    queryFn: () => adminSearchCustomersLite({ data: { query: q } }),
  });
  const list = data?.customers ?? [];
  return (
    <div className="rounded-2xl border bg-card">
      <div className="border-b p-3">
        <div className="flex items-center gap-2 rounded-md border bg-background px-2 py-1.5">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name or email…"
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {isFetching ? "Searching…" : `${list.length} match${list.length === 1 ? "" : "es"}`}
        </p>
      </div>
      <ul className="max-h-[420px] divide-y overflow-y-auto">
        {list.map((c) => (
          <li key={c.userId}>
            <button
              type="button"
              onClick={() => onSelect(c)}
              className={
                "w-full px-3 py-2 text-left text-sm hover:bg-muted/50 " +
                (selected?.userId === c.userId ? "bg-muted/60" : "")
              }
            >
              <div className="font-medium truncate">{c.fullName ?? "—"}</div>
              <div className="text-xs text-muted-foreground truncate">{c.email ?? "—"}</div>
            </button>
          </li>
        ))}
        {list.length === 0 && !isFetching && (
          <li className="p-4 text-center text-xs text-muted-foreground">No customers match.</li>
        )}
      </ul>
    </div>
  );
}

function CustomerHeader({ customer }: { customer: Customer }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-card p-4">
      <div className="flex items-center gap-3 min-w-0">
        <div className="grid h-10 w-10 place-items-center rounded-lg bg-primary/15 text-primary">
          <User2 className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{customer.fullName ?? "—"}</div>
          <div className="truncate text-xs text-muted-foreground">{customer.email ?? "—"}</div>
        </div>
      </div>
      <Link
        to="/admin/customers/$userId"
        params={{ userId: customer.userId }}
        className="text-xs text-primary hover:underline"
      >
        Open full profile →
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------- Send panel

function SendPanel({ customer }: { customer: Customer }) {
  const qc = useQueryClient();
  const { data: tplData } = useQuery({
    queryKey: ["email-templates-min"],
    queryFn: () => adminListEmailTemplates(),
  });
  const templates = (tplData?.templates ?? []) as Array<{
    key: string;
    name: string;
    enabled: boolean;
  }>;

  const [mode, setMode] = useState<"announcement" | "template">("announcement");
  const [templateKey, setTemplateKey] = useState<string>("payment_success");
  const [subject, setSubject] = useState<string>("");
  const [body, setBody] = useState<string>("");

  const send = useMutation({
    mutationFn: () =>
      adminSendManualEmail({
        data:
          mode === "announcement"
            ? {
                userId: customer.userId,
                templateKey: "admin_manual",
                subject,
                bodyHtml: body,
              }
            : { userId: customer.userId, templateKey },
      }),
    onSuccess: (r) => {
      if (r.ok) toast.success("Queued for delivery");
      else toast.warning(`Not queued: ${r.skipped ?? "unknown"}`);
      setSubject("");
      setBody("");
      qc.invalidateQueries({ queryKey: ["comms-history", customer.userId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const quickTemplates = useMemo(
    () =>
      templates.filter((t) =>
        ["payment_success", "private_fulfilled", "renewal_success", "customer_invite"].includes(
          t.key,
        ),
      ),
    [templates],
  );

  return (
    <div className="rounded-2xl border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Send an email
        </h2>
        <div className="flex gap-1 rounded-md border p-0.5 text-xs">
          <button
            className={
              "rounded px-2 py-1 " +
              (mode === "announcement" ? "bg-primary text-primary-foreground" : "")
            }
            onClick={() => setMode("announcement")}
          >
            Announcement
          </button>
          <button
            className={
              "rounded px-2 py-1 " +
              (mode === "template" ? "bg-primary text-primary-foreground" : "")
            }
            onClick={() => setMode("template")}
          >
            Resend template
          </button>
        </div>
      </div>

      {mode === "announcement" ? (
        <div className="mt-3 space-y-3">
          <div>
            <Label>Subject</Label>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="e.g. Your Canva Pro access has been updated"
            />
          </div>
          <div>
            <Label>Message (HTML allowed)</Label>
            <Textarea
              rows={7}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="<p>Hi {{name}}, …</p>"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              You can use <code>{"{{name}}"}</code>. Basic HTML like &lt;p&gt;, &lt;strong&gt;,
              &lt;a&gt; is supported.
            </p>
          </div>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <div>
            <Label>Template</Label>
            <select
              value={templateKey}
              onChange={(e) => setTemplateKey(e.target.value)}
              className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            >
              {templates
                .filter((t) => t.key !== "admin_manual")
                .map((t) => (
                  <option key={t.key} value={t.key} disabled={!t.enabled}>
                    {t.name} {t.enabled ? "" : "(disabled)"}
                  </option>
                ))}
            </select>
            <p className="mt-1 text-[11px] text-muted-foreground">
              The template will render with whatever data is on file for this customer. Best for
              resending welcome / receipt / access-info emails.
            </p>
          </div>
          {quickTemplates.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {quickTemplates.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTemplateKey(t.key)}
                  className={
                    "rounded-full border px-2 py-0.5 text-[11px] " +
                    (templateKey === t.key ? "border-primary bg-primary/10 text-primary" : "")
                  }
                >
                  {t.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mt-4 flex justify-end">
        <Button
          onClick={() => send.mutate()}
          disabled={
            send.isPending || (mode === "announcement" && (!subject.trim() || !body.trim()))
          }
        >
          <Send className="mr-1.5 h-3.5 w-3.5" />
          {send.isPending ? "Sending…" : "Send email"}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- History

function HistoryPanel({ customer }: { customer: Customer }) {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["comms-history", customer.userId],
    queryFn: () => adminGetCustomerCommunicationHistory({ data: { userId: customer.userId } }),
  });
  const resend = useMutation({
    mutationFn: (messageId: string) => adminResendPastEmail({ data: { messageId } }),
    onSuccess: (r) => {
      if (r.ok) toast.success("Re-queued for delivery");
      else toast.warning(`Not queued: ${r.skipped ?? "unknown"}`);
      refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const rows = data?.messages ?? [];
  return (
    <div className="overflow-hidden rounded-2xl border bg-card">
      <div className="flex items-center justify-between border-b p-3">
        <div className="text-sm font-semibold">Communication history</div>
        <Button size="sm" variant="ghost" onClick={() => refetch()}>
          <RefreshCw className="mr-1 h-3.5 w-3.5" /> Refresh
        </Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-[11px] uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Subject</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((m) => (
              <tr key={m.id}>
                <td className="px-3 py-2 text-xs">{new Date(m.createdAt).toLocaleString()}</td>
                <td className="px-3 py-2">{m.templateKey}</td>
                <td className="px-3 py-2">
                  <div className="truncate max-w-[280px]">{m.subject ?? "—"}</div>
                  {m.lastError && <div className="text-[11px] text-destructive">{m.lastError}</div>}
                </td>
                <td className="px-3 py-2">
                  <StatusPill status={m.status} />
                </td>
                <td className="px-3 py-2 text-right">
                  <Button size="sm" variant="ghost" onClick={() => resend.mutate(m.id)}>
                    Resend
                  </Button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && !isLoading && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-xs text-muted-foreground">
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

function StatusPill({ status }: { status: string }) {
  const cls =
    status === "sent"
      ? "bg-success/15 text-success"
      : status === "failed"
        ? "bg-destructive/15 text-destructive"
        : status === "cancelled"
          ? "bg-muted text-muted-foreground"
          : "bg-warning/15 text-warning";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase ${cls}`}>
      {status}
    </span>
  );
}

// ---------------------------------------------------------------- Expiring

function ExpiringTab({ onOpenCustomer }: { onOpenCustomer: (c: Customer) => void }) {
  const [days, setDays] = useState(7);
  const [mode, setMode] = useState<"expiring" | "renewal_failed">("expiring");
  const { data, isFetching, refetch } = useQuery({
    queryKey: ["comms-expiring", mode, days],
    queryFn: () =>
      adminListExpiringSubscriptions({
        data: mode === "renewal_failed" ? { renewalFailed: true } : { withinDays: days },
      }),
  });
  const send = useMutation({
    mutationFn: (row: { userId: string }) =>
      adminSendManualEmail({
        data: {
          userId: row.userId,
          templateKey: "admin_manual",
          subject: "Your subscription is about to expire",
          bodyHtml:
            '<p>Hi {{name}},</p><p>Your subscription is expiring soon. Renew now to keep uninterrupted access to your tools.</p><p><a href="https://topratedseotools.com/dashboard">Open dashboard</a></p>',
        },
      }),
    onSuccess: (r) =>
      r.ok ? toast.success("Reminder queued") : toast.warning(`Not queued: ${r.skipped}`),
    onError: (e: Error) => toast.error(e.message),
  });
  const extend = useMutation({
    mutationFn: (v: { orderId: string; days: number }) => adminExtendOrderExpiry({ data: v }),
    onSuccess: () => {
      toast.success("Access extended");
      refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const rows = data?.orders ?? [];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-md border p-0.5 text-xs">
          <button
            className={
              "rounded px-2 py-1 " +
              (mode === "expiring" ? "bg-primary text-primary-foreground" : "")
            }
            onClick={() => setMode("expiring")}
          >
            Expiring soon
          </button>
          <button
            className={
              "rounded px-2 py-1 " +
              (mode === "renewal_failed" ? "bg-primary text-primary-foreground" : "")
            }
            onClick={() => setMode("renewal_failed")}
          >
            Renewal failed
          </button>
        </div>
        {mode === "expiring" && (
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="rounded-md border bg-background px-2 py-1.5 text-sm"
          >
            <option value={3}>Within 3 days</option>
            <option value={7}>Within 7 days</option>
            <option value={14}>Within 14 days</option>
            <option value={30}>Within 30 days</option>
          </select>
        )}
        <div className="ml-auto text-xs text-muted-foreground">
          {isFetching ? "Loading…" : `${rows.length} matches`}
        </div>
      </div>
      <div className="overflow-hidden rounded-2xl border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-[11px] uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Customer</th>
                <th className="px-3 py-2">Tool</th>
                <th className="px-3 py-2">Access</th>
                <th className="px-3 py-2">Expires</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2">
                    <button
                      onClick={() =>
                        onOpenCustomer({
                          userId: r.userId,
                          email: r.email,
                          fullName: r.fullName,
                          registeredAt: new Date().toISOString(),
                        })
                      }
                      className="text-left"
                    >
                      <div className="font-medium hover:underline">{r.fullName ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">{r.email ?? "—"}</div>
                    </button>
                  </td>
                  <td className="px-3 py-2">{r.toolSlug}</td>
                  <td className="px-3 py-2 text-xs">
                    {r.accessType ?? "—"} · {r.billingPeriod ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {r.expiresAt ? new Date(r.expiresAt).toLocaleDateString() : "—"}
                    {r.renewalStatus === "failed" && (
                      <span className="ml-1 rounded-full bg-destructive/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-destructive">
                        renewal failed
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={send.isPending}
                        onClick={() => send.mutate({ userId: r.userId })}
                      >
                        <Send className="mr-1 h-3.5 w-3.5" /> Reminder
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={extend.isPending}
                        onClick={() => {
                          const n = Number(prompt("Extend by how many days?", "7"));
                          if (!Number.isFinite(n) || n <= 0) return;
                          extend.mutate({ orderId: r.id, days: Math.min(365, Math.floor(n)) });
                        }}
                      >
                        <Clock className="mr-1 h-3.5 w-3.5" /> Extend
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && !isFetching && (
                <tr>
                  <td colSpan={5} className="px-3 py-10 text-center text-sm text-muted-foreground">
                    <AlertTriangle className="mx-auto mb-2 h-4 w-4" />
                    Nothing matches — you're all caught up.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Segments

function SegmentsTab({ onOpenCustomer }: { onOpenCustomer: (c: Customer) => void }) {
  const [segment, setSegment] = useState<
    "active" | "expired" | "new" | "by_tool" | "failed_payments" | "no_reviews"
  >("active");
  const [toolSlug, setToolSlug] = useState("");
  const [newWithinDays, setNewWithinDays] = useState(14);
  const { data, isFetching } = useQuery({
    queryKey: ["comms-segment", segment, toolSlug, newWithinDays],
    queryFn: () =>
      adminListCustomerSegment({
        data: { segment, toolSlug: toolSlug || undefined, newWithinDays },
      }),
    enabled: segment !== "by_tool" || toolSlug.trim().length > 0,
  });
  const rows = data?.customers ?? [];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={segment}
          onChange={(e) => setSegment(e.target.value as typeof segment)}
          className="rounded-md border bg-background px-2 py-1.5 text-sm"
        >
          <option value="active">Active customers</option>
          <option value="expired">Expired customers</option>
          <option value="new">New customers</option>
          <option value="by_tool">Customers by tool</option>
          <option value="failed_payments">Failed payments</option>
          <option value="no_reviews">Customers without reviews</option>
        </select>
        {segment === "by_tool" && (
          <Input
            value={toolSlug}
            onChange={(e) => setToolSlug(e.target.value)}
            placeholder="tool slug e.g. canva-pro"
            className="h-8 w-56"
          />
        )}
        {segment === "new" && (
          <select
            value={newWithinDays}
            onChange={(e) => setNewWithinDays(Number(e.target.value))}
            className="rounded-md border bg-background px-2 py-1.5 text-sm"
          >
            <option value={7}>Last 7 days</option>
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
        )}
        <div className="ml-auto text-xs text-muted-foreground">
          {isFetching ? "Loading…" : `${rows.length} customers`}
        </div>
      </div>
      <div className="overflow-hidden rounded-2xl border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-[11px] uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Customer</th>
                <th className="px-3 py-2">Registered</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((c) => (
                <tr key={c.userId}>
                  <td className="px-3 py-2">
                    <div className="font-medium">{c.fullName ?? "—"}</div>
                    <div className="text-xs text-muted-foreground">{c.email ?? "—"}</div>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {new Date(c.registeredAt).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button size="sm" variant="ghost" onClick={() => onOpenCustomer(c)}>
                      Message
                    </Button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && !isFetching && (
                <tr>
                  <td colSpan={3} className="px-3 py-8 text-center text-xs text-muted-foreground">
                    No customers in this segment.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
