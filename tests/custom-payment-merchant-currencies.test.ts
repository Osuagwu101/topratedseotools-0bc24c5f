import { describe, expect, it } from "vitest";
import {
  merchantPaystackCurrencies,
  merchantSupportsPaystackCurrency,
} from "../src/lib/custom-payment-currency";

describe("Custom Payment merchant currency guard", () => {
  it("uses the provider's legacy single currency when supported_currencies is absent", () => {
    const config = { currency: "NGN", supports_recurring: true };
    expect(merchantPaystackCurrencies(config)).toEqual(["NGN"]);
    expect(merchantSupportsPaystackCurrency(config, "NGN")).toBe(true);
    expect(merchantSupportsPaystackCurrency(config, "GHS")).toBe(false);
  });

  it("prefers an explicit merchant supported_currencies list", () => {
    const config = { currency: "NGN", supported_currencies: ["ngn", "USD", "NGN"] };
    expect(merchantPaystackCurrencies(config)).toEqual(["NGN", "USD"]);
    expect(merchantSupportsPaystackCurrency(config, "usd")).toBe(true);
    expect(merchantSupportsPaystackCurrency(config, "GHS")).toBe(false);
  });

  it("does not invent a currency when provider config is missing or malformed", () => {
    expect(merchantPaystackCurrencies({})).toEqual([]);
    expect(merchantPaystackCurrencies({ supported_currencies: ["bad", null, "NGN"] })).toEqual(["NGN"]);
  });
});
