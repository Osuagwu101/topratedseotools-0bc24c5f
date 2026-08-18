import { describe, expect, it } from "vitest";
import { estimateGhsFromNgn, parseBankOfGhanaGhsNgn } from "../src/lib/custom-payment-ghs-estimate.functions";

describe("custom payment NGN → GHS estimate", () => {
  it("parses the direct Bank of Ghana GHSNGN row and uses the mid rate", () => {
    const html = `
      <table>
        <tr><td>18 Aug 2026</td><td>Naira</td><td>GHSNGN</td><td>116.1000</td><td>116.5000</td><td>116.3000</td></tr>
      </table>
    `;
    expect(parseBankOfGhanaGhsNgn(html)).toEqual({ ngn_per_ghs: 116.3, as_of: "18 Aug 2026" });
  });

  it("converts an NGN charge into a display-only GHS estimate", () => {
    const ngnPerGhs = 116.3065;
    const ghs = estimateGhsFromNgn(116306.5, { ngn_to_ghs: 1 / ngnPerGhs });
    expect(ghs).toBe(1000);
  });

  it("does not create a fake estimate from invalid rates", () => {
    expect(estimateGhsFromNgn(100000, { ngn_to_ghs: 0 })).toBe(0);
  });
});
