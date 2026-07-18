/**
 * Central currency + billing helpers.
 *
 * The `tool_pricing` table stores amounts in NAIRA (numeric(12,2)), never
 * kobo. All display code should route through these helpers so a change
 * to the storage convention only touches one file.
 *
 * Billing period is derived from `unit` on the pricing row:
 *   - "month" → monthly plan
 *   - "year"  → annual plan
 *   - anything else (e.g. "check") → other (pay-per-use etc.)
 */
import type { ToolPricingOption } from "@/lib/tool-pricing.functions";

export type BillingKind = "monthly" | "annual" | "other";

export function getBillingKind(opt: Pick<ToolPricingOption, "unit">): BillingKind {
  const u = (opt.unit ?? "").toLowerCase().trim();
  if (u === "month" || u === "monthly" || u === "mo") return "monthly";
  if (u === "year" || u === "annual" || u === "yearly" || u === "yr") return "annual";
  return "other";
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

/** "per month" / "per year" / "per check" — British English. */
export function billingSuffix(opt: Pick<ToolPricingOption, "unit">): string {
  const kind = getBillingKind(opt);
  if (kind === "monthly") return "per month";
  if (kind === "annual") return "per year";
  return opt.unit ? `per ${opt.unit}` : "";
}

export function billingDescription(kind: BillingKind): string {
  if (kind === "monthly") return "Billed monthly";
  if (kind === "annual") return "Billed annually";
  return "";
}

export function renewalText(kind: BillingKind): string {
  if (kind === "monthly")
    return "Renews automatically every month until renewal is disabled.";
  if (kind === "annual")
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
  const kind = getBillingKind(opt);
  const money = formatCurrency(Number(opt.amount), opt.currency || "₦");
  if (kind === "monthly") return `${money}/month`;
  if (kind === "annual") return `${money}/year`;
  return opt.unit ? `${money} / ${opt.unit}` : money;
}

export interface AnnualSaving {
  amount: number;
  percent: number;
  monthlyEquivalent: number;
}

/**
 * Compute savings for an annual plan vs 12× monthly.
 * Returns null when the annual price is not strictly lower than 12× monthly,
 * or when either input is missing / invalid.
 */
export function computeAnnualSaving(
  monthlyAmount: number | null | undefined,
  annualAmount: number | null | undefined,
): AnnualSaving | null {
  const m = Number(monthlyAmount);
  const a = Number(annualAmount);
  if (!Number.isFinite(m) || !Number.isFinite(a) || m <= 0 || a <= 0) return null;
  const twelve = m * 12;
  if (a >= twelve) return null;
  const amount = twelve - a;
  const percent = Math.round((amount / twelve) * 100);
  const monthlyEquivalent = Math.round(a / 12);
  return { amount, percent, monthlyEquivalent };
}
