/**
 * Custom Payments — end-to-end policy verification.
 *
 * Covers gateway selection rules, currency selectors, exact amount storage,
 * gateway initiation payloads, customer display strings, validation errors,
 * and the complete removal of the old NGN→FX estimator.
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FLUTTERWAVE_CURRENCY_PRIORITY,
  PAYSTACK_CUSTOM_PAYMENT_CURRENCIES,
  customPaymentCurrenciesForGateway,
  customPaymentGatewaySupportsCurrency,
  customPaymentMinorUnits,
  customPaymentRequiresWholeAmount,
  formatCustomPaymentMoney,
  normalizeCustomPaymentCurrency,
  roundCustomPaymentAmount,
  searchCustomPaymentCurrencies,
} from "../src/lib/custom-payment-currency";
import { paystackAdapter } from "../src/lib/gateways/paystack";
import { flutterwaveAdapter } from "../src/lib/gateways/flutterwave";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("gateway selection + currency policy", () => {
  it("locks Paystack Custom Payments to NGN only", () => {
    expect([...PAYSTACK_CUSTOM_PAYMENT_CURRENCIES]).toEqual(["NGN"]);
    expect(customPaymentCurrenciesForGateway("paystack")).toEqual([
      { code: "NGN", name: "Nigerian Naira" },
    ]);
    for (const bad of ["USD", "GHS", "KES", "ZAR", "EUR", "ngn ", "N/A", ""]) {
      if (bad.trim().toUpperCase() === "NGN") continue;
      expect(customPaymentGatewaySupportsCurrency("paystack", bad)).toBe(false);
    }
    expect(customPaymentGatewaySupportsCurrency("paystack", "ngn")).toBe(true);
  });

  it("offers the full supported Flutterwave currency list, business priority first", () => {
    const codes = customPaymentCurrenciesForGateway("flutterwave").map((c) => c.code);
    expect(codes.slice(0, 4)).toEqual([...FLUTTERWAVE_CURRENCY_PRIORITY]);
    for (const c of ["NGN", "GHS", "KES", "ZAR", "USD", "EUR", "GBP", "UGX", "XOF"]) {
      expect(codes).toContain(c);
      expect(customPaymentGatewaySupportsCurrency("flutterwave", c)).toBe(true);
    }
    expect(customPaymentGatewaySupportsCurrency("flutterwave", "JPY")).toBe(false);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("searches the currency selector by code and name", () => {
    const opts = customPaymentCurrenciesForGateway("flutterwave");
    expect(searchCustomPaymentCurrencies(opts, "ghs").map((o) => o.code)).toEqual(["GHS"]);
    expect(searchCustomPaymentCurrencies(opts, "kenyan").map((o) => o.code)).toEqual(["KES"]);
    expect(searchCustomPaymentCurrencies(opts, "").length).toBe(opts.length);
  });
});

describe("exact amount storage (no conversion)", () => {
  it("stores the admin-entered amount verbatim", () => {
    expect(roundCustomPaymentAmount(2000, "NGN")).toBe(2000);
    expect(roundCustomPaymentAmount(120.5, "GHS")).toBe(120.5);
    expect(roundCustomPaymentAmount(19.99, "USD")).toBe(19.99);
    expect(roundCustomPaymentAmount(123.456, "USD")).toBe(123.46);
    expect(roundCustomPaymentAmount(5000, "UGX")).toBe(5000);
  });

  it("flags whole-number currencies and rejects invalid amounts", () => {
    expect(customPaymentRequiresWholeAmount("UGX")).toBe(true);
    expect(customPaymentRequiresWholeAmount("NGN")).toBe(false);
    expect(roundCustomPaymentAmount(5000.4, "UGX")).toBe(5000);
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => roundCustomPaymentAmount(bad, "NGN")).toThrow();
    }
    for (const bad of ["NG", "NGNN", "12X", ""]) {
      expect(() => normalizeCustomPaymentCurrency(bad)).toThrow();
    }
  });

  it("maps amounts to the canonical minor-unit boundary", () => {
    expect(customPaymentMinorUnits(2000, "NGN")).toBe(200000);
    expect(customPaymentMinorUnits(120.5, "GHS")).toBe(12050);
    expect(customPaymentMinorUnits(19.99, "USD")).toBe(1999);
    expect(customPaymentMinorUnits(5000, "UGX")).toBe(500000);
  });
});

describe("payment initiation payloads", () => {
  it("sends the exact NGN amount to Paystack", async () => {
    process.env.PAYSTACK_SECRET_KEY = "sk_test_custom_payment_e2e";
    let body: any;
    globalThis.fetch = vi.fn(async (_u: any, init?: RequestInit) => {
      body = JSON.parse(String(init?.body ?? "{}"));
      return new Response(
        JSON.stringify({
          status: true,
          data: {
            authorization_url: "https://checkout.paystack.com/ngn",
            access_code: "x",
            reference: "CP-PS-1",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const res = await paystackAdapter.initialize({
      reference: "CP-PS-1",
      amountMinor: customPaymentMinorUnits(2000, "NGN"),
      currency: "NGN",
      email: "payer@example.com",
      callbackUrl: "https://topratedseotools.com/pay/tok",
      metadata: {
        kind: "custom_payment",
        amount_major: 2000,
        currency: "NGN",
        payment_gateway: "paystack",
      },
    });
    expect(res.authorization_url).toContain("checkout.paystack.com");
    expect(body.currency).toBe("NGN");
    expect(body.amount).toBe(200000);
    expect(body.metadata.kind).toBe("custom_payment");
    expect(body.metadata.payment_gateway).toBe("paystack");
  });

  it("sends the exact selected currency + major amount to Flutterwave", async () => {
    process.env.FLUTTERWAVE_SECRET_KEY = "FLWSECK_TEST-custom-payment-e2e";
    const seen: any[] = [];
    globalThis.fetch = vi.fn(async (_u: any, init?: RequestInit) => {
      seen.push(JSON.parse(String(init?.body ?? "{}")));
      return new Response(
        JSON.stringify({ status: "success", data: { link: "https://checkout.flutterwave.com/x" } }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    }) as typeof fetch;

    for (const [currency, amount] of [
      ["KES", 1500],
      ["USD", 19.99],
      ["NGN", 2500],
    ] as const) {
      await flutterwaveAdapter.initialize({
        reference: `CP-FW-${currency}`,
        amountMinor: customPaymentMinorUnits(amount, currency),
        currency,
        email: "payer@example.com",
        customerName: "Test Payer",
        description: "Custom bill",
        callbackUrl: "https://topratedseotools.com/pay/tok",
        metadata: { kind: "custom_payment", currency, payment_gateway: "flutterwave" },
      });
    }
    expect(seen.map((b) => [b.currency, b.amount])).toEqual([
      ["KES", 1500],
      ["USD", 19.99],
      ["NGN", 2500],
    ]);
    expect(seen.every((b) => b.meta.kind === "custom_payment")).toBe(true);
  });
});

describe("customer-facing display", () => {
  it("formats the stored amount in the stored currency", () => {
    expect(formatCustomPaymentMoney(2000, "NGN").replace(/\u00a0/g, " ")).toMatch(/2,000\.00/);
    expect(formatCustomPaymentMoney(120.5, "GHS").replace(/\u00a0/g, " ")).toMatch(/120\.50/);
    expect(formatCustomPaymentMoney(19.99, "USD")).toBe("$19.99");
    expect(formatCustomPaymentMoney(5000, "UGX").replace(/\u00a0/g, " ")).toMatch(/5,000$/);
  });
});

describe("legacy estimator removal", () => {
  const files = [
    "src/lib/custom-payment-currency.ts",
    "src/lib/custom-payments.functions.ts",
    "src/lib/custom-payments.webhook.ts",
    "src/routes/admin.settings.custom-payments.tsx",
    "src/routes/pay.$token.tsx",
  ];

  it("has no FX/estimator/conversion code left in the custom payment module", () => {
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      for (const banned of [
        "currency-convert",
        "buildPricingBreakdown",
        "resolveChargePlan",
        "exchange_rate",
        "exchangeRate",
        "convertFromNgn",
        "estimated",
      ]) {
        expect(src, `${file} should not reference ${banned}`).not.toContain(banned);
      }
    }
  });
});
