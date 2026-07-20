/**
 * Central currency + billing helpers.
 *
 * The `tool_pricing` table stores amounts in NAIRA (numeric(12,2)), never
 * kobo. All display code should route through these helpers so a change
 * to the storage convention only touches one file.
 *
 * Billing period is derived from `unit` on the pricing row:
 *   - "month" / "monthly" / "mo"                    → monthly
 *   - "quarter" / "quarterly" / "3month" / "3mo"    → quarterly
 *   - "year" / "annual" / "yearly" / "yr"           → yearly
 *   - anything else (e.g. "check")                  → other (pay-per-use)
 *
 * Customer-facing wording is always "Yearly" (never "Annual"), but the
 * underlying `unit` value on existing rows may still be "year" — both are
 * accepted.
 */
import type { ToolPricingOption } from "@/lib/tool-pricing.functions";

/**
 * `annual` is kept as a legacy alias equivalent to `yearly` so nothing that
 * still narrows on the old kind breaks. New code should prefer `yearly`.
 */
export type BillingKind = "monthly" | "quarterly" | "yearly" | "annual" | "other";

export function getBillingKind(
  opt: { unit?: string | null; billing_period?: string | null },
): BillingKind {
  const bp = (opt.billing_period ?? "").toLowerCase().trim();
  if (bp === "monthly") return "monthly";
  if (bp === "quarterly") return "quarterly";
  if (bp === "yearly" || bp === "annual") return "yearly";
  const u = (opt.unit ?? "").toLowerCase().trim();
  if (u === "month" || u === "monthly" || u === "mo") return "monthly";
  if (
    u === "quarter" ||
    u === "quarterly" ||
    u === "3month" ||
    u === "3months" ||
    u === "3mo" ||
    u === "quarter-year"
  )
    return "quarterly";
  if (u === "year" || u === "annual" || u === "yearly" || u === "yr") return "yearly";
  return "other";
}


/** Normalised, comparable kind — folds legacy "annual" into "yearly". */
export function normaliseBillingKind(k: BillingKind): "monthly" | "quarterly" | "yearly" | "other" {
  if (k === "annual") return "yearly";
  return k;
}

/** Customer-facing period name. */
export function billingPeriodLabel(kind: BillingKind): string {
  const n = normaliseBillingKind(kind);
  if (n === "monthly") return "Monthly";
  if (n === "quarterly") return "Quarterly";
  if (n === "yearly") return "Yearly";
  return "";
}

/** "₦5,000" — no decimals unless present and non-zero. */
export function formatCurrency(amount: number | null | undefined, currency = "₦"): string {
  if (amount == null || !Number.isFinite(Number(amount))) return "";
  const n = Number(amount);
  const hasFraction = Math.round(n * 100) % 100 !== 0;
  const formatted = n.toLocaleString("en-NG", {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: hasFraction ? 2 : 0,
  });
  return `${currency}${formatted}`;
}

/** "per month" / "every three months" / "per year" / "per check". */
export function billingSuffix(opt: Pick<ToolPricingOption, "unit">): string {
  const kind = normaliseBillingKind(getBillingKind(opt));
  if (kind === "monthly") return "per month";
  if (kind === "quarterly") return "every three months";
  if (kind === "yearly") return "per year";
  return opt.unit ? `per ${opt.unit}` : "";
}

/** Customer-facing "Billed …" line. */
export function billingDescription(kind: BillingKind): string {
  const n = normaliseBillingKind(kind);
  if (n === "monthly") return "Billed every month";
  if (n === "quarterly") return "Billed every three months";
  if (n === "yearly") return "Billed once per year";
  return "";
}

export function renewalText(kind: BillingKind): string {
  const n = normaliseBillingKind(kind);
  if (n === "monthly")
    return "Renews automatically every month until renewal is disabled.";
  if (n === "quarterly")
    return "Renews automatically every three months until renewal is disabled.";
  if (n === "yearly")
    return "Renews automatically every year until renewal is disabled.";
  return "";
}

/** "₦5,000 per month" — a11y-friendly full price. */
export function formatPlanPrice(
  opt: Pick<ToolPricingOption, "amount" | "unit" | "currency" | "contact_admin">,
): string {
  if (opt.contact_admin || opt.amount == null) return "Pricing confirmed on WhatsApp";
  const suffix = billingSuffix(opt);
  const money = formatCurrency(Number(opt.amount), opt.currency || "₦");
  return suffix ? `${money} ${suffix}` : money;
}

/** Compact "₦5,000/month" for tight card layouts. */
export function formatPlanPriceCompact(
  opt: Pick<ToolPricingOption, "amount" | "unit" | "currency" | "contact_admin">,
): string {
  if (opt.contact_admin || opt.amount == null) return "Pricing confirmed on WhatsApp";
  const kind = normaliseBillingKind(getBillingKind(opt));
  const money = formatCurrency(Number(opt.amount), opt.currency || "₦");
  if (kind === "monthly") return `${money}/month`;
  if (kind === "quarterly") return `${money}/quarter`;
  if (kind === "yearly") return `${money}/year`;
  return opt.unit ? `${money} / ${opt.unit}` : money;
}

export interface Saving {
  amount: number;
  percent: number;
  /** How many payments of the base plan were compared against. */
  baseCount: number;
  /** Which base plan we compared against ("monthly" or "quarterly"). */
  baseKind: "monthly" | "quarterly";
}

function computeSaving(
  baseAmount: number | null | undefined,
  targetAmount: number | null | undefined,
  count: number,
  baseKind: "monthly" | "quarterly",
): Saving | null {
  const b = Number(baseAmount);
  const t = Number(targetAmount);
  if (!Number.isFinite(b) || !Number.isFinite(t) || b <= 0 || t <= 0) return null;
  const total = b * count;
  if (t >= total) return null;
  const amount = total - t;
  const percent = Math.round((amount / total) * 100);
  return { amount, percent, baseCount: count, baseKind };
}

/** Quarterly price vs 3× monthly. */
export function computeQuarterlySaving(
  monthlyAmount: number | null | undefined,
  quarterlyAmount: number | null | undefined,
): Saving | null {
  return computeSaving(monthlyAmount, quarterlyAmount, 3, "monthly");
}

/** Yearly price vs 12× monthly. */
export function computeYearlySaving(
  monthlyAmount: number | null | undefined,
  yearlyAmount: number | null | undefined,
): Saving | null {
  return computeSaving(monthlyAmount, yearlyAmount, 12, "monthly");
}

/** Yearly price vs 4× quarterly — only when Monthly is unavailable. */
export function computeYearlyVsQuarterlySaving(
  quarterlyAmount: number | null | undefined,
  yearlyAmount: number | null | undefined,
): Saving | null {
  return computeSaving(quarterlyAmount, yearlyAmount, 4, "quarterly");
}

/** Back-compat: same as computeYearlySaving. Some routes still import this name. */
export const computeAnnualSaving = computeYearlySaving;
export type AnnualSaving = Saving;
