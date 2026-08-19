import { chromium } from "playwright";

const cases = [
  {
    name: "Paystack NGN",
    url: "https://topratedseotools.com/pay/336d87f7640fba1933939ee86d60f94c65f16da4170fe9e2",
    title: "E2E Audit — Paystack NGN",
    provider: "Paystack",
    currency: "NGN",
    expectedHosts: ["checkout.paystack.com", "paystack.com"],
  },
  {
    name: "Flutterwave GHS",
    url: "https://topratedseotools.com/pay/747d2fa9f5348d4ef6612d879e60de450df197980c21e08a",
    title: "E2E Audit — Flutterwave GHS",
    provider: "Flutterwave",
    currency: "GHS",
    expectedHosts: ["checkout.flutterwave.com", "flutterwave.com"],
  },
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const browser = await chromium.launch({ headless: true });
try {
  for (const testCase of cases) {
    const context = await browser.newContext();
    const page = await context.newPage();
    console.log(`\n=== ${testCase.name} ===`);
    const response = await page.goto(testCase.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    console.log(`payment page HTTP: ${response?.status() ?? "n/a"}`);
    await page.getByRole("heading", { name: testCase.title }).waitFor({ timeout: 30_000 });
    const before = await page.locator("body").innerText();
    assert(before.includes(`Custom Payment · ${testCase.provider}`), `${testCase.provider} label missing`);
    assert(before.includes(testCase.currency), `${testCase.currency} exact-currency label missing`);
    assert(before.includes(`Secure payment processed by ${testCase.provider}`), `${testCase.provider} secure-payment footer missing`);
    assert(!/NGN\s*(?:→|to)\s*GHS|GHS\s*estimate|estimated\s+GHS|currency\s+estimator/i.test(before), "Removed NGN→GHS estimator is still visible");

    await page.getByLabel("Name").fill("TopRated E2E Audit");
    await page.getByLabel("Email").fill("e2e-audit@example.com");

    const navigation = page.waitForURL((url) => {
      const host = url.hostname.toLowerCase();
      return testCase.expectedHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
    }, { timeout: 45_000 });
    await page.getByRole("button", { name: /^Pay / }).click();
    try {
      await navigation;
    } catch (error) {
      const body = await page.locator("body").innerText().catch(() => "");
      console.error(`current URL: ${page.url()}`);
      console.error(`page text: ${body.slice(0, 1800)}`);
      throw error;
    }

    const finalUrl = new URL(page.url());
    console.log(`handoff host: ${finalUrl.hostname}`);
    assert(testCase.expectedHosts.some((allowed) => finalUrl.hostname === allowed || finalUrl.hostname.endsWith(`.${allowed}`)), `Unexpected ${testCase.provider} handoff host: ${finalUrl.hostname}`);
    console.log(`${testCase.name}: PASS — rendered correctly and reached hosted checkout without completing payment.`);
    await context.close();
  }
} finally {
  await browser.close();
}
