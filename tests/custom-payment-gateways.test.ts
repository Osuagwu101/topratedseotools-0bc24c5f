import { afterEach, describe, expect, it, vi } from "vitest";
import { paystackAdapter } from "../src/lib/gateways/paystack";
import { flutterwaveAdapter } from "../src/lib/gateways/flutterwave";
import { customPaymentMinorUnits } from "../src/lib/custom-payment-currency";

const originalFetch = globalThis.fetch;
const oldPaystack = process.env.PAYSTACK_SECRET_KEY;
const oldFlutterwave = process.env.FLUTTERWAVE_SECRET_KEY;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (oldPaystack == null) delete process.env.PAYSTACK_SECRET_KEY;
  else process.env.PAYSTACK_SECRET_KEY = oldPaystack;
  if (oldFlutterwave == null) delete process.env.FLUTTERWAVE_SECRET_KEY;
  else process.env.FLUTTERWAVE_SECRET_KEY = oldFlutterwave;
  vi.restoreAllMocks();
});

describe("Custom Payment gateway adapter contract", () => {
  it("initializes a Paystack USD checkout in minor units", async () => {
    process.env.PAYSTACK_SECRET_KEY = "sk_test_custom_payment_regression";
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      expect(body.currency).toBe("USD");
      expect(body.amount).toBe(12345);
      expect(body.reference).toBe("CP-PS-test");
      expect(body.metadata.kind).toBe("custom_payment");
      return new Response(
        JSON.stringify({
          status: true,
          message: "Authorization URL created",
          data: {
            authorization_url: "https://checkout.paystack.com/test",
            access_code: "abc",
            reference: "CP-PS-test",
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await paystackAdapter.initialize({
      reference: "CP-PS-test",
      amountMinor: customPaymentMinorUnits(123.45, "USD"),
      currency: "USD",
      email: "payer@example.com",
      callbackUrl: "https://topratedseotools.com/pay/test-token",
      metadata: { kind: "custom_payment" },
    });

    expect(result.authorization_url).toBe("https://checkout.paystack.com/test");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("initializes a Flutterwave GHS checkout in exact major units", async () => {
    process.env.FLUTTERWAVE_SECRET_KEY = "FLWSECK_TEST-custom-payment-regression";
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      expect(body.currency).toBe("GHS");
      expect(body.amount).toBe(123.45);
      expect(body.tx_ref).toBe("CP-FW-test");
      expect(body.payment_options).toContain("mobilemoneyghana");
      expect(body.meta.kind).toBe("custom_payment");
      return new Response(
        JSON.stringify({
          status: "success",
          message: "Hosted Link",
          data: { link: "https://checkout.flutterwave.com/test" },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await flutterwaveAdapter.initialize({
      reference: "CP-FW-test",
      amountMinor: customPaymentMinorUnits(123.45, "GHS"),
      currency: "GHS",
      email: "payer@example.com",
      customerName: "Test Payer",
      description: "Custom bill",
      callbackUrl: "https://topratedseotools.com/pay/test-token",
      metadata: { kind: "custom_payment" },
    });

    expect(result.authorization_url).toBe("https://checkout.flutterwave.com/test");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("normalizes Flutterwave verification back to the canonical amount boundary", async () => {
    process.env.FLUTTERWAVE_SECRET_KEY = "FLWSECK_TEST-custom-payment-regression";
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            status: "success",
            message: "Transaction fetched",
            data: {
              id: 42,
              tx_ref: "CP-FW-verify",
              status: "successful",
              amount: 75.25,
              currency: "ZAR",
              payment_type: "card",
              created_at: "2026-08-19T05:00:00.000Z",
              meta: { kind: "custom_payment", custom_payment_link_id: "link-1" },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    ) as typeof fetch;

    const tx = await flutterwaveAdapter.verify("CP-FW-verify");
    expect(tx.status).toBe("success");
    expect(tx.reference).toBe("CP-FW-verify");
    expect(tx.amount).toBe(7525);
    expect(tx.currency).toBe("ZAR");
    expect(tx.metadata?.custom_payment_link_id).toBe("link-1");
  });
});
