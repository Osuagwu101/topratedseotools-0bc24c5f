/**
 * AccountsCapacityTab — Admin UI for managing login accounts and per-account
 * capacity for a single tool. Displayed under
 * /admin/tools/$slug in the "Accounts & Capacity" tab.
 *
 * - Shows every account for this tool (Shared + Private) with a
 *   utilisation bar, health status pill, and capacity-review flag.
 * - Add, edit, disable, and delete accounts.
 * - Reveal credentials on demand.
 * - Expand a row to see the customers assigned to that account and
 *   reassign them to another account with enough capacity.
 */
import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useSuspenseQuery, useQueryClient, queryOptions } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Eye,
  EyeOff,
  Plus,
  Save,
  Trash2,
  AlertTriangle,
  Users2,
  ArrowRightLeft,
  Activity,
} from "lucide-react";
import {
  adminListAccountsForTool,
  adminUpsertAccount,
  adminDeleteAccount,
  adminListAccountAssignments,
  adminReassignCustomer,
  adminRecordHealthCheck,
  type ToolAccountWithUsage,
} from "@/lib/account-pool.functions";
import { getToolAccountSummary } from "@/lib/access-health.functions";
import { Link } from "@tanstack/react-router";
import { AdminOtpQueue } from "@/components/admin/AdminOtpQueue";

const accountsQuery = (slug: string) =>
  queryOptions({
    queryKey: ["tool-accounts", slug],
    queryFn: () => adminListAccountsForTool({ data: { tool_slug: slug } }),
  });

const summaryQuery = (slug: string) =>
  queryOptions({
    queryKey: ["tool-account-summary", slug],
    queryFn: () => getToolAccountSummary({ data: { tool_slug: slug } }),
  });

export function AccountsCapacityTab({ slug }: { slug: string }) {
  const qc = useQueryClient();
  const { data } = useSuspenseQuery(accountsQuery(slug));
  const { data: summaryData } = useSuspenseQuery(summaryQuery(slug));
  const [showNew, setShowNew] = useState(false);
  const accounts = data.accounts;
  const summary = summaryData.summary;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["tool-accounts", slug] });
    qc.invalidateQueries({ queryKey: ["tool-account-summary", slug] });
  };
  const shared = accounts.filter((a) => a.access_type === "shared");
  const priv = accounts.filter((a) => a.access_type === "private");

  return (
    <div className="space-y-6">
      <AdminOtpQueue toolSlug={slug} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Accounts & Capacity</h2>
          <p className="text-sm text-muted-foreground">
            Add unlimited login accounts. Customers get auto-assigned to the account with the most
            availability. Private accounts always have capacity 1.
          </p>
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" /> Add account
        </button>
      </div>

      {summary && <SummaryPanel slug={slug} summary={summary} />}

      {showNew && (
        <AccountForm
          slug={slug}
          onDone={() => {
            setShowNew(false);
            refresh();
          }}
          onCancel={() => setShowNew(false)}
        />
      )}

      <AccountGroup title="Shared accounts" accounts={shared} onChange={refresh} />
      <AccountGroup title="Private accounts" accounts={priv} onChange={refresh} />
    </div>
  );
}

type SummaryShape = NonNullable<Awaited<ReturnType<typeof getToolAccountSummary>>["summary"]>;

function SummaryPanel({ slug, summary }: { slug: string; summary: SummaryShape }) {
  const items: Array<{
    label: string;
    value: number;
    tone?: string;
    to?: any;
    search?: any;
    hash?: string;
  }> = [
    { label: "Total accounts", value: summary.totalAccounts },
    { label: "Healthy", value: summary.healthy, tone: "text-emerald-600" },
    {
      label: "Almost full",
      value: summary.almostFull,
      tone: summary.almostFull > 0 ? "text-amber-600" : undefined,
    },
    { label: "Full", value: summary.full, tone: summary.full > 0 ? "text-red-600" : undefined },
    {
      label: "Unhealthy",
      value: summary.unhealthy,
      tone: summary.unhealthy > 0 ? "text-red-600" : undefined,
    },
    { label: "Total capacity", value: summary.totalCapacity },
    { label: "Active assignments", value: summary.assigned },
    { label: "Available spaces", value: summary.available },
    {
      label: "Awaiting assignment",
      value: summary.awaiting,
      tone: summary.awaiting > 0 ? "text-amber-600" : undefined,
      to: "/admin/awaiting-assignments" as const,
    },
    {
      label: "Expiring soon",
      value: summary.expiringSoon,
      tone: summary.expiringSoon > 0 ? "text-amber-600" : undefined,
    },
    {
      label: "Needs capacity review",
      value: (summary as any).needsReview ?? 0,
      tone: ((summary as any).needsReview ?? 0) > 0 ? "text-amber-600" : undefined,
    },
  ];
  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Capacity summary
        </div>
        <Link
          to="/admin/access-health"
          search={{ tool: slug } as any}
          className="text-xs text-primary hover:underline"
        >
          Open in Access Health →
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {items.map((it) => {
          const content = (
            <div className="rounded-lg border bg-background p-2">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {it.label}
              </div>
              <div className={`mt-0.5 text-lg font-semibold tabular-nums ${it.tone ?? ""}`}>
                {it.value}
              </div>
            </div>
          );
          if (it.to) {
            return (
              <Link key={it.label} to={it.to} className="block hover:opacity-90">
                {content}
              </Link>
            );
          }
          return <div key={it.label}>{content}</div>;
        })}
      </div>
    </div>
  );
}

function AccountGroup({
  title,
  accounts,
  onChange,
}: {
  title: string;
  accounts: ToolAccountWithUsage[];
  onChange: () => void;
}) {
  return (
    <div>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title} · {accounts.length}
      </div>
      {accounts.length === 0 ? (
        <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          No accounts yet.
        </div>
      ) : (
        <div className="space-y-3">
          {accounts.map((a) => (
            <AccountRow key={a.id} account={a} onChange={onChange} />
          ))}
        </div>
      )}
    </div>
  );
}

function AccountRow({
  account,
  onChange,
}: {
  account: ToolAccountWithUsage;
  onChange: () => void;
}) {
  const [showCreds, setShowCreds] = useState(false);
  const [edit, setEdit] = useState(false);
  const [showAssigns, setShowAssigns] = useState(false);

  const pct = account.fill_pct;
  const barColor = pct >= 100 ? "bg-destructive" : pct >= 80 ? "bg-amber-500" : "bg-primary";
  const healthColor =
    account.status === "working"
      ? "bg-success/15 text-success"
      : "bg-destructive/10 text-destructive";

  const remove = useServerFn(adminDeleteAccount);
  const upsert = useServerFn(adminUpsertAccount);
  const health = useServerFn(adminRecordHealthCheck);

  return (
    <div className="rounded-2xl border bg-card p-4 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="truncate text-sm font-semibold">{account.label}</div>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${healthColor}`}
            >
              {account.status.replace(/_/g, " ")}
            </span>
            {!account.enabled && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
                Disabled
              </span>
            )}
            {account.needs_capacity_review && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-600">
                <AlertTriangle className="h-3 w-3" /> Review capacity
              </span>
            )}
          </div>
          <div className="mt-1 truncate text-xs text-muted-foreground">
            {account.login_email ?? "no login email"}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-muted-foreground">
            {account.active_count} / {account.max_capacity} used
          </div>
          <div className="mt-1 h-1.5 w-32 overflow-hidden rounded-full bg-muted">
            <div className={`h-full ${barColor}`} style={{ width: `${Math.min(100, pct)}%` }} />
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          onClick={() => setShowCreds((v) => !v)}
          className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted"
        >
          {showCreds ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
          {showCreds ? "Hide" : "Reveal"} credentials
        </button>
        <button
          onClick={() => setShowAssigns((v) => !v)}
          className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted"
        >
          <Users2 className="h-3 w-3" />
          {showAssigns ? "Hide" : "Show"} customers
        </button>
        <button
          onClick={() => setEdit((v) => !v)}
          className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted"
        >
          {edit ? "Close editor" : "Edit"}
        </button>
        <button
          onClick={async () => {
            try {
              await upsert({
                data: {
                  id: account.id,
                  tool_slug: account.tool_slug,
                  access_type: account.access_type,
                  enabled: !account.enabled,
                },
              });
              toast.success(account.enabled ? "Account disabled" : "Account enabled");
              onChange();
            } catch (e: any) {
              toast.error(e.message);
            }
          }}
          className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted"
        >
          {account.enabled ? "Disable" : "Enable"}
        </button>
        <button
          onClick={async () => {
            const result = window.prompt(
              "Health check result: working | login_failed | password_changed | suspended | expired | tool_unavailable | other",
              "working",
            );
            if (!result) return;
            try {
              await health({ data: { account_id: account.id, result: result as any } });
              toast.success("Health check recorded");
              onChange();
            } catch (e: any) {
              toast.error(e.message);
            }
          }}
          className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted"
        >
          <Activity className="h-3 w-3" /> Record health check
        </button>
        <button
          onClick={async () => {
            if (!window.confirm("Delete this account? Only allowed if no active customers."))
              return;
            try {
              await remove({ data: { id: account.id } });
              toast.success("Account deleted");
              onChange();
            } catch (e: any) {
              toast.error(e.message);
            }
          }}
          className="inline-flex items-center gap-1 rounded-md border border-destructive/40 px-2 py-1 text-xs text-destructive hover:bg-destructive/5"
        >
          <Trash2 className="h-3 w-3" /> Delete
        </button>
      </div>

      {showCreds && (
        <div className="mt-3 grid gap-2 rounded-lg border bg-muted/40 p-3 text-xs sm:grid-cols-2">
          <Field label="Email" value={account.login_email ?? "—"} />
          <Field label="Password" value={account.login_password ?? "—"} mono />
          <Field label="Login URL" value={account.login_url ?? "—"} />
          <Field label="One-click URL" value={account.one_click_login_url ?? "—"} />
          <div className="sm:col-span-2">
            <Field label="Notes" value={account.login_notes ?? "—"} />
          </div>
        </div>
      )}

      {edit && (
        <div className="mt-3">
          <AccountForm
            slug={account.tool_slug}
            existing={account}
            onDone={() => {
              setEdit(false);
              onChange();
            }}
            onCancel={() => setEdit(false)}
          />
        </div>
      )}

      {showAssigns && <AssignmentsPanel account={account} onChange={onChange} />}
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase text-muted-foreground">{label}</div>
      <div className={`mt-0.5 break-all ${mono ? "font-mono" : ""}`}>{value}</div>
    </div>
  );
}

function AccountForm({
  slug,
  existing,
  onDone,
  onCancel,
}: {
  slug: string;
  existing?: ToolAccountWithUsage;
  onDone: () => void;
  onCancel: () => void;
}) {
  const upsert = useServerFn(adminUpsertAccount);
  const [f, setF] = useState({
    label: existing?.label ?? "",
    access_type: existing?.access_type ?? ("shared" as "shared" | "private"),
    login_email: existing?.login_email ?? "",
    login_password: existing?.login_password ?? "",
    login_url: existing?.login_url ?? "",
    login_notes: existing?.login_notes ?? "",
    one_click_login_url: existing?.one_click_login_url ?? "",
    max_capacity: existing?.max_capacity ?? 10,
    needs_capacity_review: existing?.needs_capacity_review ?? false,
  });
  const [saving, setSaving] = useState(false);

  return (
    <div className="rounded-xl border bg-muted/30 p-4">
      <div className="mb-2 text-sm font-semibold">{existing ? "Edit account" : "New account"}</div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs">
          <span className="mb-1 block font-medium text-muted-foreground">Label</span>
          <input
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            value={f.label}
            onChange={(e) => setF({ ...f, label: e.target.value })}
            placeholder="e.g. Account #1"
          />
        </label>
        <label className="text-xs">
          <span className="mb-1 block font-medium text-muted-foreground">Access type</span>
          <select
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            value={f.access_type}
            onChange={(e) => {
              const t = e.target.value as "shared" | "private";
              setF({ ...f, access_type: t, max_capacity: t === "private" ? 1 : f.max_capacity });
            }}
            disabled={!!existing}
          >
            <option value="shared">Shared</option>
            <option value="private">Private (1 customer)</option>
          </select>
        </label>
        <label className="text-xs">
          <span className="mb-1 block font-medium text-muted-foreground">Login email</span>
          <input
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            value={f.login_email}
            onChange={(e) => setF({ ...f, login_email: e.target.value })}
          />
        </label>
        <label className="text-xs">
          <span className="mb-1 block font-medium text-muted-foreground">Password</span>
          <input
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm font-mono"
            value={f.login_password}
            onChange={(e) => setF({ ...f, login_password: e.target.value })}
          />
        </label>
        <label className="text-xs">
          <span className="mb-1 block font-medium text-muted-foreground">Login URL</span>
          <input
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            value={f.login_url}
            onChange={(e) => setF({ ...f, login_url: e.target.value })}
          />
        </label>
        <label className="text-xs">
          <span className="mb-1 block font-medium text-muted-foreground">One-click login URL</span>
          <input
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            value={f.one_click_login_url}
            onChange={(e) => setF({ ...f, one_click_login_url: e.target.value })}
          />
        </label>
        <label className="text-xs">
          <span className="mb-1 block font-medium text-muted-foreground">Max capacity</span>
          <input
            type="number"
            min={1}
            max={1000}
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            value={f.max_capacity}
            disabled={f.access_type === "private"}
            onChange={(e) => setF({ ...f, max_capacity: Number(e.target.value || 1) })}
          />
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={f.needs_capacity_review}
            onChange={(e) => setF({ ...f, needs_capacity_review: e.target.checked })}
          />
          Flag for capacity review
        </label>
        <label className="text-xs sm:col-span-2">
          <span className="mb-1 block font-medium text-muted-foreground">Notes</span>
          <textarea
            rows={2}
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            value={f.login_notes}
            onChange={(e) => setF({ ...f, login_notes: e.target.value })}
          />
        </label>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button onClick={onCancel} className="rounded-md border px-3 py-1.5 text-xs">
          Cancel
        </button>
        <button
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            try {
              await upsert({
                data: {
                  id: existing?.id,
                  tool_slug: slug,
                  access_type: f.access_type,
                  label: f.label || `Account ${new Date().toISOString().slice(0, 10)}`,
                  login_email: f.login_email || null,
                  login_password: f.login_password || null,
                  login_url: f.login_url || null,
                  login_notes: f.login_notes || null,
                  one_click_login_url: f.one_click_login_url || null,
                  max_capacity: f.access_type === "private" ? 1 : f.max_capacity,
                  needs_capacity_review: f.needs_capacity_review,
                },
              });
              toast.success(existing ? "Account updated" : "Account created");
              onDone();
            } catch (e: any) {
              toast.error(e.message);
            } finally {
              setSaving(false);
            }
          }}
          className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          <Save className="h-3 w-3" /> {existing ? "Save changes" : "Create account"}
        </button>
      </div>
    </div>
  );
}

function AssignmentsPanel({
  account,
  onChange,
}: {
  account: ToolAccountWithUsage;
  onChange: () => void;
}) {
  const qc = useQueryClient();
  const key = ["account-assignments", account.id];
  const q = useSuspenseQuery(
    queryOptions({
      queryKey: key,
      queryFn: () => adminListAccountAssignments({ data: { account_id: account.id } }),
    }),
  );
  const allQ = useSuspenseQuery(accountsQuery(account.tool_slug));
  const targets = useMemo(
    () =>
      allQ.data.accounts.filter(
        (a) =>
          a.id !== account.id &&
          a.enabled &&
          a.access_type === account.access_type &&
          a.available > 0,
      ),
    [allQ.data.accounts, account],
  );
  const reassign = useServerFn(adminReassignCustomer);
  const active = q.data.assignments.filter((a: any) => a.status === "active");

  return (
    <div className="mt-3 rounded-lg border bg-background p-3">
      <div className="text-xs font-semibold text-muted-foreground">
        {active.length} active customer{active.length === 1 ? "" : "s"}
      </div>
      {active.length === 0 ? (
        <div className="mt-2 text-xs text-muted-foreground">
          No active customers on this account.
        </div>
      ) : (
        <ul className="mt-2 space-y-2">
          {active.map((a: any) => (
            <li
              key={a.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs"
            >
              <div className="min-w-0">
                <div className="truncate font-medium">{a.profile?.full_name ?? "—"}</div>
                <div className="truncate text-muted-foreground">
                  {a.profile?.email ?? a.user_id}
                </div>
              </div>
              <select
                defaultValue=""
                onChange={async (e) => {
                  const target = e.target.value;
                  if (!target) return;
                  const reason = window.prompt("Reason for reassignment? (optional)") ?? undefined;
                  try {
                    await reassign({
                      data: { order_id: a.order_id, new_account_id: target, reason },
                    });
                    toast.success("Customer reassigned");
                    qc.invalidateQueries({ queryKey: key });
                    onChange();
                  } catch (err: any) {
                    toast.error(err.message);
                  }
                }}
                className="rounded-md border bg-background px-2 py-1 text-xs"
              >
                <option value="">Reassign to…</option>
                {targets.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label} ({t.available} free)
                  </option>
                ))}
              </select>
              <ArrowRightLeft className="h-3 w-3 text-muted-foreground" />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
