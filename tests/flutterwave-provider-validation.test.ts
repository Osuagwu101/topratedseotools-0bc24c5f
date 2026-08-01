import { afterEach, describe, expect, it, vi } from "vitest";
import { runProviderConnectionTest } from "../src/lib/gateways/provider-validation.server";

describe("Flutterwave provider validation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("validates merchant access through transactions and never requests subaccounts", async () => {
    process.env.FLUTTERWAVE_SECRET_KEY = "FLWSECK_TEST-valid-X";
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(String(url));
      return new Response(JSON.stringify({ status: "success", message: "Transactions fetched", data: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const result = await runProviderConnectionTest({ slug: "flutterwave" });

    expect(result).toEqual({
      ok: true,
      message: "Connection successful — merchant account reachable",
    });
    expect(urls).toEqual(["https://api.flutterwave.com/v3/transactions?page=1"]);
    expect(urls.some((url) => url.includes("subaccounts"))).toBe(false);
  });

  it("rejects an authentication failure", async () => {
    process.env.FLUTTERWAVE_SECRET_KEY = "invalid";
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify({ status: "error", message: "Invalid secret key" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    );

    const result = await runProviderConnectionTest({ slug: "flutterwave" });
    expect(result).toEqual({ ok: false, message: "Invalid secret key" });
  });
});