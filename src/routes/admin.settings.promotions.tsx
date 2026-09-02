import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { queryOptions, useSuspenseQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Tag, Power, PowerOff } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { requireAdminOrRedirect } from "@/lib/admin-gate";
import {
  adminListPromotions,
  adminUpsertPromotion,
  adminDeletePromotion,
  adminTogglePromotion,
  type Promotion,
  type PromoAudience,
  type PromoDiscountType,
} from "@/lib/promotions.functions";
import { TOOLS } from "@/lib/tools-data";

const promoQuery = queryOptions({
  queryKey: ["admin-promotions"],
  queryFn: () => adminListPromotions(),
});

export const Route = createFileRoute("/admin/settings/promotions")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Promotions — Admin" }, { name: "robots", content: "noindex" }],
  }),
  beforeLoad: async () => {
    await requireAdminOrRedirect();
  },
  loader: ({ context }) => context.queryClient.ensureQueryData(promoQuery),
  component: PromotionsAdmin,
});

function PromotionsAdmin() {
  const { data } = useSuspenseQuery(promoQuery);
  const qc = useQueryClient();
  const upsert = useServerFn(adminUpsertPromotion);
  const del = useServerFn(adminDeletePromotion);
  const toggle = useServerFn(adminTogglePromotion);
  const [editing, setEditing] = useState<Promotion | null>(null);
  const [creating, setCreating] = useState(false);

  const refresh = () => qc.invalidateQueries({ queryKey: ["admin-promotions"] });

  const isActiveNow = (p: Promotion) => {
    if (!p.is_active) return false;
    const now = Date.now();
    if (p.starts_at && new Date(p.starts_at).getTime() > now) return false;
    if (p.ends_at && new Date(p.ends_at).getTime() < now) return false;
    return true;
  };

  return (
    <AdminShell>
      <section className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3">
          <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-primary text-primary-foreground shadow-glow">
            <Tag className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <h1 className="text-2xl font-semibold tracking-tight">Promotions</h1>
            <p className="text-sm text-muted-foreground">
              Simple offers shown on the customer website. Toggle to activate or pause without
              deleting.
            </p>
          </div>
          <button
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-glow hover:opacity-90"
          >
            <Plus className="h-4 w-4" /> New promotion
          </button>
        </div>

        <div className="mt-6 overflow-hidden rounded-2xl border bg-card shadow-card">
          {data.promotions.length === 0 ? (
            <div className="p-12 text-center text-sm text-muted-foreground">
              No promotions yet. Create one to advertise an offer to customers.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5">Title</th>
                  <th className="px-4 py-2.5">Tool</th>
                  <th className="px-4 py-2.5">Audience</th>
                  <th className="px-4 py-2.5">Discount</th>
                  <th className="px-4 py-2.5">Window</th>
                  <th className="px-4 py-2.5">Status</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {data.promotions.map((p) => (
                  <tr key={p.id} className="border-t">
                    <td className="px-4 py-3">
                      <div className="font-medium">{p.title}</div>
                      {p.description && (
                        <div className="text-xs text-muted-foreground line-clamp-1">
                          {p.description}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs">{p.tool_slug ?? "All tools"}</td>
                    <td className="px-4 py-3 text-xs capitalize">{p.audience}</td>
                    <td className="px-4 py-3 text-xs">
                      {p.discount_type ? `${p.discount_value ?? "—"} ${p.discount_type}` : "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {p.starts_at ? new Date(p.starts_at).toLocaleDateString() : "—"}
                      {" → "}
                      {p.ends_at ? new Date(p.ends_at).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                          isActiveNow(p)
                            ? "bg-success/15 text-success"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {isActiveNow(p) ? "Live" : p.is_active ? "Scheduled" : "Off"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex gap-1">
                        <button
                          onClick={async () => {
                            await toggle({ data: { id: p.id, is_active: !p.is_active } });
                            toast.success(p.is_active ? "Paused" : "Activated");
                            refresh();
                          }}
                          title={p.is_active ? "Pause" : "Activate"}
                          className="rounded-md p-1.5 hover:bg-muted"
                        >
                          {p.is_active ? (
                            <PowerOff className="h-4 w-4" />
                          ) : (
                            <Power className="h-4 w-4" />
                          )}
                        </button>
                        <button
                          onClick={() => setEditing(p)}
                          className="rounded-md p-1.5 hover:bg-muted"
                          title="Edit"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          onClick={async () => {
                            if (!confirm(`Delete "${p.title}"?`)) return;
                            await del({ data: { id: p.id } });
                            toast.success("Deleted");
                            refresh();
                          }}
                          className="rounded-md p-1.5 text-destructive hover:bg-destructive/10"
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {(creating || editing) && (
        <PromoDialog
          promo={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSave={async (payload) => {
            await upsert({ data: payload });
            toast.success(editing ? "Updated" : "Created");
            setCreating(false);
            setEditing(null);
            refresh();
          }}
        />
      )}
    </AdminShell>
  );
}

function PromoDialog({
  promo,
  onClose,
  onSave,
}: {
  promo: Promotion | null;
  onClose: () => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onSave: (p: any) => Promise<void>;
}) {
  const [title, setTitle] = useState(promo?.title ?? "");
  const [description, setDescription] = useState(promo?.description ?? "");
  const [toolSlug, setToolSlug] = useState(promo?.tool_slug ?? "");
  const [audience, setAudience] = useState<PromoAudience>(promo?.audience ?? "all");
  const [discountType, setDiscountType] = useState<PromoDiscountType | "">(
    promo?.discount_type ?? "",
  );
  const [discountValue, setDiscountValue] = useState(
    promo?.discount_value != null ? String(promo.discount_value) : "",
  );
  const [startsAt, setStartsAt] = useState(promo?.starts_at?.slice(0, 10) ?? "");
  const [endsAt, setEndsAt] = useState(promo?.ends_at?.slice(0, 10) ?? "");
  const [isActive, setIsActive] = useState(promo?.is_active ?? true);
  const [busy, setBusy] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-card p-6 shadow-glow">
        <h2 className="text-lg font-semibold">{promo ? "Edit promotion" : "New promotion"}</h2>
        <div className="mt-4 grid gap-3">
          <Field label="Title" required>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={160}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              placeholder="Canva Pro free for 30 days"
            />
          </Field>
          <Field label="Description">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={2000}
              rows={3}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              placeholder="Shown to customers on the tool page."
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Tool (optional)">
              <select
                value={toolSlug}
                onChange={(e) => setToolSlug(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="">All tools</option>
                {TOOLS.map((t) => (
                  <option key={t.slug} value={t.slug}>
                    {t.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Audience">
              <select
                value={audience}
                onChange={(e) => setAudience(e.target.value as PromoAudience)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="all">All customers</option>
                <option value="new">New only</option>
                <option value="existing">Existing only</option>
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Discount type">
              <select
                value={discountType}
                onChange={(e) => setDiscountType(e.target.value as PromoDiscountType | "")}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="">— none —</option>
                <option value="percent">Percent off</option>
                <option value="amount">Amount off (₦)</option>
                <option value="free_days">Free days</option>
                <option value="bundle">Bundled tool</option>
              </select>
            </Field>
            <Field label="Value">
              <input
                type="number"
                value={discountValue}
                onChange={(e) => setDiscountValue(e.target.value)}
                min={0}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                placeholder="e.g. 20"
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Starts">
              <input
                type="date"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </Field>
            <Field label="Ends">
              <input
                type="date"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </Field>
          </div>
          <label className="mt-2 inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="h-4 w-4"
            />
            Active
          </label>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-full border px-4 py-2 text-sm hover:bg-muted"
          >
            Cancel
          </button>
          <button
            disabled={busy || !title.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                await onSave({
                  id: promo?.id,
                  title: title.trim(),
                  description: description.trim() || null,
                  tool_slug: toolSlug || null,
                  audience,
                  discount_type: discountType || null,
                  discount_value: discountValue ? Number(discountValue) : null,
                  starts_at: startsAt ? new Date(startsAt).toISOString() : null,
                  ends_at: endsAt ? new Date(endsAt).toISOString() : null,
                  is_active: isActive,
                });
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Save failed");
              } finally {
                setBusy(false);
              }
            }}
            className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-glow hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  required,
}: {
  label: string;
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <label className="block">
      <div className="mb-1 text-xs font-medium text-muted-foreground">
        {label}
        {required && <span className="text-destructive"> *</span>}
      </div>
      {children}
    </label>
  );
}
