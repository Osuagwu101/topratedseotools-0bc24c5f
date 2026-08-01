import { describe, it, expect } from "vitest";
import { baseMonthlyLines } from "../src/lib/base-pricing";
import type { ToolPricingOption } from "../src/lib/tool-pricing.functions";

function opt(o: Partial<ToolPricingOption>): ToolPricingOption {
  return {
    id: Math.random().toString(36).slice(2),
    tool_slug: "quillbot",
    label: null,
    amount: 200,
    unit: "month",
    currency: "₦",
    contact_admin: false,
    sort_order: 0,
    duration_days: 28,
    grace_days: 0,
    warning_days: 0,
    access_type: "shared",
    billing_period: "monthly",
    enabled: true,
    note: null,
    badge: null,
    paystack_plan_code: null,
    ...o,
  } as ToolPricingOption;
}

describe("base-pricing (public catalogue)", () => {
  it("shows both base prices when shared + private monthly exist", () => {
    const lines = baseMonthlyLines([
      opt({ amount: 200 }),
      opt({ amount: 600, access_type: "private" }),
      opt({ amount: 500, unit: "quarter", billing_period: "quarterly" }),
    ]);
    expect(lines.map((l) => l.text)).toEqual([
      "Shared access from ₦200/month",
      "Private access from ₦600/month",
    ]);
  });

  it("shows only shared when private pricing is empty", () => {
    const lines = baseMonthlyLines([opt({ amount: 200 })]);
    expect(lines).toHaveLength(1);
    expect(lines[0].access).toBe("shared");
  });

  it("hides private when admin disabled it", () => {
    const lines = baseMonthlyLines(
      [opt({ amount: 200 }), opt({ amount: 600, access_type: "private" })],
      { private_access_enabled: false },
    );
    expect(lines).toHaveLength(1);
  });

  it("hides private when access is not authorised", () => {
    const lines = baseMonthlyLines(
      [opt({ amount: 200 }), opt({ amount: 600, access_type: "private" })],
      { private_access_authorization: "pending" },
    );
    expect(lines.map((l) => l.access)).toEqual(["shared"]);
  });

  it("takes the lowest monthly price and ignores contact-admin / disabled rows", () => {
    const lines = baseMonthlyLines([
      opt({ amount: 400 }),
      opt({ amount: 250 }),
      opt({ amount: 100, enabled: false }),
      opt({ amount: null, contact_admin: true }),
    ]);
    expect(lines[0].amount).toBe(250);
  });
});
