/**
 * Executable tests for the marketing-consent gate on server-side conversions.
 * Run: bun tests/marketing-consent.test.ts
 */
process.env.META_CAPI_ACCESS_TOKEN = process.env.META_CAPI_ACCESS_TOKEN ?? "test-token";
const { trackServerConversion } = await import("../src/lib/marketing/server-events");
const { MockDb } = await import("./mock-db");
import { MockDb } from "./mock-db";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(cond: unknown, msg: string) {
  if (cond) passed++;
  else {
    failed++;
    failures.push(msg);
    console.error("  ✗", msg);
  }
}

async function test(name: string, fn: () => Promise<void>) {
  console.log("• " + name);
  const before = failed;
  try {
    await fn();
  } catch (err) {
    failed++;
    failures.push(`${name}: threw ${err}`);
    console.error("  ✗ threw:", err);
  }
  if (failed === before) console.log("  ✓ ok");
}

function seedProviders(db: MockDb, { pixel = true, capi = true, paused = false } = {}) {
  db.seed("site_settings", [{ id: true, marketing_pause: paused }]);
  db.seed("marketing_integrations", [
    { provider: "meta_pixel", enabled: pixel, connected: pixel, public_id: pixel ? "123" : null, test_event_code: null },
    { provider: "meta_capi", enabled: capi, connected: capi, public_id: capi ? "123" : null, test_event_code: null },
  ]);
}

// Stub Meta CAPI network so we can assert dispatch decisions locally.
let capiCalls: unknown[] = [];
const origFetch = globalThis.fetch;
globalThis.fetch = async (input: unknown, init?: RequestInit): Promise<Response> => {
  const url = typeof input === "string" ? input : (input as Request).url ?? "";
  if (url.includes("graph.facebook.com")) {
    capiCalls.push({ url, body: init?.body });
    return new Response(JSON.stringify({ events_received: 1 }), { status: 200 });
  }
  return origFetch(input as RequestInfo, init);
};

const baseInput = {
  kind: "purchase" as const,
  event_id: "evt-1",
  order_id: "order-1",
  user_id: "user-1",
  tool_slug: "quillbot",
  amount: 200,
  currency: "NGN",
  email: "buyer@example.com",
};

async function main() {
  await test("no consent record → skipped, no CAPI call", async () => {
    capiCalls = [];
    const db = new MockDb();
    seedProviders(db);
    const res = await trackServerConversion(db, baseInput);
    assert(res.status === "skipped", `status skipped (got ${res.status})`);
    assert(res.error === "consent", `error=consent (got ${res.error})`);
    assert(capiCalls.length === 0, "no CAPI HTTP call fired");
    const ev = db.all("marketing_events")[0];
    assert(ev?.status === "skipped", "event logged as skipped");
    assert(ev?.error_message === "consent not granted", "reason recorded");
  });

  await test("consent marketing=false → skipped", async () => {
    capiCalls = [];
    const db = new MockDb();
    seedProviders(db);
    db.seed("consent_choices", [{ user_id: "user-1", marketing: false }]);
    const res = await trackServerConversion(db, baseInput);
    assert(res.status === "skipped" && res.error === "consent", "explicit false blocks");
    assert(capiCalls.length === 0, "no CAPI HTTP call fired");
  });

  await test("consent marketing=true by user_id → sent", async () => {
    capiCalls = [];
    const db = new MockDb();
    seedProviders(db);
    db.seed("consent_choices", [{ user_id: "user-1", marketing: true }]);
    const res = await trackServerConversion(db, baseInput);
    assert(res.status === "sent", `status sent (got ${res.status} ${res.error ?? ""})`);
    assert(capiCalls.length === 1, "CAPI HTTP call fired once");
  });

  await test("consent by visitor_id from order.attribution → sent", async () => {
    capiCalls = [];
    const db = new MockDb();
    seedProviders(db);
    db.seed("tool_orders", [{ id: "order-1", attribution: { visitor_id: "vid-9" } }]);
    db.seed("consent_choices", [{ visitor_id: "vid-9", marketing: true }]);
    const res = await trackServerConversion(db, baseInput);
    assert(res.status === "sent", `status sent (got ${res.status})`);
  });

  await test("consent withdrawn (flip to false) → subsequent events skipped", async () => {
    capiCalls = [];
    const db = new MockDb();
    seedProviders(db);
    db.seed("consent_choices", [{ user_id: "user-1", marketing: true }]);
    const first = await trackServerConversion(db, { ...baseInput, event_id: "evt-a" });
    assert(first.status === "sent", "first event sent");
    // Simulate withdrawal
    (db.all("consent_choices")[0] as { marketing: boolean }).marketing = false;
    const second = await trackServerConversion(db, { ...baseInput, event_id: "evt-b" });
    assert(second.status === "skipped" && second.error === "consent", "withdrawn event skipped");
  });

  await test("duplicate event_id → deduplicated, not sent again", async () => {
    capiCalls = [];
    const db = new MockDb();
    seedProviders(db);
    db.seed("consent_choices", [{ user_id: "user-1", marketing: true }]);
    const a = await trackServerConversion(db, { ...baseInput, event_id: "evt-dup" });
    assert(a.status === "sent", "first sent");
    const b = await trackServerConversion(db, { ...baseInput, event_id: "evt-dup" });
    assert(b.status === "deduplicated", `second deduplicated (got ${b.status})`);
    assert(capiCalls.length === 1, "only one CAPI HTTP call fired for duplicate");
  });

  await test("marketing paused → skipped even with consent", async () => {
    capiCalls = [];
    const db = new MockDb();
    seedProviders(db, { paused: true });
    db.seed("consent_choices", [{ user_id: "user-1", marketing: true }]);
    const res = await trackServerConversion(db, baseInput);
    assert(res.status === "skipped" && res.error === "paused", "paused blocks");
  });

  await test("providers disabled → skipped with disabled reason", async () => {
    capiCalls = [];
    const db = new MockDb();
    seedProviders(db, { pixel: false, capi: false });
    db.seed("consent_choices", [{ user_id: "user-1", marketing: true }]);
    const res = await trackServerConversion(db, baseInput);
    assert(res.status === "skipped" && res.error === "disabled", "disabled");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) {
    for (const f of failures) console.log(" -", f);
    process.exit(1);
  }
}

main();
