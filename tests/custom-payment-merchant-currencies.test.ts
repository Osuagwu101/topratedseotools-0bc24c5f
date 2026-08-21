import { describe, expect, it } from "vitest";
import {
  FLUTTERWAVE_CURRENCY_PRIORITY,
  customPaymentCurrenciesForGateway,
  customPaymentGatewaySupportsCurrency,
  searchCustomPaymentCurrencies,
} from "../src/lib/custom-payment-currency";

describe("Custom Payment gateway currency policy", () => {
  it("limits Paystack Custom Payments to NGN", () => {
    expect(customPaymentCurrenciesForGateway("paystack").map((c) => c.code)).toEqual(["NGN"]);
    expect(customPaymentGatewaySupportsCurrency("paystack", "NGN")).toBe(true);
    expect(customPaymentGatewaySupportsCurrency("paystack", "USD")).toBe(false);
    expect(customPaymentGatewaySupportsCurrency("paystack", "GHS")).toBe(false);
    expect(customPaymentGatewaySupportsCurrency("paystack", "KES")).toBe(false);
  });

  it("places GHS, KES, ZAR and NGN first for Flutterwave", () => {
    const codes = customPaymentCurrenciesForGateway("flutterwave").map((c) => c.code);
    expect(codes.slice(0, 4)).toEqual([...FLUTTERWAVE_CURRENCY_PRIORITY]);
    expect(codes).toContain("USD");
    expect(codes).toContain("GBP");
    expect(codes).toContain("EUR");
    expect(codes).toContain("ZMW");
  });

  it("searches Flutterwave currencies by code or human name", () => {
    const options = customPaymentCurrenciesForGateway("flutterwave");
    expect(searchCustomPaymentCurrencies(options, "ghana").map((c) => c.code)).toEqual(["GHS"]);
    expect(searchCustomPaymentCurrencies(options, "kes").map((c) => c.code)).toEqual(["KES"]);
    expect(searchCustomPaymentCurrencies(options, "south african").map((c) => c.code)).toEqual(["ZAR"]);
  });

  it("rejects arbitrary ISO codes that are not in the Flutterwave collection list", () => {
    expect(customPaymentGatewaySupportsCurrency("flutterwave", "GHS")).toBe(true);
    expect(customPaymentGatewaySupportsCurrency("flutterwave", "JPY")).toBe(false);
    expect(customPaymentGatewaySupportsCurrency("flutterwave", "BAD")).toBe(false);
  });
});
