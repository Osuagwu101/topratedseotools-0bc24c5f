import { describe, expect, it } from "vitest";
import {
  gatewayForCurrency,
  gatewayNameForCurrency,
  supportsRecurringForCurrency,
} from "../src/lib/gateway-routing";
import {
  CURRENCY_UNAVAILABLE_MESSAGE,
  DEFAULT_GATEWAY,
  GATEWAY_METADATA,
  gatewaySupportsCurrency,
} from "../src/lib/gateways/metadata";
import { isCurrencyRoutable, GATEWAY_DISPLAY } from "../src/lib/gateway-routing";
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

describe("gateway metadata single source of truth", () => {
  it("derives client-safe display data from the shared metadata", () => {
    expect(GATEWAY_DISPLAY.paystack.name).toBe(GATEWAY_METADATA.paystack.displayName);
    expect(GATEWAY_DISPLAY.flutterwave.supportsRecurring).toBe(
      GATEWAY_METADATA.flutterwave.supportsRecurring,
    );
    expect(DEFAULT_GATEWAY).toBe("paystack");
  });

  it("declares supported currencies per gateway", () => {
    expect(GATEWAY_METADATA.paystack.chargeCurrencies).toEqual(["NGN"]);
    expect(GATEWAY_METADATA.monnify.chargeCurrencies).toEqual(["NGN"]);
    expect(GATEWAY_METADATA.monnify.routable).toBe(false);
    for (const c of ["GHS", "KES", "USD", "ZAR"]) {
      expect(gatewaySupportsCurrency("flutterwave", c)).toBe(true);
      expect(gatewaySupportsCurrency("paystack", c)).toBe(false);
    }
  });

  it("flags unsupported currencies as non-routable with a customer-safe message", () => {
    expect(isCurrencyRoutable("NGN")).toBe(true);
    expect(isCurrencyRoutable("GHS")).toBe(true);
    expect(isCurrencyRoutable("EUR")).toBe(false);
    expect(CURRENCY_UNAVAILABLE_MESSAGE).toMatch(/temporarily unavailable for this currency/i);
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
