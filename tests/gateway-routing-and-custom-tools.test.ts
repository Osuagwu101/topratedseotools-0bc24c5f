import { describe, expect, it } from "vitest";
import {
  GATEWAY_DISPLAY,
  gatewayCanCharge,
  gatewayName,
  gatewaySupportsRecurring,
} from "../src/lib/gateway-routing";
import {
  CURRENCY_UNAVAILABLE_MESSAGE,
  DEFAULT_GATEWAY,
  GATEWAY_METADATA,
  gatewaySupportsCurrency,
} from "../src/lib/gateways/metadata";
import { mergeToolCatalog, slugTaken, toolFromOverride } from "../src/lib/tool-catalog";
import type { ToolOverride } from "../src/lib/tool-overrides.functions";

describe("explicit single active gateway", () => {
  it("defaults to Paystack, which supports recurring and every checkout currency", () => {
    expect(DEFAULT_GATEWAY).toBe("paystack");
    expect(gatewayName("paystack")).toBe("Paystack");
    expect(gatewayName(null)).toBe("Paystack");
    expect(gatewaySupportsRecurring("paystack")).toBe(true);
    for (const c of ["NGN", "GHS", "KES", "ZAR", "USD", "ngn"]) {
      expect(gatewayCanCharge("paystack", c)).toBe(true);
    }
  });

  it("treats Flutterwave as a one-time alternative, never chosen by currency", () => {
    expect(gatewayName("flutterwave")).toBe("Flutterwave");
    expect(gatewaySupportsRecurring("flutterwave")).toBe(false);
    expect(gatewayCanCharge("flutterwave", "GHS")).toBe(true);
    expect(GATEWAY_METADATA.flutterwave.selectable).toBe(true);
  });

  it("rejects currencies the chosen gateway cannot settle, with a safe message", () => {
    expect(gatewayCanCharge("monnify", "NGN")).toBe(true);
    expect(gatewayCanCharge("monnify", "GHS")).toBe(false);
    expect(gatewaySupportsCurrency("paystack", "EUR")).toBe(false);
    expect(CURRENCY_UNAVAILABLE_MESSAGE).toMatch(/temporarily unavailable for this currency/i);
  });

  it("derives client-safe display data from the shared metadata", () => {
    expect(GATEWAY_DISPLAY.paystack.name).toBe(GATEWAY_METADATA.paystack.displayName);
    expect(GATEWAY_DISPLAY.flutterwave.supportsRecurring).toBe(
      GATEWAY_METADATA.flutterwave.supportsRecurring,
    );
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
