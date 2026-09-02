/**
 * /admin/access-health — cross-tool health center.
 *
 * Lists every login account across every tool with utilisation, health,
 * expiry and review flags. Surfaces the alert queue and links straight
 * to the tool page for reassignment.
 */
import { requireAdminOrRedirect } from "@/lib/admin-gate";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { queryOptions, useSuspenseQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AdminShell } from "@/components/admin/AdminShell";
import {
  getAccessHealthOverview,
  setAlertSettings,
  bulkReassignFromAccount,
  assignAwaitingCustomer,
  dispatchAdminAlertEmails,
} from "@/lib/access-health.functions";
import { adminRecordHealthCheck } from "@/lib/account-pool.functions";
import type { AlertSettings, HealthStatus } from "@/lib/access-health";
import {
  AlertTriangle,
  Activity,
  ShieldCheck,
  Users2,
  Bell,
  Mail,
  Settings2,
  ArrowRightLeft,
  Stethoscope,
  Clock,
  type LucideIcon,
} from "lucide-react";

const overviewQuery = queryOptions({
  queryKey: ["access-health-overview"],
  queryFn: () => getAccessHealthOverview(),
});

export const Route = createFileRoute("/admin/access-health")({
  ssr: false,
  beforeLoad: async () => {
    await requireAdminOrRedirect();
  },
  head: () => ({
    meta: [{ title: "Access Health — Admin" }, { name: "robots", content: "noindex" }],
  }),
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(overviewQuery);
  },
  component: AccessHealthPage,
});

const HEALTH_LABELS: Record<HealthStatus, string> = {
  available: "Available",
  almost_full: "Almost Full",
  full: "Full",
  under_maintenance: "Under Maintenance",
  login_problem: "Login Problem",
  expired: "Expired",
  suspended: "Suspended",
  disabled: "Disabled",
};

function healthTone(h: HealthStatus): string {
  switch (h) {
    case "available":
      return "text-success";
    case "almost_full":
      return "text-amber-600";
    case "full":
    case "expired":
    case "suspended":
    case "login_problem":
      return "text-destructive";
    case "under_maintenance":
      return "text-amber-600";
    case "disabled":
      return "text-muted-foreground";
  }
}

function AccessHealthPage() {
  const qc = useQueryClient();
  const { data } = useSuspenseQuery(overviewQuery);
  const [toolFilter, setToolFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<"all" | "shared" | "private">("all");
  const [healthFilter, setHealthFilter] = useState<"all" | HealthStatus>("all");
  const [capacityFilter, setCapacityFilter] = useState<
    "all" | "full" | "available" | "expiring" | "review"
  >("all");
  const [showSettings, setShowSettings] = useState(false);
  const [healthCheckFor, setHealthCheckFor] = useState<string | null>(null);
  const [bulkFor, setBulkFor] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["access-health-overview"] });

  const tools = useMemo(
    () => Array.from(new Set(data.accounts.map((a) => a.tool_slug))).sort(),
    [data.accounts],
  );

  const now = Date.now();
  const soon = now + data.settings.expiryDays * 86400_000;
  const filtered = data.accounts.filter((a) => {
    if (toolFilter !== "all" && a.tool_slug !== toolFilter) return false;
    if (typeFilter !== "all" && a.access_type !== typeFilter) return false;
    if (healthFilter !== "all" && a.health !== healthFilter) return false;
    if (capacityFilter === "full" && a.available > 0) return false;
    if (capacityFilter === "available" && a.available === 0) return false;
    if (capacityFilter === "expiring") {
      const t = a.expires_at ? new Date(a.expires_at).getTime() : null;
      if (t === null || t > soon || t <= now) return false;
    }
    if (capacityFilter === "review" && !a.needs_capacity_review) return false;
    return true;
  });

  const dispatchAlerts = useServerFn(dispatchAdminAlertEmails);

  return (
    <AdminShell>
      <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Access Health</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Monitor every login account, resolve alerts, and reassign customers safely.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to="/admin/awaiting-assignments"
              className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm hover:bg-muted"
            >
              <Clock className="h-4 w-4" /> Awaiting assignment
            </Link>
            <button
              onClick={async () => {
                try {
                  const result = await dispatchAlerts();
                  if ("skipped" in result && result.skipped === "emails_disabled") {
                    toast.info("Alert emails are disabled.");
                  } else {
                    toast.success(`Queued ${result.sent ?? 0} admin alert email(s).`);
                  }
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "Could not send alerts.");
                }
              }}
              className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm hover:bg-muted"
            >
              <Mail className="h-4 w-4" /> Send alerts
            </button>
            <button
              onClick={() => setShowSettings(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm hover:bg-muted"
            >
              <Settings2 className="h-4 w-4" /> Alert settings
            </button>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Kpi label="Accounts" value={data.accounts.length} icon={ShieldCheck} tone="default" />
          <Kpi
            label="Alerts"
            value={data.alertCounts.total}
            icon={Bell}
            tone={data.alertCounts.critical ? "destructive" : "warning"}
          />
          <Kpi
            label="Full"
            value={data.accounts.filter((a) => a.health === "full").length}
            icon={Users2}
            tone="destructive"
          />
          <Kpi
            label="Unhealthy"
            value={
              data.accounts.filter((a) =>
                ["under_maintenance", "login_problem", "expired", "suspended"].includes(a.health),
              ).length
            }
            icon={Activity}
            tone="destructive"
          />
          <Kpi label="Awaiting" value={data.awaiting.length} icon={Clock} tone="warning" />
        </div>

        {data.alerts.length > 0 && (
          <div className="mt-6 rounded-2xl border bg-card p-4 shadow-card">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Bell className="h-4 w-4" /> Alerts ({data.alerts.length})
            </h2>
            <ul className="space-y-2">
              {data.alerts.slice(0, 20).map((a) => (
                <li
                  key={a.key}
                  className="flex items-start justify-between gap-3 rounded-lg border p-2 text-sm"
                >
                  <div className="min-w-0">
                    <div
                      className={`font-medium ${a.level === "critical" ? "text-destructive" : a.level === "warning" ? "text-amber-600" : ""}`}
                    >
                      {a.title}
                    </div>
                    <div className="text-xs text-muted-foreground">{a.message}</div>
                  </div>
                  <div className="flex items-center gap-1">
                    {a.account_id && (
                      <button
                        onClick={() => setBulkFor(a.account_id!)}
                        className="rounded-md border px-2 py-1 text-xs hover:bg-muted"
                      >
                        Reassign customers
                      </button>
                    )}
                    <Link
                      to="/admin/tools/$slug"
                      params={{ slug: a.tool_slug }}
                      className="rounded-md border px-2 py-1 text-xs hover:bg-muted"
                    >
                      Open tool
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-2 text-sm">
          <select
            value={toolFilter}
            onChange={(e) => setToolFilter(e.target.value)}
            className="rounded-lg border bg-background px-2 py-1.5"
          >
            <option value="all">All tools</option>
            {tools.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as "all" | "shared" | "private")}
            className="rounded-lg border bg-background px-2 py-1.5"
          >
            <option value="all">Shared + Private</option>
            <option value="shared">Shared</option>
            <option value="private">Private</option>
          </select>
          <select
            value={healthFilter}
            onChange={(e) => setHealthFilter(e.target.value as "all" | HealthStatus)}
            className="rounded-lg border bg-background px-2 py-1.5"
          >
            <option value="all">Any health</option>
            {Object.entries(HEALTH_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <select
            value={capacityFilter}
            onChange={(e) => setCapacityFilter(e.target.value as "all" | "full" | "available" | "expiring" | "review")}
            className="rounded-lg border bg-background px-2 py-1.5"
          >
            <option value="all">All capacity</option>
            <option value="available">Has space</option>
            <option value="full">Full</option>
            <option value="expiring">Expiring soon</option>
            <option value="review">Needs review</option>
          </select>
        </div>

        <div className="mt-4 overflow-x-auto rounded-2xl border bg-card shadow-card">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Tool</th>
                <th className="px-3 py-2 text-left">Label</th>
                <th className="px-3 py-2 text-left">Type</th>
                <th className="px-3 py-2 text-left">Cap</th>
                <th className="px-3 py-2 text-left">Active</th>
                <th className="px-3 py-2 text-left">Free</th>
                <th className="px-3 py-2 text-left">Fill %</th>
                <th className="px-3 py-2 text-left">Expires</th>
                <th className="px-3 py-2 text-left">Health</th>
                <th className="px-3 py-2 text-left">Last check</th>
                <th className="px-3 py-2 text-left">Customers affected</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => (
                <tr key={a.id} className="border-b last:border-0">
                  <td className="px-3 py-2 font-medium">{a.tool_slug}</td>
                  <td className="px-3 py-2">{a.label}</td>
                  <td className="px-3 py-2 capitalize">{a.access_type}</td>
                  <td className="px-3 py-2">{a.max_capacity}</td>
                  <td className="px-3 py-2">{a.active_count}</td>
                  <td className="px-3 py-2">{a.available}</td>
                  <td className="px-3 py-2">{a.fill_pct}%</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {a.expires_at ? new Date(a.expires_at).toLocaleDateString() : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <span className={healthTone(a.health)}>{HEALTH_LABELS[a.health]}</span>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {a.last_health_check_at
                      ? new Date(a.last_health_check_at).toLocaleDateString()
                      : "—"}
                  </td>
                  <td className="px-3 py-2">{a.active_count}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      <button
                        onClick={() => setHealthCheckFor(a.id)}
                        className="rounded-md border px-2 py-1 text-xs hover:bg-muted"
                        title="Record health check"
                      >
                        <Stethoscope className="h-3.5 w-3.5" />
                      </button>
                      {a.active_count > 0 && (
                        <button
                          onClick={() => setBulkFor(a.id)}
                          className="rounded-md border px-2 py-1 text-xs hover:bg-muted"
                          title="Bulk reassign"
                        >
                          <ArrowRightLeft className="h-3.5 w-3.5" />
                        </button>
                      )}
                      <Link
                        to="/admin/tools/$slug"
                        params={{ slug: a.tool_slug }}
                        className="rounded-md border px-2 py-1 text-xs hover:bg-muted"
                      >
                        Manage
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={12} className="px-3 py-8 text-center text-sm text-muted-foreground">
                    Nothing to show for this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {healthCheckFor && (
        <HealthCheckDialog
          accountId={healthCheckFor}
          onClose={() => {
            setHealthCheckFor(null);
            refresh();
          }}
        />
      )}
      {bulkFor && (
        <BulkReassignDialog
          accountId={bulkFor}
          onClose={() => {
            setBulkFor(null);
            refresh();
          }}
        />
      )}
      {showSettings && (
        <AlertSettingsDialog
          initial={data.settings}
          onClose={() => {
            setShowSettings(false);
            refresh();
          }}
        />
      )}
    </AdminShell>
  );
}

function Kpi({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  icon: LucideIcon;
  tone: "default" | "warning" | "destructive";
}) {
  const toneCls =
    tone === "destructive"
      ? "text-destructive"
      : tone === "warning"
        ? "text-amber-600"
        : "text-primary";
  return (
    <div className="rounded-xl border p-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase text-muted-foreground">{label}</span>
        <Icon className={`h-3.5 w-3.5 ${toneCls}`} />
      </div>
      <div className={`mt-1 text-xl font-semibold ${toneCls}`}>{value}</div>
    </div>
  );
}

function HealthCheckDialog({ accountId, onClose }: { accountId: string; onClose: () => void }) {
  const [result, setResult] = useState<
    | "working"
    | "login_failed"
    | "password_changed"
    | "suspended"
    | "expired"
    | "tool_unavailable"
    | "other"
  >("working");
  const [note, setNote] = useState("");
  const record = useServerFn(adminRecordHealthCheck);
  return (
    <ModalShell title="Record health check" onClose={onClose}>
      <label className="text-sm">Result</label>
      <select
        value={result}
        onChange={(e) => setResult(e.target.value as "working" | "login_failed" | "password_changed" | "suspended" | "expired" | "tool_unavailable" | "other")}
        className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
      >
        <option value="working">Working</option>
        <option value="login_failed">Login failed</option>
        <option value="password_changed">Password changed</option>
        <option value="suspended">Account suspended</option>
        <option value="expired">Account expired</option>
        <option value="tool_unavailable">Tool temporarily unavailable</option>
        <option value="other">Other issue</option>
      </select>
      <label className="mt-3 block text-sm">Note (optional)</label>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={3}
        className="mt-1 w-full rounded-md border bg-background p-2 text-sm"
      />
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-md border px-3 py-1.5 text-sm">
          Cancel
        </button>
        <button
          onClick={async () => {
            await record({
              data: { account_id: accountId, result, note: note.trim() || undefined },
            });
            toast.success("Health check recorded.");
            onClose();
          }}
          className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground"
        >
          Save
        </button>
      </div>
    </ModalShell>
  );
}

function BulkReassignDialog({ accountId, onClose }: { accountId: string; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const run = useServerFn(bulkReassignFromAccount);
  return (
    <ModalShell title="Reassign affected customers" onClose={onClose}>
      <p className="text-sm text-muted-foreground">
        Moves every active customer on this account to the highest-availability compatible account.
        Customers that don't fit stay awaiting assignment — none are overfilled.
      </p>
      <label className="mt-3 block text-sm">Reason (optional)</label>
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className="mt-1 w-full rounded-md border bg-background p-2 text-sm"
      />
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-md border px-3 py-1.5 text-sm">
          Cancel
        </button>
        <button
          onClick={async () => {
            try {
              const r = await run({
                data: { account_id: accountId, reason: reason.trim() || undefined },
              });
              toast.success(`Moved ${r.moved}. Still awaiting: ${r.still_awaiting}.`);
              onClose();
            } catch (error) {
              toast.error(error instanceof Error ? error.message : "Failed");
            }
          }}
          className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground"
        >
          Reassign
        </button>
      </div>
    </ModalShell>
  );
}

function AlertSettingsDialog({ initial, onClose }: { initial: AlertSettings; onClose: () => void }) {
  const [pct, setPct] = useState<number>(initial.almostFullPct);
  const [days, setDays] = useState<number>(initial.expiryDays);
  const [enabled, setEnabled] = useState<boolean>(initial.emailsEnabled);
  const [rcpts, setRcpts] = useState<string>((initial.emailRecipients ?? []).join(", "));
  const save = useServerFn(setAlertSettings);
  return (
    <ModalShell title="Alert settings" onClose={onClose}>
      <label className="text-sm">Almost-full warning (%)</label>
      <input
        type="number"
        min={10}
        max={100}
        value={pct}
        onChange={(e) => setPct(parseInt(e.target.value) || 0)}
        className="mt-1 w-full rounded-md border bg-background p-2 text-sm"
      />
      <label className="mt-3 block text-sm">Expiry warning (days)</label>
      <input
        type="number"
        min={1}
        max={60}
        value={days}
        onChange={(e) => setDays(parseInt(e.target.value) || 0)}
        className="mt-1 w-full rounded-md border bg-background p-2 text-sm"
      />
      <label className="mt-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        Enable Admin email alerts (deduplicated per open issue)
      </label>
      <label className="mt-3 block text-sm">Recipients (comma-separated emails)</label>
      <input
        value={rcpts}
        onChange={(e) => setRcpts(e.target.value)}
        className="mt-1 w-full rounded-md border bg-background p-2 text-sm"
      />
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="rounded-md border px-3 py-1.5 text-sm">
          Cancel
        </button>
        <button
          onClick={async () => {
            const emails = rcpts
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);
            try {
              await save({
                data: {
                  almostFullPct: pct,
                  expiryDays: days,
                  emailsEnabled: enabled,
                  emailRecipients: emails,
                },
              });
              toast.success("Alert settings saved.");
              onClose();
            } catch (error) {
              toast.error(error instanceof Error ? error.message : "Failed");
            }
          }}
          className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground"
        >
          Save
        </button>
      </div>
    </ModalShell>
  );
}

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border bg-card p-4 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-base font-semibold">{title}</h3>
          <button onClick={onClose} className="text-sm text-muted-foreground">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export { assignAwaitingCustomer };
