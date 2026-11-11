/** Run: npx tsx tests/email-formatting.test.ts */
import { extractPreheader, formatAmountDisplay, renderTemplate } from "../src/lib/email/templates";

let failures = 0;
function eq(name: string, got: unknown, expected: unknown) {
  const ok = got === expected;
  if (!ok) failures++;
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${ok ? "" : ` — got ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`}`);
}

eq("NGN number", formatAmountDisplay("NGN", 17000), "₦17,000");
eq("NGN string with commas", formatAmountDisplay("NGN", "17,000"), "₦17,000");
eq("missing currency defaults to naira", formatAmountDisplay(undefined, "2300"), "₦2,300");
eq("decimals kept", formatAmountDisplay("USD", "25.5"), "USD 25.50");
eq("empty amount", formatAmountDisplay("NGN", ""), "");
eq("non-numeric passthrough", formatAmountDisplay("NGN", "free"), "₦free");

eq("preheader filled", extractPreheader("<!--preheader: Your {{tool}} access is active -->\n<h1>x</h1>", { tool: "StealthWriter" }),
  "Your StealthWriter access is active");
eq("no preheader", extractPreheader("<h1>x</h1>", {}), undefined);
eq("preheader comment invisible in body", renderTemplate("<!--preheader: hi-->", {}).startsWith("<!--"), true);

if (failures) { console.error(`\n${failures} failure(s)`); process.exit(1); }
console.log("\nall email formatting tests passed");
