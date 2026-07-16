import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { queryOptions, useSuspenseQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Plus, Save, Tag, Trash2, ShieldAlert } from "lucide-react";
import { SiteLayout } from "@/components/site/SiteLayout";
import { TOOLS } from "@/lib/tools-data";
import { getIsAdmin } from "@/lib/site-settings.functions";
import {
  listToolPricing,
  upsertToolPricing,
  deleteToolPricing,
  formatPrice,
  type ToolPricingOption,
} from "@/lib/tool-pricing.functions";

const pricingQuery = queryOptions({
  queryKey: ["tool-pricing"],
  queryFn: () => listToolPricing(),
});

export const Route = createFileRoute("/_authenticated/admin/pricing")({
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
    ]);
    return { isAdmin };
  },
  component: AdminPricingPage,
});

type Draft = {
  id?: string;
  tool_slug: string;
  label: string;
  amount: string;
  unit: string;
  currency: string;
  contact_admin: boolean;
  sort_order: number;
};

function toDraft(opt: ToolPricingOption): Draft {
  return {
    id: opt.id,
    tool_slug: opt.tool_slug,
    label: opt.label ?? "",
    amount: opt.amount == null ? "" : String(opt.amount),
    unit: opt.unit ?? "",
    currency: opt.currency ?? "₦",
    contact_admin: opt.contact_admin,
    sort_order: opt.sort_order,
  };
}

function AdminPricingPage() {
  const { isAdmin } = Route.useLoaderData();
  const router = useRouter();
  const qc = useQueryClient();
  const { data } = useSuspenseQuery(pricingQuery);
  const upsert = useServerFn(upsertToolPricing);
  const remove = useServerFn(deleteToolPricing);
  const [busy, setBusy] = useState<string | null>(null);

  if (!isAdmin) {
    return (
      <SiteLayout>
        <div className="mx-auto max-w-xl px-4 py-24 text-center">
          <ShieldAlert className="mx-auto h-10 w-10 text-destructive" />
          <h1 className="mt-4 text-2xl font-semibold">Admins only</h1>
        </div>
      </SiteLayout>
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
      await upsert({
        data: {
          id: draft.id,
          tool_slug: draft.tool_slug,
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
    <SiteLayout>
      <section className="mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3">
          <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-primary text-primary-foreground shadow-glow">
            <Tag className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Tool pricing</h1>
            <p className="text-sm text-muted-foreground">
              Edit per-tool prices shown on the Pricing page and tool detail pages.
            </p>
          </div>
        </div>

        <div className="mt-8 space-y-6">
          {TOOLS.map((t) => {
            const opts = byTool.get(t.slug) ?? [];
            return (
              <div key={t.slug} className="rounded-2xl border bg-card p-5 shadow-card">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-semibold">{t.name}</div>
                    <div className="text-xs text-muted-foreground">{t.category} · {t.slug}</div>
                  </div>
                  <button
                    onClick={() =>
                      save({
                        tool_slug: t.slug,
                        label: "",
                        amount: "",
                        unit: "month",
                        currency: "₦",
                        contact_admin: false,
                        sort_order: opts.length,
                      })
                    }
                    className="inline-flex items-center gap-1 rounded-md border border-input px-3 py-1.5 text-xs font-medium hover:bg-muted"
                  >
                    <Plus className="h-3.5 w-3.5" /> Add option
                  </button>
                </div>

                {opts.length === 0 ? (
                  <p className="mt-4 text-xs text-muted-foreground">
                    No pricing rows yet — customers will see "Contact admin".
                  </p>
                ) : (
                  <div className="mt-4 space-y-3">
                    {opts.map((o) => (
                      <PricingRow
                        key={o.id}
                        initial={toDraft(o)}
                        busy={busy === o.id}
                        onSave={save}
                        onDelete={() => del(o.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </SiteLayout>
  );
}

function PricingRow({
  initial,
  busy,
  onSave,
  onDelete,
}: {
  initial: Draft;
  busy: boolean;
  onSave: (d: Draft) => void;
  onDelete: () => void;
}) {
  const [d, setD] = useState<Draft>(initial);

  return (
    <div className="grid gap-2 rounded-lg border bg-background/40 p-3 sm:grid-cols-12 sm:items-center">
      <input
        placeholder="Label (optional)"
        value={d.label}
        onChange={(e) => setD({ ...d, label: e.target.value })}
        className="rounded-md border bg-background px-2 py-1.5 text-xs sm:col-span-3"
      />
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
        placeholder="Unit (month, year, check…)"
        value={d.unit}
        onChange={(e) => setD({ ...d, unit: e.target.value })}
        disabled={d.contact_admin}
        className="rounded-md border bg-background px-2 py-1.5 text-xs disabled:opacity-50 sm:col-span-3"
      />
      <label className="flex items-center gap-1.5 text-xs sm:col-span-1">
        <input
          type="checkbox"
          checked={d.contact_admin}
          onChange={(e) => setD({ ...d, contact_admin: e.target.checked })}
        />
        Contact
      </label>
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
          })}

        </span>
      </div>
    </div>
  );
}
