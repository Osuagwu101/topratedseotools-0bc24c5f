import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { queryOptions, useSuspenseQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, TicketPercent, Power, PowerOff } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { requireAdminOrRedirect } from "@/lib/admin-gate";
import {
  adminListCoupons,
  adminCreateCoupon,
  adminUpdateCoupon,
  adminSetCouponActive,
  adminDeleteCoupon,
  adminListCouponRedemptions,
} from "@/lib/coupons.functions";
import type { CouponRow } from "@/lib/coupons";
import { TOOLS } from "@/lib/tools-data";
import { formatCurrency } from "@/lib/currency";

const formatNaira = (n: number) => formatCurrency(n, "₦");

const couponsQuery = queryOptions({
  queryKey: ["admin-coupons"],
  queryFn: () => adminListCoupons(),
});

const redemptionsQuery = queryOptions({
  queryKey: ["admin-coupon-redemptions"],
  queryFn: () => adminListCouponRedemptions(),
});

export const Route = createFileRoute("/admin/settings/coupons")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Coupons — Admin" },
      {
        name: "description",
        content: "Create and manage Naira-based coupon codes for tool checkouts.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  beforeLoad: async () => {
    await requireAdminOrRedirect();
  },
  loader: ({ context }) => context.queryClient.ensureQueryData(couponsQuery),
  component: CouponsAdmin,
});

type FormState = {
  id?: string;
  code: string;
  description: string;
  discount_type: "percent" | "amount";
  discount_value: string;
  tool_slug: string;
  access_type: "" | "shared" | "private";
  billing_period: "" | "monthly" | "quarterly" | "yearly";
  min_amount_ngn: string;
  max_redemptions: string;
  max_per_user: string;
  starts_at: string;
  ends_at: string;
  is_active: boolean;
};

const emptyForm: FormState = {
  code: "",
  description: "",
  discount_type: "percent",
  discount_value: "10",
  tool_slug: "",
  access_type: "",
  billing_period: "",
  min_amount_ngn: "",
  max_redemptions: "",
  max_per_user: "1",
  starts_at: "",
  ends_at: "",
  is_active: true,
};

function toForm(c: CouponRow): FormState {
  return {
    id: c.id,
    code: c.code,
    description: c.description ?? "",
    discount_type: c.discount_type,
    discount_value: String(c.discount_value),
    tool_slug: c.tool_slug ?? "",
    access_type: (c.access_type ?? "") as FormState["access_type"],
    billing_period: (c.billing_period ?? "") as FormState["billing_period"],
    min_amount_ngn: c.min_amount_ngn == null ? "" : String(c.min_amount_ngn),
    max_redemptions: c.max_redemptions == null ? "" : String(c.max_redemptions),
    max_per_user: String(c.max_per_user ?? 1),
    starts_at: c.starts_at ? c.starts_at.slice(0, 10) : "",
    ends_at: c.ends_at ? c.ends_at.slice(0, 10) : "",
    is_active: c.is_active,
  };
}

function CouponsAdmin() {
  const { data } = useSuspenseQuery(couponsQuery);
  const { data: redemptionData } = useSuspenseQuery(redemptionsQuery);
  const qc = useQueryClient();
  const create = useServerFn(adminCreateCoupon);
  const update = useServerFn(adminUpdateCoupon);
  const setActive = useServerFn(adminSetCouponActive);
  const remove = useServerFn(adminDeleteCoupon);

  const [form, setForm] = useState<FormState | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["admin-coupons"] });
    qc.invalidateQueries({ queryKey: ["admin-coupon-redemptions"] });
  };

  async function save() {
    if (!form) return;
    const value = Number(form.discount_value);
    if (!form.code.trim() || !Number.isFinite(value) || value <= 0) {
      toast.error("Enter a code and a discount value above zero");
      return;
    }
    const payload = {
      code: form.code.trim(),
      description: form.description.trim() || null,
      discount_type: form.discount_type,
      discount_value: value,
      tool_slug: form.tool_slug || null,
      access_type: form.access_type || null,
      billing_period: form.billing_period || null,
      min_amount_ngn: form.min_amount_ngn ? Number(form.min_amount_ngn) : null,
      max_redemptions: form.max_redemptions ? Number(form.max_redemptions) : null,
      max_per_user: Number(form.max_per_user) || 0,
      starts_at: form.starts_at ? new Date(form.starts_at).toISOString() : null,
      ends_at: form.ends_at ? new Date(form.ends_at).toISOString() : null,
      is_active: form.is_active,
    };
    setBusy(true);
    try {
      if (form.id) await update({ data: { ...payload, id: form.id } });
      else await create({ data: payload });
      toast.success(form.id ? "Coupon updated" : "Coupon created");
      setForm(null);
      refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save coupon");
    } finally {
      setBusy(false);
    }
  }

  const coupons = data.coupons;
  const redemptions = redemptionData.redemptions;

  const describe = (c: CouponRow) =>
    c.discount_type === "percent"
      ? `${c.discount_value}% off`
      : `${formatNaira(c.discount_value)} off`;

  return (
    <AdminShell>
      <div className="space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold">
              <TicketPercent className="h-6 w-6 text-primary" /> Coupons
            </h1>
            <p className="text-sm text-muted-foreground">
              Discounts are defined in Naira and applied to the base price before currency
              conversion, so every currency gets the same effective saving.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setForm({ ...emptyForm })}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            <Plus className="h-4 w-4" /> New coupon
          </button>
        </header>

        {form ? (
          <div className="rounded-2xl border bg-card p-6 shadow-card">
            <h2 className="text-sm font-semibold">{form.id ? "Edit coupon" : "Create coupon"}</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Code">
                <input
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                  className={inputCls}
                  placeholder="WELCOME10"
                />
              </Field>
              <Field label="Discount type">
                <select
                  value={form.discount_type}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      discount_type: e.target.value as FormState["discount_type"],
                    })
                  }
                  className={inputCls}
                >
                  <option value="percent">Percentage (%)</option>
                  <option value="amount">Fixed amount (₦)</option>
                </select>
              </Field>
              <Field label={form.discount_type === "percent" ? "Percent off" : "Amount off (₦)"}>
                <input
                  type="number"
                  min={0}
                  value={form.discount_value}
                  onChange={(e) => setForm({ ...form, discount_value: e.target.value })}
                  className={inputCls}
                />
              </Field>
              <Field label="Tool (optional)">
                <select
                  value={form.tool_slug}
                  onChange={(e) => setForm({ ...form, tool_slug: e.target.value })}
                  className={inputCls}
                >
                  <option value="">All tools</option>
                  {TOOLS.map((t) => (
                    <option key={t.slug} value={t.slug}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Access type (optional)">
                <select
                  value={form.access_type}
                  onChange={(e) =>
                    setForm({ ...form, access_type: e.target.value as FormState["access_type"] })
                  }
                  className={inputCls}
                >
                  <option value="">Any</option>
                  <option value="shared">Shared</option>
                  <option value="private">Private</option>
                </select>
              </Field>
              <Field label="Billing period (optional)">
                <select
                  value={form.billing_period}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      billing_period: e.target.value as FormState["billing_period"],
                    })
                  }
                  className={inputCls}
                >
                  <option value="">Any</option>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </Field>
              <Field label="Minimum order (₦, optional)">
                <input
                  type="number"
                  min={0}
                  value={form.min_amount_ngn}
                  onChange={(e) => setForm({ ...form, min_amount_ngn: e.target.value })}
                  className={inputCls}
                />
              </Field>
              <Field label="Total uses (blank = unlimited)">
                <input
                  type="number"
                  min={1}
                  value={form.max_redemptions}
                  onChange={(e) => setForm({ ...form, max_redemptions: e.target.value })}
                  className={inputCls}
                />
              </Field>
              <Field label="Uses per customer (0 = unlimited)">
                <input
                  type="number"
                  min={0}
                  value={form.max_per_user}
                  onChange={(e) => setForm({ ...form, max_per_user: e.target.value })}
                  className={inputCls}
                />
              </Field>
              <Field label="Starts (optional)">
                <input
                  type="date"
                  value={form.starts_at}
                  onChange={(e) => setForm({ ...form, starts_at: e.target.value })}
                  className={inputCls}
                />
              </Field>
              <Field label="Ends (optional)">
                <input
                  type="date"
                  value={form.ends_at}
                  onChange={(e) => setForm({ ...form, ends_at: e.target.value })}
                  className={inputCls}
                />
              </Field>
              <Field label="Description (internal)">
                <input
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className={inputCls}
                />
              </Field>
            </div>
            <label className="mt-4 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
              />
              Active
            </label>
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={save}
                disabled={busy}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
              >
                {busy ? "Saving…" : "Save coupon"}
              </button>
              <button
                type="button"
                onClick={() => setForm(null)}
                className="rounded-md border px-4 py-2 text-sm hover:bg-muted"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        <div className="overflow-x-auto rounded-2xl border bg-card shadow-card">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Discount</th>
                <th className="px-4 py-3">Scope</th>
                <th className="px-4 py-3">Used</th>
                <th className="px-4 py-3">Window</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {coupons.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                    No coupons yet.
                  </td>
                </tr>
              ) : (
                coupons.map((c) => (
                  <tr key={c.id} className="border-t">
                    <td className="px-4 py-3 font-mono font-semibold">{c.code}</td>
                    <td className="px-4 py-3">{describe(c)}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {[
                        c.tool_slug ?? "All tools",
                        c.access_type ?? "any access",
                        c.billing_period ?? "any period",
                      ].join(" · ")}
                    </td>
                    <td className="px-4 py-3">
                      {c.redemptions_count ?? 0}
                      {c.max_redemptions ? ` / ${c.max_redemptions}` : ""}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {c.starts_at ? new Date(c.starts_at).toLocaleDateString() : "—"} →{" "}
                      {c.ends_at ? new Date(c.ends_at).toLocaleDateString() : "no end"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          c.is_active
                            ? "rounded-full bg-success/15 px-2 py-0.5 text-xs text-success"
                            : "rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                        }
                      >
                        {c.is_active ? "Active" : "Disabled"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <IconBtn
                          label={c.is_active ? "Disable" : "Enable"}
                          onClick={async () => {
                            await setActive({ data: { id: c.id, is_active: !c.is_active } });
                            refresh();
                          }}
                        >
                          {c.is_active ? (
                            <PowerOff className="h-4 w-4" />
                          ) : (
                            <Power className="h-4 w-4" />
                          )}
                        </IconBtn>
                        <IconBtn label="Edit" onClick={() => setForm(toForm(c))}>
                          <Pencil className="h-4 w-4" />
                        </IconBtn>
                        <IconBtn
                          label="Delete"
                          onClick={async () => {
                            if (!confirm(`Delete coupon ${c.code}?`)) return;
                            try {
                              await remove({ data: { id: c.id } });
                              toast.success("Coupon deleted");
                              refresh();
                            } catch (err) {
                              toast.error(err instanceof Error ? err.message : "Could not delete");
                            }
                          }}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </IconBtn>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="rounded-2xl border bg-card p-6 shadow-card">
          <h2 className="text-sm font-semibold">Recent redemptions</h2>
          {redemptions.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">No coupon has been redeemed yet.</p>
          ) : (
            <ul className="mt-3 divide-y text-sm">
              {redemptions.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="font-mono">{r.coupon_code}</span>
                  <span className="text-muted-foreground">
                    saved {formatNaira(Number(r.discount_amount_ngn ?? 0))} · charged{" "}
                    {Number(r.final_amount ?? 0).toLocaleString()} {r.payment_currency ?? ""}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {r.created_at ? new Date(r.created_at).toLocaleString() : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </AdminShell>
  );
}

const inputCls =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/40";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function IconBtn({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="rounded-md border p-1.5 hover:bg-muted"
    >
      {children}
    </button>
  );
}
