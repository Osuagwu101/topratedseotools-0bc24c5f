/**
 * Public catalogue base-pricing helpers.
 *
 * The public catalogue (homepage showcase, /tools, /pricing, tool page
 * summary) shows ONLY the base monthly price per access type — no billing
 * periods, savings badges, currency conversion or international adjustment.
 * The full plan matrix (Shared/Private × Monthly/Quarterly/Yearly, with
 * currency conversion and adjustment) is revealed only in the
 * "View Plans" / checkout flow, which keeps using the existing logic.
 */
import type { ToolPricingOption, AccessType } from "@/lib/tool-pricing.functions";
import { getBillingKind, normaliseBillingKind } from "@/lib/currency";

export interface AccessAvailability {
  shared_access_enabled?: boolean | null;
  private_access_enabled?: boolean | null;
  shared_access_authorization?: string | null;
  private_access_authorization?: string | null;
}

export interface BasePriceLine {
  access: AccessType;
  /** "Shared access" | "Private access" */
  title: string;
  amount: number;
  currency: string;
  /** e.g. "Shared access from ₦200/month" */
  text: string;
}

/** Admin can disable or leave an access type unauthorised — hide it publicly. */
export function accessAllowed(
  setting: AccessAvailability | undefined | null,
  access: AccessType,
): boolean {
  if (!setting) return true;
  if (access === "shared") {
    return (
      (setting.shared_access_enabled ?? true) !== false &&
      (setting.shared_access_authorization ?? "confirmed") === "confirmed"
    );
  }
  return (
    (setting.private_access_enabled ?? true) !== false &&
    (setting.private_access_authorization ?? "confirmed") === "confirmed"
  );
}

export function formatBaseMonthly(amount: number, currency?: string | null): string {
  const symbol = currency && currency.trim() ? currency.trim() : "₦";
  return `${symbol}${Math.round(amount).toLocaleString("en-NG")}/month`;
}

/** Lowest enabled, purchasable MONTHLY price for one access type. */
function lowestMonthly(
  options: ToolPricingOption[],
  access: AccessType,
): ToolPricingOption | null {
  const rows = options.filter(
    (o) =>
      o.enabled &&
      !o.contact_admin &&
      o.amount != null &&
      (((o.access_type as AccessType) ?? "shared") === access) &&
      normaliseBillingKind(getBillingKind(o)) === "monthly",
  );
  if (rows.length === 0) return null;
  return rows.sort((a, b) => Number(a.amount ?? 0) - Number(b.amount ?? 0))[0];
}

/**
 * Base price lines for one tool: Shared first, Private second.
 * An access type with no monthly pricing (or disabled by Admin) is omitted
 * entirely — never rendered as "unavailable".
 */
export function baseMonthlyLines(
  options: ToolPricingOption[],
  setting?: AccessAvailability | null,
): BasePriceLine[] {
  const lines: BasePriceLine[] = [];
  const specs: Array<{ access: AccessType; title: string }> = [
    { access: "shared", title: "Shared access" },
    { access: "private", title: "Private access" },
  ];
  for (const spec of specs) {
    if (!accessAllowed(setting, spec.access)) continue;
    const opt = lowestMonthly(options, spec.access);
    if (!opt) continue;
    const amount = Number(opt.amount);
    lines.push({
      access: spec.access,
      title: spec.title,
      amount,
      currency: opt.currency ?? "₦",
      text: `${spec.title} from ${formatBaseMonthly(amount, opt.currency)}`,
    });
  }
  return lines;
}
