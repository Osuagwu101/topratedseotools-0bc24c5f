/**
 * Admin — per-tool management at /admin/tools/$slug.
 *
 * Single page with tabs (Overview, Access & Availability, Pricing,
 * Credentials, Orders) that consolidates every setting for one tool.
 * All existing server functions are reused — no business logic changes.
 */
import { requireAdminOrRedirect } from "@/lib/admin-gate";
import { createFileRoute, Link, notFound, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { queryOptions, useSuspenseQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  Eye,
  EyeOff,
  Info,
  KeyRound,
  Lock,
  Plus,
  Save,
  ShieldCheck,
  Tag,
  Trash2,
  Users,
  Zap,
} from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { ToolBrandMark } from "@/components/tools/ToolBrandMark";
import { TOOLS } from "@/lib/tools-data";
import {
  listToolSettings,
  adminUpsertToolSetting,
  adminListToolCredentials,
  adminUpsertToolCredential,
  adminListOrders,
  type LaunchMode,
  type ToolAccessLevel,
} from "@/lib/access.functions";
import {
  listToolPricing,
  upsertToolPricing,
  deleteToolPricing,
  type ToolPricingOption,
  type AccessType,
} from "@/lib/tool-pricing.functions";
import { getBillingKind, normaliseBillingKind } from "@/lib/currency";
import { launchTool } from "@/lib/tool-launcher";

const settingsQuery = queryOptions({
  queryKey: ["tool-settings"],
  queryFn: () => listToolSettings(),
});
const pricingQuery = queryOptions({
  queryKey: ["tool-pricing"],
  queryFn: () => listToolPricing(),
});
const credsQuery = queryOptions({
  queryKey: ["admin-credentials"],
  queryFn: () => adminListToolCredentials(),
});
const ordersQuery = queryOptions({
  queryKey: ["admin-orders"],
  queryFn: () => adminListOrders(),
});

export const Route = createFileRoute("/admin/tools/$slug")({
  ssr: false,
  beforeLoad: async () => { await requireAdminOrRedirect(); },
  head: ({ params }) => ({
    meta: [
      { title: `Manage ${params.slug} — Admin` },
      { name: "robots", content: "noindex" },
    ],
  }),
  loader: async ({ context, params }) => {
    const tool = TOOLS.find((t) => t.slug === params.slug);
    if (!tool) throw notFound();
    await Promise.all([
      context.queryClient.ensureQueryData(settingsQuery),
      context.queryClient.ensureQueryData(pricingQuery),
      context.queryClient.ensureQueryData(credsQuery),
      context.queryClient.ensureQueryData(ordersQuery),
    ]);
    return { tool };
  },
  component: AdminToolPage,
  notFoundComponent: () => (
    <AdminShell>
      <div className="mx-auto max-w-md px-4 py-24 text-center">
        <h1 className="text-2xl font-semibold">Tool not found</h1>
        <Link to="/admin/tools" className="mt-4 inline-block text-sm text-primary hover:underline">
          Back to tools
        </Link>
      </div>
    </AdminShell>
  ),
});

type Tab = "overview" | "access" | "pricing" | "credentials" | "orders";

function AdminToolPage() {
  const { tool } = Route.useLoaderData();
  const [tab, setTab] = useState<Tab>("overview");

  const { data: settingsData } = useSuspenseQuery(settingsQuery);
  const setting = settingsData.settings.find((s) => s.tool_slug === tool.slug);

  const tabs: Array<{ id: Tab; label: string; icon: typeof Info }> = [
    { id: "overview", label: "Overview", icon: Info },
    { id: "access", label: "Access & Availability", icon: ShieldCheck },
    { id: "pricing", label: "Pricing", icon: Tag },
    { id: "credentials", label: "Credentials", icon: KeyRound },
    { id: "orders", label: "Orders & Subscribers", icon: Users },
  ];

  return (
    <AdminShell>
      <section className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <Link
          to="/admin/tools"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> All tools
        </Link>

        <div className="mt-3 flex items-center gap-3">
          <ToolBrandMark tool={tool} size="md" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-2xl font-semibold tracking-tight">
              {tool.name}
            </h1>
            <div className="text-xs text-muted-foreground">
              {tool.category} · {tool.slug}
            </div>
          </div>
          <span
            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase ${
              (setting?.enabled ?? true)
                ? "bg-success/15 text-success"
                : "bg-destructive/10 text-destructive"
            }`}
          >
            {(setting?.enabled ?? true) ? "Enabled" : "Disabled"}
          </span>
        </div>

        <div className="mt-6 flex flex-wrap gap-1 border-b">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition ${
                tab === t.id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <t.icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          ))}
        </div>

        <div className="mt-6">
          {tab === "overview" && <OverviewTab tool={tool} />}
          {tab === "access" && <AccessTab slug={tool.slug} />}
          {tab === "pricing" && <PricingTab slug={tool.slug} />}
          {tab === "credentials" && <CredentialsTab tool={tool} />}
          {tab === "orders" && <OrdersTab slug={tool.slug} />}
        </div>
      </section>
    </AdminShell>
  );
}

/* ------------------------------ Overview ------------------------------ */

function OverviewTab({ tool }: { tool: (typeof TOOLS)[number] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Name" value={tool.name} />
      <Field label="Category" value={tool.category} />
      <Field label="Slug" value={tool.slug} />
      <Field label="Domain" value={tool.domain ?? "—"} />
      <div className="rounded-2xl border bg-card p-5 shadow-card sm:col-span-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Tagline
        </div>
        <p className="mt-1 text-sm">{tool.tagline}</p>
        <div className="mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Description
        </div>
        <p className="mt-1 text-sm leading-relaxed">{tool.description}</p>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border bg-card p-4 shadow-card">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-sm font-medium">{value}</div>
    </div>
  );
}

/* ------------------------------ Access ------------------------------ */

function AccessTab({ slug }: { slug: string }) {
  const { data } = useSuspenseQuery(settingsQuery);
  const setting = data.settings.find((s) => s.tool_slug === slug);
  const router = useRouter();
  const qc = useQueryClient();
  const upsert = useServerFn(adminUpsertToolSetting);
  const [busy, setBusy] = useState(false);

  const tool = TOOLS.find((t) => t.slug === slug)!;

  const [enabled, setEnabled] = useState(setting?.enabled ?? true);
  const [level, setLevel] = useState<ToolAccessLevel>(
    setting?.access_level ?? "purchased",
  );
  const [shared, setShared] = useState(setting?.shared_access_enabled ?? true);
  const [priv, setPriv] = useState(setting?.private_access_enabled ?? true);

  const [ocEnabled, setOcEnabled] = useState(
    setting?.one_click_auth_enabled ?? false,
  );
  const [ocUrl, setOcUrl] = useState(
    setting?.official_login_url ??
      (tool.domain ? `https://${tool.domain}` : ""),
  );
  const [ocProvider, setOcProvider] = useState(setting?.auth_provider ?? "");
  const [ocMode, setOcMode] = useState<LaunchMode>(
    setting?.launch_mode ?? "new_tab",
  );
  const [ocDisplayCreds, setOcDisplayCreds] = useState(
    setting?.display_manual_credentials ?? true,
  );

  async function save() {
    setBusy(true);
    try {
      await upsert({
        data: {
          tool_slug: slug,
          enabled,
          access_level: level,
          shared_access_enabled: shared,
          private_access_enabled: priv,
          one_click_auth_enabled: ocEnabled,
          official_login_url: ocUrl.trim() || null,
          auth_provider: ocProvider.trim() || null,
          launch_mode: ocMode,
          display_manual_credentials: ocDisplayCreds,
        },
      });
      toast.success("Access settings saved");
      await qc.invalidateQueries({ queryKey: ["tool-settings"] });
      router.invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card title="Tool availability">
        <label className="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="h-4 w-4"
          />
          <span>
            <strong>Enable this tool</strong> — when off, customers cannot purchase or launch it.
          </span>
        </label>

        <label className="mt-4 flex flex-col gap-1 text-sm">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Direct purchase vs. Contact admin
          </span>
          <select
            value={level}
            onChange={(e) => setLevel(e.target.value as ToolAccessLevel)}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="public">Public — anyone can view</option>
            <option value="logged_in">Logged-in only</option>
            <option value="purchased">Subscribers only (direct purchase)</option>
          </select>
        </label>
      </Card>

      <Card title="Shared vs. Private access">
        <div className="grid gap-3 sm:grid-cols-2">
          <ToggleRow
            icon={<Users className="h-4 w-4" />}
            label="Shared Access"
            desc="Users share one login. Enable to sell shared plans."
            value={shared}
            onChange={setShared}
          />
          <ToggleRow
            icon={<Lock className="h-4 w-4" />}
            label="Private Access"
            desc="Dedicated account. Enable to sell private plans."
            value={priv}
            onChange={setPriv}
          />
        </div>
      </Card>

      <Card title="One-Click Login" icon={<Zap className="h-4 w-4" />}>
        <label className="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={ocEnabled}
            onChange={(e) => setOcEnabled(e.target.checked)}
            className="h-4 w-4"
          />
          <span>
            Show subscribers a single <strong>Launch Tool</strong> button instead of the raw credentials.
          </span>
        </label>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Input
            label="Official Login URL"
            value={ocUrl}
            onChange={setOcUrl}
            placeholder="https://example.com/login"
            full
          />
          <Input
            label="Authentication Provider (optional)"
            value={ocProvider}
            onChange={setOcProvider}
            placeholder="OAuth, SAML, Magic link…"
          />
          <label className="text-xs font-medium">
            <span className="text-muted-foreground">Launch mode</span>
            <select
              value={ocMode}
              onChange={(e) => setOcMode(e.target.value as LaunchMode)}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="new_tab">New tab (recommended)</option>
              <option value="popup">Popup window</option>
              <option value="same_tab">Same tab</option>
            </select>
          </label>
          <label className="inline-flex items-center gap-2 text-xs font-medium sm:col-span-2">
            <input
              type="checkbox"
              checked={ocDisplayCreds}
              onChange={(e) => setOcDisplayCreds(e.target.checked)}
              className="h-4 w-4"
            />
            <span>
              When One-Click Login is OFF, keep showing stored credentials to subscribers.
            </span>
          </label>
        </div>
        <div className="mt-3">
          <button
            type="button"
            onClick={() =>
              launchTool(tool, {
                one_click_auth_enabled: true,
                official_login_url: ocUrl,
                launch_mode: ocMode,
              })
            }
            className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted"
          >
            Test launch
          </button>
        </div>
      </Card>

      <div className="flex justify-end">
        <button
          onClick={save}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-md bg-gradient-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-glow hover:opacity-90 disabled:opacity-50"
        >
          <Save className="h-4 w-4" /> {busy ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  );
}

function ToggleRow({
  icon,
  label,
  desc,
  value,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  desc: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="rounded-xl border bg-background p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold">
            {icon}
            {label}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{desc}</p>
        </div>
        <button
          type="button"
          onClick={() => onChange(!value)}
          aria-pressed={value}
          className={`inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition ${
            value ? "bg-primary/80 border-primary" : "bg-muted border-input"
          }`}
        >
          <span
            className={`inline-block h-5 w-5 rounded-full bg-background shadow transition ${
              value ? "translate-x-5" : "translate-x-0.5"
            }`}
          />
        </button>
      </div>
    </div>
  );
}

/* ------------------------------ Pricing ------------------------------ */

type Period = "monthly" | "quarterly" | "yearly";
const PERIODS: Period[] = ["monthly", "quarterly", "yearly"];
const PERIOD_LABEL: Record<Period, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
};
const PERIOD_UNIT: Record<Period, string> = {
  monthly: "month",
  quarterly: "quarter",
  yearly: "year",
};

function periodOf(o: ToolPricingOption): Period | "other" {
  return normaliseBillingKind(getBillingKind({ unit: o.unit ?? null })) as
    | Period
    | "other";
}

function PricingTab({ slug }: { slug: string }) {
  const { data } = useSuspenseQuery(pricingQuery);
  const opts = data.options.filter((o) => o.tool_slug === slug);
  const qc = useQueryClient();
  const router = useRouter();
  const upsert = useServerFn(upsertToolPricing);
  const remove = useServerFn(deleteToolPricing);
  const [busy, setBusy] = useState<string | null>(null);

  async function refresh() {
    await qc.invalidateQueries({ queryKey: ["tool-pricing"] });
    router.invalidate();
  }

  async function saveRow(payload: {
    id?: string;
    access_type: AccessType;
    period: Period;
    amount: string;
    enabled: boolean;
  }) {
    const key = payload.id ?? `${slug}-${payload.access_type}-${payload.period}`;
    setBusy(key);
    try {
      const n = Number(payload.amount);
      if (payload.enabled && (!Number.isFinite(n) || n <= 0)) {
        throw new Error("Enter a price greater than zero, or disable this plan.");
      }
      await upsert({
        data: {
          id: payload.id,
          tool_slug: slug,
          access_type: payload.access_type,
          label: null,
          amount: payload.amount === "" ? null : n,
          unit: PERIOD_UNIT[payload.period],
          currency: "₦",
          contact_admin: false,
          sort_order:
            (payload.access_type === "shared" ? 0 : 10) +
            (payload.period === "monthly" ? 1 : payload.period === "quarterly" ? 2 : 3),
          enabled: payload.enabled,
          note: null,
          badge: null,
          paystack_plan_code: null,
        },
      });
      toast.success("Price saved");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(null);
    }
  }

  async function del(id: string) {
    if (!confirm("Delete this plan?")) return;
    setBusy(id);
    try {
      await remove({ data: { id } });
      toast.success("Deleted");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Set Shared and Private prices for Monthly, Quarterly, and Yearly. Amounts are in ₦. Turn plans off to hide them from customers without deleting existing subscribers' access.
      </p>
      <PriceGroup
        title="Shared Access"
        icon={<Users className="h-4 w-4" />}
        access="shared"
        opts={opts.filter((o) => (o.access_type ?? "shared") === "shared")}
        busy={busy}
        onSave={saveRow}
        onDelete={del}
      />
      <PriceGroup
        title="Private Access"
        icon={<Lock className="h-4 w-4" />}
        access="private"
        opts={opts.filter((o) => o.access_type === "private")}
        busy={busy}
        onSave={saveRow}
        onDelete={del}
      />
    </div>
  );
}

function PriceGroup({
  title,
  icon,
  access,
  opts,
  busy,
  onSave,
  onDelete,
}: {
  title: string;
  icon: React.ReactNode;
  access: AccessType;
  opts: ToolPricingOption[];
  busy: string | null;
  onSave: (p: {
    id?: string;
    access_type: AccessType;
    period: Period;
    amount: string;
    enabled: boolean;
  }) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="rounded-2xl border bg-card p-5 shadow-card">
      <div className="mb-4 flex items-center gap-2 text-sm font-semibold">
        {icon}
        {title}
      </div>
      <div className="space-y-2">
        {PERIODS.map((p) => {
          const row = opts.find((o) => periodOf(o) === p);
          return (
            <PriceRow
              key={p}
              access={access}
              period={p}
              row={row}
              busy={busy}
              onSave={onSave}
              onDelete={onDelete}
            />
          );
        })}
      </div>
    </div>
  );
}

function PriceRow({
  access,
  period,
  row,
  busy,
  onSave,
  onDelete,
}: {
  access: AccessType;
  period: Period;
  row: ToolPricingOption | undefined;
  busy: string | null;
  onSave: (p: {
    id?: string;
    access_type: AccessType;
    period: Period;
    amount: string;
    enabled: boolean;
  }) => void;
  onDelete: (id: string) => void;
}) {
  const [amount, setAmount] = useState(row?.amount == null ? "" : String(row.amount));
  const [enabled, setEnabled] = useState(row?.enabled ?? true);
  const rowKey = row?.id ?? `${access}-${period}`;
  const isBusy = busy === rowKey;

  return (
    <div className="grid items-center gap-2 rounded-lg border bg-background px-3 py-2 sm:grid-cols-12">
      <div className="sm:col-span-2">
        <span className="rounded-md bg-muted px-2 py-1 text-[11px] font-semibold">
          {PERIOD_LABEL[period]}
        </span>
      </div>
      <label className="flex items-center gap-1.5 text-xs sm:col-span-2">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        {enabled ? "Enabled" : "Disabled"}
      </label>
      <div className="sm:col-span-5">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">₦</span>
          <input
            type="number"
            min={0}
            value={amount}
            placeholder="Amount"
            onChange={(e) => setAmount(e.target.value)}
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
          />
        </div>
      </div>
      <div className="flex items-center justify-end gap-1 sm:col-span-3">
        <button
          disabled={isBusy}
          onClick={() =>
            onSave({ id: row?.id, access_type: access, period, amount, enabled })
          }
          className="inline-flex items-center gap-1 rounded-md bg-gradient-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground shadow-glow hover:opacity-90 disabled:opacity-50"
        >
          <Save className="h-3.5 w-3.5" /> Save
        </button>
        {row?.id ? (
          <button
            disabled={isBusy}
            onClick={() => onDelete(row.id)}
            className="inline-flex items-center gap-1 rounded-md border border-destructive/40 px-2 py-1.5 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        ) : (
          <Plus className="h-4 w-4 text-muted-foreground" />
        )}
      </div>
    </div>
  );
}

/* ---------------------------- Credentials ---------------------------- */

function CredentialsTab({ tool }: { tool: (typeof TOOLS)[number] }) {
  const { data } = useSuspenseQuery(credsQuery);
  const current = data.credentials.find((c) => c.tool_slug === tool.slug);
  const upsert = useServerFn(adminUpsertToolCredential);
  const router = useRouter();
  const qc = useQueryClient();
  const [email, setEmail] = useState(current?.login_email ?? "");
  const [password, setPassword] = useState(current?.login_password ?? "");
  const [url, setUrl] = useState(current?.login_url ?? (tool.domain ? `https://${tool.domain}` : ""));
  const [notes, setNotes] = useState(current?.login_notes ?? "");
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await upsert({
        data: {
          tool_slug: tool.slug,
          login_email: email || null,
          login_password: password || null,
          login_url: url || null,
          login_notes: notes || null,
        },
      });
      toast.success("Credentials saved");
      await qc.invalidateQueries({ queryKey: ["admin-credentials"] });
      router.invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card title="Shared login credentials">
      <p className="mb-4 text-xs text-muted-foreground">
        Shown to subscribers with an active plan. Hidden automatically on expiry.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Login email" value={email} onChange={setEmail} placeholder="account@example.com" />
        <label className="text-xs font-medium">
          <span className="text-muted-foreground">Password</span>
          <div className="relative mt-1">
            <input
              type={show ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full rounded-md border border-input bg-background px-3 py-2 pr-9 text-sm"
            />
            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={show ? "Hide" : "Show"}
            >
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </label>
        <Input label="Login URL" value={url} onChange={setUrl} placeholder="https://example.com/login" full />
        <label className="text-xs font-medium sm:col-span-2">
          <span className="text-muted-foreground">Notes shown to subscribers (optional)</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </label>
      </div>
      <div className="mt-4 flex justify-end">
        <button
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-md bg-gradient-primary px-4 py-2 text-xs font-semibold text-primary-foreground shadow-glow hover:opacity-90 disabled:opacity-60"
        >
          <Save className="h-3.5 w-3.5" /> {saving ? "Saving…" : "Save credentials"}
        </button>
      </div>
    </Card>
  );
}

/* ------------------------------ Orders ------------------------------ */

function OrdersTab({ slug }: { slug: string }) {
  const { data } = useSuspenseQuery(ordersQuery);
  const rows = useMemo(
    () => data.orders.filter((o) => o.tool_slug === slug),
    [data.orders, slug],
  );

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border bg-card p-10 text-center text-sm text-muted-foreground shadow-card">
        No orders yet for this tool.
      </div>
    );
  }

  return (
    <div className="rounded-2xl border bg-card shadow-card">
      <div className="flex items-center justify-between border-b p-4">
        <div className="text-sm font-semibold">Subscribers & orders</div>
        <Link
          to="/admin/orders"
          className="text-xs font-semibold text-primary hover:underline"
        >
          Full orders view →
        </Link>
      </div>
      <ul className="divide-y">
        {rows.map((o) => (
          <li key={o.id} className="flex flex-wrap items-center gap-3 p-4 text-sm">
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{o.price_label ?? o.tool_slug}</div>
              <div className="text-xs text-muted-foreground">
                {new Date(o.created_at).toLocaleString()}
              </div>
            </div>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                o.status === "approved"
                  ? "bg-success/15 text-success"
                  : o.status === "pending"
                    ? "bg-warning/15 text-warning"
                    : "bg-destructive/10 text-destructive"
              }`}
            >
              {o.status}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ------------------------------ shared ------------------------------ */

function Card({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border bg-card p-5 shadow-card">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
        {icon}
        {title}
      </div>
      {children}
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
  placeholder,
  full,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  full?: boolean;
}) {
  return (
    <label className={`text-xs font-medium ${full ? "sm:col-span-2" : ""}`}>
      <span className="text-muted-foreground">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
      />
    </label>
  );
}
