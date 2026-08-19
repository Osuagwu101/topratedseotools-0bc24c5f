import { chromium } from "playwright";

const cases = [
  {
    name: "Paystack NGN",
    url: "https://topratedseotools.com/pay/336d87f7640fba1933939ee86d60f94c65f16da4170fe9e2",
    title: "E2E Audit — Paystack NGN",
    provider: "Paystack",
    currency: "NGN",
    allowedHosts: ["checkout.paystack.com", "paystack.com"],
  },
  {
    name: "Flutterwave GHS",
    url: "https://topratedseotools.com/pay/747d2fa9f5348d4ef6612d879e60de450df197980c21e08a",
    title: "E2E Audit — Flutterwave GHS",
    provider: "Flutterwave",
    currency: "GHS",
    allowedHosts: ["checkout.flutterwave.com", "flutterwave.com"],
  },
];

function allowedHost(host, allowed) {
  const normalized = host.toLowerCase();
  return allowed.some((candidate) => normalized === candidate || normalized.endsWith(`.${candidate}`));
}

async function waitForExternalHandoff(page, allowed, timeoutMs = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const host = new URL(page.url()).hostname;
    if (allowedHost(host, allowed)) return host;
    await page.waitForTimeout(500);
  }
  return null;
}

const browser = await chromium.launch({ headless: true });
try {
  for (const testCase of cases) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const network = [];
    page.on("response", (resp) => {
      const req = resp.request();
      if (req.method() !== "GET" || resp.url().includes("_serverFn")) {
        network.push(`${req.method()} ${resp.status()} ${resp.url()}`);
      }
    });
    page.on("requestfailed", (req) => {
      const host = new URL(req.url()).hostname;
      if (!host.includes("challenges.cloudflare.com")) network.push(`FAILED ${req.method()} ${req.url()} :: ${req.failure()?.errorText}`);
    });

    console.log(`\n=== ${testCase.name} ===`);
    const response = await page.goto(testCase.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    console.log(`payment page HTTP: ${response?.status() ?? "n/a"}`);
    await page.getByRole("heading", { name: testCase.title }).waitFor({ timeout: 30_000 });
    const bodyBefore = await page.locator("body").innerText();
    if (!bodyBefore.toLowerCase().includes(`custom payment · ${testCase.provider}`.toLowerCase())) throw new Error(`${testCase.provider} label missing`);
    if (!bodyBefore.includes(testCase.currency)) throw new Error(`${testCase.currency} label missing`);
    if (/NGN\s*(?:→|to)\s*GHS|GHS\s*estimate|estimated\s+GHS|currency\s+estimator/i.test(bodyBefore)) throw new Error("Removed NGN→GHS estimator is still visible");

    await page.getByLabel("Name").fill("TopRated E2E Audit");
    await page.getByLabel("Email").fill("e2e-audit@example.com");
    const button = page.getByRole("button", { name: /^Pay /i });
    if (!(await button.isEnabled())) throw new Error(`${testCase.provider} payment button is disabled`);
    await button.click();

    const handoffHost = await waitForExternalHandoff(page, testCase.allowedHosts);
    if (!handoffHost) {
      const status = await page.locator('[role="status"]').allTextContents().catch(() => []);
      console.error(`current URL: ${page.url()}`);
      console.error(`status: ${JSON.stringify(status)}`);
      console.error(`network:\n${network.join("\n")}`);
      throw new Error(`${testCase.provider} did not reach its hosted checkout`);
    }

    console.log(`handoff host: ${handoffHost}`);
    console.log(`server/provider network:\n${network.filter((line) => /_serverFn|paystack|flutterwave/i.test(line)).join("\n")}`);
    console.log(`${testCase.name}: PASS — live custom-domain payment initialized and reached ${testCase.provider} hosted checkout without submitting payment.`);
    await context.close();
  }
} finally {
  await browser.close();
}
