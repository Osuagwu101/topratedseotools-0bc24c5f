import { describe, expect, it } from "vitest";
import {
  gatewayForCurrency,
  gatewayNameForCurrency,
  supportsRecurringForCurrency,
} from "../src/lib/gateway-routing";
import { mergeToolCatalog, slugTaken, toolFromOverride } from "../src/lib/tool-catalog";
import type { ToolOverride } from "../src/lib/tool-overrides.functions";

describe("automatic gateway routing", () => {
  it("routes NGN to Paystack with recurring support", () => {
    expect(gatewayForCurrency("NGN")).toBe("paystack");
    expect(gatewayForCurrency("ngn")).toBe("paystack");
    expect(gatewayForCurrency(null)).toBe("paystack");
    expect(supportsRecurringForCurrency("NGN")).toBe(true);
    expect(gatewayNameForCurrency("NGN")).toBe("Paystack");
  });

  it("routes every non-NGN currency to Flutterwave, one-time only", () => {
    for (const c of ["GHS", "KES", "USD", "ZAR", "ghs"]) {
      expect(gatewayForCurrency(c)).toBe("flutterwave");
      expect(supportsRecurringForCurrency(c)).toBe(false);
      expect(gatewayNameForCurrency(c)).toBe("Flutterwave");
    }
  });
});

const custom: ToolOverride = {
  tool_slug: "qa-temp-tool",
  name: "QA Temp Tool",
  tagline: "Temporary",
  description: "Created by QA",
  category: "Productivity",
  domain: "qa.example.com",
  image_url: "https://example.com/icon.webp",
  is_visible: true,
  updated_at: new Date().toISOString(),
  is_custom: true,
  access: "pro",
  features: ["one", "two"],
  featured: false,
};

describe("admin-created tools in the catalogue", () => {
  it("materialises a custom override into a full catalogue tool", () => {
    const t = toolFromOverride(custom);
    expect(t.slug).toBe("qa-temp-tool");
    expect(t.name).toBe("QA Temp Tool");
    expect(t.access).toBe("pro");
    expect(t.pricingModel).toBe("subscription");
    expect(t.is_visible).toBe(true);
    expect(t.image_url).toBe("https://example.com/icon.webp");
  });

  it("merges custom tools alongside built-ins without dropping any", () => {
    const base = mergeToolCatalog([]);
    const merged = mergeToolCatalog([custom]);
    expect(merged.length).toBe(base.length + 1);
    expect(merged.some((t) => t.slug === "qa-temp-tool")).toBe(true);
    expect(slugTaken(merged as unknown as ToolOverride[] extends never ? never : never[], "x")).toBe(false);
    expect(slugTaken([custom], "qa-temp-tool")).toBe(true);
  });

  it("hides a custom tool from public listings when visibility is off", () => {
    const merged = mergeToolCatalog([{ ...custom, is_visible: false }]);
    const publicTools = merged.filter((t) => t.is_visible);
    expect(publicTools.some((t) => t.slug === "qa-temp-tool")).toBe(false);
  });
});
