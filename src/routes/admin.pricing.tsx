import { AdminShell } from "@/components/admin/AdminShell";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { requireAdminOrRedirect } from "@/lib/admin-gate";
import { useServerFn } from "@tanstack/react-start";
import { queryOptions, useSuspenseQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Plus, Save, Tag, Trash2, ShieldAlert, Lock, Users, AlertTriangle } from "lucide-react";
import { useCatalogRegistration } from "@/hooks/use-catalog-registration";
import { getIsAdmin } from "@/lib/site-settings.functions";
import {
  listToolPricing,
  upsertToolPricing,
  deleteToolPricing,
  formatPrice,
  type ToolPricingOption,
  type AccessType,
} from "@/lib/tool-pricing.functions";
import {
  listToolSettings,
  adminUpsertToolSetting,
  type ToolSetting,
} from "@/lib/access.functions";
import { getBillingKind, normaliseBillingKind } from "@/lib/currency";

const pricingQuery = queryOptions({
  queryKey: ["tool-pricing"],
  queryFn: () => listToolPricing(),
});
const settingsQuery = queryOptions({
  queryKey: ["tool-settings"],
  queryFn: () => listToolSettings(),
});

export const Route = createFileRoute("/admin/pricing")({
  ssr: false,
  beforeLoad: async () => { await requireAdminOrRedirect(); },
  head: () => ({
    meta: [
      { title: "Pricing — Admin — Top Rated SEO Tools" },
      { name: "robots", content: "noindex" },
    ],
  }),
  loader: async ({ context }) => {
    const [{ isAdmin }] = await Promise.all([
      getIsAdmin(),
      context.queryClient.ensureQueryData(pricingQuery),
      context.queryClient.ensureQueryData(settingsQuery),
    ]);
    return { isAdmin };
  },
  component: AdminPricingPage,
});

type Draft = {
  id?: string;
  tool_slug: string;
  access_type: AccessType;
  label: string;
  amount: string;
  unit: string;
  currency: string;
  contact_admin: boolean;
  sort_order: number;
  enabled: boolean;
  note: string;
  badge: string;
  paystack_plan_code: string;
};

function toDraft(opt: ToolPricingOption): Draft {
  return {
    id: opt.id,
    tool_slug: opt.tool_slug,
    access_type: opt.access_type ?? "shared",
    label: opt.label ?? "",
    amount: opt.amount == null ? "" : String(opt.amount),
    unit: opt.unit ?? "",
    currency: opt.currency ?? "₦",
    contact_admin: opt.contact_admin,
    sort_order: opt.sort_order,
    enabled: opt.enabled ?? true,
    note: opt.note ?? "",
    badge: opt.badge ?? "",
    paystack_plan_code: opt.paystack_plan_code ?? "",
  };
}

function periodOfDraft(d: Pick<Draft, "unit">): "monthly" | "quarterly" | "yearly" | "other" {
  return normaliseBillingKind(getBillingKind({ unit: d.unit || null }));
}

function AdminPricingPage() {
  const { isAdmin } = Route.useLoaderData();
  const router = useRouter();
  const qc = useQueryClient();
  const { data } = useSuspenseQuery(pricingQuery);
  const { data: settingsData } = useSuspenseQuery(settingsQuery);
  const upsert = useServerFn(upsertToolPricing);
  const remove = useServerFn(deleteToolPricing);
  const upsertSetting = useServerFn(adminUpsertToolSetting);
  const [busy, setBusy] = useState<string | null>(null);
  const settingsBySlug = new Map<string, ToolSetting>(
    settingsData.settings.map((s) => [s.tool_slug, s]),
  );

  async function toggleAccess(slug: string, field: "shared_access_enabled" | "private_access_enabled", value: boolean) {
    const key = `${slug}-${field}`;
    setBusy(key);
    try {
      await upsertSetting({ data: { tool_slug: slug, [field]: value } });
      toast.success(value ? "Access enabled" : "Access disabled — existing subscribers unaffected");
      await qc.invalidateQueries({ queryKey: ["tool-settings"] });
      router.invalidate();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(null);
    }
  }

  if (!isAdmin) {
    return (
      <AdminShell>
        <div className="mx-auto max-w-xl px-4 py-24 text-center">
          <ShieldAlert className="mx-auto h-10 w-10 text-destructive" />
          <h1 className="mt-4 text-2xl font-semibold">Admins only</h1>
        </div>
      </AdminShell>
    );
  }

  async function refresh() {
    await qc.invalidateQueries({ queryKey: ["tool-pricing"] });
    router.invalidate();
  }

  async function save(draft: Draft) {
    const key = draft.id ?? `${draft.tool_slug}-new`;
    setBusy(key);
    try {
      // Independent validation for enabled non-contact plans.
      if (draft.enabled && !draft.contact_admin) {
        const n = Number(draft.amount);
        if (draft.amount === "" || !Number.isFinite(n) || n <= 0) {
          throw new Error("Enabled plans need a price greater than zero. Disable or set a valid amount.");
        }
      }
      await upsert({
        data: {
          id: draft.id,
          tool_slug: draft.tool_slug,
          access_type: draft.access_type,
          label: draft.label.trim() || null,
          amount: draft.contact_admin
            ? null
            : draft.amount === ""
              ? null
              : Number(draft.amount),
          unit: draft.contact_admin ? null : draft.unit.trim() || null,
          currency: draft.currency || "₦",
          contact_admin: draft.contact_admin,
          sort_order: draft.sort_order,
          enabled: draft.enabled,
          note: draft.note.trim() || null,
          badge: draft.badge.trim() || null,
          paystack_plan_code: draft.paystack_plan_code.trim() || null,
        },
      });
      toast.success("Pricing saved");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(null);
    }
  }

  async function del(id: string) {
    if (!confirm("Delete this pricing option?")) return;
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

  const byTool = new Map<string, ToolPricingOption[]>();
  for (const o of data.options) {
    const a = byTool.get(o.tool_slug) ?? [];
    a.push(o);
    byTool.set(o.tool_slug, a);
  }

  return (
    <AdminShell>
      <section className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3">
          <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-primary text-primary-foreground shadow-glow">
            <Tag className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Tool pricing</h1>
            <p className="text-sm text-muted-foreground">
              Configure Shared Access and Private Access plans (Monthly, Quarterly, Yearly). Each plan can be enabled or disabled independently.
            </p>
          </div>
        </div>

        <div className="mt-8 space-y-6">
          {catalog.map((t) => {
            const opts = byTool.get(t.slug) ?? [];
            const hasEnabled = opts.some((o) => o.enabled && (!o.contact_admin ? Number(o.amount) > 0 : true));
            const setting = settingsBySlug.get(t.slug);
            const sharedOn = setting?.shared_access_enabled ?? true;
            const privateOn = setting?.private_access_enabled ?? true;
            return (
              <div key={t.slug} className="rounded-2xl border bg-card p-5 shadow-card">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-semibold">{t.name}</div>
                    <div className="text-xs text-muted-foreground">{t.category} · {t.slug}</div>
                  </div>
                  {!hasEnabled && opts.length > 0 ? (
                    <span className="inline-flex items-center gap-1 rounded-md bg-warning/15 px-2 py-1 text-[11px] font-medium text-warning">
                      <AlertTriangle className="h-3 w-3" /> No enabled plan
                    </span>
                  ) : null}
                </div>

                <AccessGroup
                  title="Shared Access"
                  icon={<Users className="h-4 w-4" />}
                  accessType="shared"
                  tool={t}
                  opts={opts.filter((o) => (o.access_type ?? "shared") === "shared")}
                  busyKey={busy}
                  onSave={save}
                  onDelete={del}
                  onAdd={(period) =>
                    save(newDraft(t.slug, "shared", period, opts.length))
                  }
                  masterEnabled={sharedOn}
                  masterBusy={busy === `${t.slug}-shared_access_enabled`}
                  onToggleMaster={(v) => toggleAccess(t.slug, "shared_access_enabled", v)}
                />

                <AccessGroup
                  title="Private Access"
                  icon={<Lock className="h-4 w-4" />}
                  accessType="private"
                  tool={t}
                  opts={opts.filter((o) => o.access_type === "private")}
                  busyKey={busy}
                  onSave={save}
                  onDelete={del}
                  onAdd={(period) =>
                    save(newDraft(t.slug, "private", period, opts.length))
                  }
                  masterEnabled={privateOn}
                  masterBusy={busy === `${t.slug}-private_access_enabled`}
                  onToggleMaster={(v) => toggleAccess(t.slug, "private_access_enabled", v)}
                />
              </div>
            );
          })}
        </div>
      </section>
    </AdminShell>
  );
}

function newDraft(
  slug: string,
  access: AccessType,
  period: "monthly" | "quarterly" | "yearly" | "other",
  sort: number,
): Draft {
  const unit =
    period === "monthly" ? "month" : period === "quarterly" ? "quarter" : period === "yearly" ? "year" : "";
  const duration =
    period === "monthly" ? 28 : period === "quarterly" ? 90 : period === "yearly" ? 365 : 0;
  return {
    tool_slug: slug,
    access_type: access,
    label: "",
    amount: "",
    unit,
    currency: "₦",
    contact_admin: false,
    sort_order: sort,
    // New plans default to Enabled so a saved row with a valid amount is
    // immediately visible to customers — the admin can still uncheck it.
    enabled: true,
    note: "",
    badge: "",
    paystack_plan_code: "",
    // Duration hints are set on save via a follow-up admin edit if needed
    // (kept out of the draft here to preserve the existing schema shape).
    ...(duration ? {} : {}),
  };
}

function AccessGroup({
  title,
  icon,
  accessType,
  tool,
  opts,
  busyKey,
  onSave,
  onDelete,
  onAdd,
  masterEnabled,
  masterBusy,
  onToggleMaster,
}: {
  title: string;
  icon: React.ReactNode;
  accessType: AccessType;
  tool: { slug: string };
  opts: ToolPricingOption[];
  busyKey: string | null;
  onSave: (d: Draft) => void;
  onDelete: (id: string) => void;
  onAdd: (period: "monthly" | "quarterly" | "yearly" | "other") => void;
  masterEnabled: boolean;
  masterBusy: boolean;
  onToggleMaster: (v: boolean) => void;
}) {
  const periods: Array<"monthly" | "quarterly" | "yearly"> = ["monthly", "quarterly", "yearly"];
  const others = opts.filter((o) => periodOfDraft({ unit: o.unit ?? "" }) === "other");

  return (
    <div className={`mt-5 rounded-xl border p-4 ${masterEnabled ? "bg-background/40" : "bg-muted/30"}`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          {icon}
          <span>{title}</span>
          {!masterEnabled ? (
            <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Disabled
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground">
            {masterEnabled ? "Available for new purchases" : "Hidden from new purchases · existing subscribers unaffected"}
          </span>
          <button
            type="button"
            disabled={masterBusy}
            onClick={() => onToggleMaster(!masterEnabled)}
            aria-pressed={masterEnabled}
            className={`inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition disabled:opacity-50 ${
              masterEnabled ? "bg-primary/80 border-primary" : "bg-muted border-input"
            }`}
          >
            <span
              className={`inline-block h-5 w-5 rounded-full bg-background shadow transition ${
                masterEnabled ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
      </div>
      {!masterEnabled ? (
        <p className="mb-3 rounded-md border border-dashed bg-background/40 px-3 py-2 text-[11px] text-muted-foreground">
          {title} is turned off for {tool.slug}. New customers won't see these plans. Turn it back on to resume sales.
        </p>
      ) : null}
      <div className="space-y-3">
        {periods.map((p) => {
          const row = opts.find((o) => periodOfDraft({ unit: o.unit ?? "" }) === p);
          if (row) {
            return (
              <PricingRow
                key={row.id}
                initial={toDraft(row)}
                busy={busyKey === row.id}
                onSave={onSave}
                onDelete={() => onDelete(row.id)}
                periodLabel={labelFor(p)}
              />
            );
          }
          return (
            <button
              key={p}
              onClick={() => onAdd(p)}
              className="flex w-full items-center justify-between gap-2 rounded-lg border border-dashed bg-background/40 px-3 py-2 text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground"
            >
              <span className="font-medium">Add {labelFor(p)} plan</span>
              <Plus className="h-3.5 w-3.5" />
            </button>
          );
        })}
        {others.length > 0 ? (
          <div className="mt-3 space-y-2">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Other plans (custom unit)</div>
            {others.map((row) => (
              <PricingRow
                key={row.id}
                initial={toDraft(row)}
                busy={busyKey === row.id}
                onSave={onSave}
                onDelete={() => onDelete(row.id)}
                periodLabel="Custom"
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function labelFor(p: "monthly" | "quarterly" | "yearly"): string {
  if (p === "monthly") return "Monthly";
  if (p === "quarterly") return "Quarterly";
  return "Yearly";
}

function PricingRow({
  initial,
  busy,
  onSave,
  onDelete,
  periodLabel,
}: {
  initial: Draft;
  busy: boolean;
  onSave: (d: Draft) => void;
  onDelete: () => void;
  periodLabel: string;
}) {
  const [d, setD] = useState<Draft>(initial);

  return (
    <div className="grid gap-2 rounded-lg border bg-background px-3 py-3 sm:grid-cols-12 sm:items-center">
      <div className="flex items-center gap-2 sm:col-span-2">
        <span className="rounded-md bg-muted px-2 py-1 text-[11px] font-semibold">{periodLabel}</span>
      </div>
      <label className="flex items-center gap-1.5 text-xs sm:col-span-2">
        <input
          type="checkbox"
          checked={d.enabled}
          onChange={(e) => setD({ ...d, enabled: e.target.checked })}
        />
        {d.enabled ? "Enabled" : "Disabled"}
      </label>
      <input
        placeholder="Currency"
        value={d.currency}
        onChange={(e) => setD({ ...d, currency: e.target.value })}
        disabled={d.contact_admin}
        className="rounded-md border bg-background px-2 py-1.5 text-xs disabled:opacity-50 sm:col-span-1"
      />
      <input
        placeholder="Amount"
        type="number"
        min={0}
        value={d.amount}
        onChange={(e) => setD({ ...d, amount: e.target.value })}
        disabled={d.contact_admin}
        className="rounded-md border bg-background px-2 py-1.5 text-xs disabled:opacity-50 sm:col-span-2"
      />
      <input
        placeholder="Unit (month/quarter/year/check)"
        value={d.unit}
        onChange={(e) => setD({ ...d, unit: e.target.value })}
        disabled={d.contact_admin}
        className="rounded-md border bg-background px-2 py-1.5 text-xs disabled:opacity-50 sm:col-span-3"
      />
      <div className="flex items-center gap-1 sm:col-span-2 sm:justify-end">
        <button
          disabled={busy}
          onClick={() => onSave(d)}
          className="inline-flex items-center gap-1 rounded-md bg-gradient-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground shadow-glow hover:opacity-90 disabled:opacity-50"
        >
          <Save className="h-3.5 w-3.5" /> Save
        </button>
        <button
          disabled={busy}
          onClick={onDelete}
          className="inline-flex items-center gap-1 rounded-md border border-destructive/40 px-2 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <input
        placeholder="Optional plan label"
        value={d.label}
        onChange={(e) => setD({ ...d, label: e.target.value })}
        className="rounded-md border bg-background px-2 py-1.5 text-xs sm:col-span-4"
      />
      <input
        placeholder="Badge (e.g. Best value)"
        value={d.badge}
        onChange={(e) => setD({ ...d, badge: e.target.value })}
        className="rounded-md border bg-background px-2 py-1.5 text-xs sm:col-span-3"
      />
      <input
        placeholder="Paystack plan code (optional)"
        value={d.paystack_plan_code}
        onChange={(e) => setD({ ...d, paystack_plan_code: e.target.value })}
        className="rounded-md border bg-background px-2 py-1.5 text-xs sm:col-span-5"
      />
      <input
        placeholder="Optional note shown near the price"
        value={d.note}
        onChange={(e) => setD({ ...d, note: e.target.value })}
        className="rounded-md border bg-background px-2 py-1.5 text-xs sm:col-span-9"
      />
      <label className="flex items-center gap-1.5 text-xs sm:col-span-3">
        <input
          type="checkbox"
          checked={d.contact_admin}
          onChange={(e) => setD({ ...d, contact_admin: e.target.checked })}
        />
        Contact-admin
      </label>
      <div className="text-[11px] text-muted-foreground sm:col-span-12">
        Preview:{" "}
        <span className="font-medium text-foreground">
          {formatPrice({
            id: "preview",
            tool_slug: d.tool_slug,
            label: d.label || null,
            amount: d.amount === "" ? null : Number(d.amount),
            unit: d.unit || null,
            currency: d.currency || "₦",
            contact_admin: d.contact_admin,
            sort_order: d.sort_order,
            duration_days: null,
            grace_days: 0,
            warning_days: 0,
            access_type: d.access_type,
            billing_period: null,
            enabled: d.enabled,
            note: d.note || null,
            badge: d.badge || null,
            paystack_plan_code: d.paystack_plan_code || null,
          })}
        </span>

        {!d.enabled ? (
          <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide">Hidden from customers</span>
        ) : null}
      </div>
    </div>
  );
}
