import { chromium } from "playwright";

const url = "https://topratedseotools.com/pay/336d87f7640fba1933939ee86d60f94c65f16da4170fe9e2";
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  const network = [];
  page.on("console", (m) => console.log(`browser console ${m.type()}: ${m.text()}`));
  page.on("pageerror", (e) => console.log(`browser pageerror: ${e.message}`));
  page.on("requestfailed", (req) => console.log(`request failed: ${req.method()} ${req.url()} :: ${req.failure()?.errorText}`));
  page.on("response", (resp) => {
    const req = resp.request();
    if (req.method() !== "GET" || resp.url().includes("_server") || resp.url().includes("server")) {
      network.push(`${req.method()} ${resp.status()} ${resp.url()}`);
    }
  });

  const response = await page.goto(url, { waitUntil: "networkidle", timeout: 45_000 });
  console.log(`initial HTTP: ${response?.status()}`);
  await page.getByRole("heading", { name: "E2E Audit — Paystack NGN" }).waitFor();
  await page.getByLabel("Name").fill("TopRated E2E Audit");
  await page.getByLabel("Email").fill("e2e-audit@example.com");
  const button = page.getByRole("button", { name: /^Pay /i });
  console.log(`button enabled: ${await button.isEnabled()}`);
  await button.click();
  await page.waitForTimeout(12_000);
  console.log(`final URL: ${page.url()}`);
  console.log(`network after click:\n${network.join("\n") || "(no non-GET/server responses captured)"}`);
  const status = await page.locator('[role="status"]').allTextContents().catch(() => []);
  console.log(`status text: ${JSON.stringify(status)}`);
  const body = await page.locator("body").innerText();
  console.log(`body excerpt: ${body.slice(0, 2200).replace(/\s+/g, " ")}`);

  const host = new URL(page.url()).hostname.toLowerCase();
  if (host === "checkout.paystack.com" || host.endsWith(".paystack.com")) {
    console.log("PASS: reached Paystack hosted checkout.");
    process.exit(0);
  }
  throw new Error("Paystack initialization did not reach the hosted checkout; trace emitted above.");
} finally {
  await browser.close();
}
