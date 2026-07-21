/**
 * Tests: strict opt-in for marketing attribution. Nothing may be written to
 * browser storage (or reachable to server writes) before Marketing consent.
 * Run: bun tests/marketing-attribution-preconsent.test.ts
 */
// Minimal localStorage shim before importing modules.
class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
  key(i: number) { return Array.from(this.m.keys())[i] ?? null; }
  get length() { return this.m.size; }
}
const storage = new MemStorage();
(globalThis as unknown as { window: unknown }).window = {
  localStorage: storage,
  location: { href: "https://example.com/pricing?utm_source=meta&utm_campaign=launch&fbclid=abc" },
  dispatchEvent: () => true,
  addEventListener: () => {},
  removeEventListener: () => {},
};
(globalThis as unknown as { document: unknown }).document = { referrer: "https://facebook.com/" };
(globalThis as unknown as { localStorage: unknown }).localStorage = storage;

const attribution = await import("../src/lib/marketing/attribution");
const consent = await import("../src/lib/marketing/consent");

let passed = 0, failed = 0;
const failures: string[] = [];
function assert(cond: unknown, msg: string) {
  if (cond) passed++;
  else { failed++; failures.push(msg); console.error("  ✗", msg); }
}
async function test(name: string, fn: () => void | Promise<void>) {
  console.log("• " + name);
  const before = failed;
  storage.clear();
  try { await fn(); } catch (e) { failed++; failures.push(`${name}: ${e}`); }
  if (failed === before) console.log("  ✓ ok");
}

await test("no attribution or visitor_id written before consent", () => {
  attribution.captureAttributionFromUrl();
  assert(storage.getItem("mkt_attr") === null, "mkt_attr not written");
  assert(storage.getItem("mkt_vid") === null, "mkt_vid not created");
  const read = attribution.readAttribution();
  assert(read.first_touch === null && read.last_touch === null, "read returns empty");
  assert(attribution.peekVisitorId() === null, "peekVisitorId null");
});

await test("rejecting Marketing leaves attribution empty", () => {
  consent.writeConsent({ analytics: false, marketing: false });
  attribution.captureAttributionFromUrl();
  assert(storage.getItem("mkt_attr") === null, "no attribution written after reject");
});

await test("accepting Marketing begins capture from current URL", () => {
  consent.writeConsent({ analytics: false, marketing: true });
  attribution.captureAttributionFromUrl();
  const stored = attribution.readAttribution();
  assert(stored.first_touch?.utm_source === "meta", "first_touch captured");
  assert(stored.last_touch?.fbclid === "abc", "fbclid captured");
  assert(!!storage.getItem("mkt_vid"), "visitor_id created after consent");
  assert(!!storage.getItem("mkt_attr"), "mkt_attr persisted");
});

await test("withdrawing consent stops future updates and preserves prior", () => {
  consent.writeConsent({ analytics: false, marketing: true });
  attribution.captureAttributionFromUrl();
  const before = storage.getItem("mkt_attr");
  assert(!!before, "prior attribution exists");
  consent.writeConsent({ analytics: false, marketing: false });
  // Simulate a new URL with different campaign
  (globalThis as unknown as { window: { location: { href: string } } }).window.location.href =
    "https://example.com/tools?utm_source=google&utm_campaign=other";
  attribution.captureAttributionFromUrl();
  const after = storage.getItem("mkt_attr");
  assert(after === before, "attribution unchanged after withdrawal");
});

await test("readAttribution returns empty after withdrawal even if payload lingers", () => {
  consent.writeConsent({ analytics: false, marketing: true });
  attribution.captureAttributionFromUrl();
  consent.writeConsent({ analytics: false, marketing: false });
  const read = attribution.readAttribution();
  assert(read.first_touch === null && read.last_touch === null, "read gated by consent");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { for (const f of failures) console.log(" -", f); process.exit(1); }
