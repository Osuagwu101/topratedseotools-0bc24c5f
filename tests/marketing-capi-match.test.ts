/**
 * Meta CAPI match data + Google Ads validators.
 * Run: bun tests/marketing-capi-match.test.ts
 */
process.env.META_CAPI_ACCESS_TOKEN = process.env.META_CAPI_ACCESS_TOKEN ?? "test-token";
const { trackServerConversion } = await import("../src/lib/marketing/server-events");
const { hashValue, hashEmail } = await import("../src/lib/marketing/meta-capi");
const { isValidGoogleAdsId, isValidGoogleAdsLabel } = await import("../src/lib/marketing/config");
import { MockDb } from "./mock-db";

let passed = 0;
let failed = 0;
function assert(cond: unknown, msg: string) {
  if (cond) passed++;
  else {
    failed++;
    console.error("  ✗", msg);
  }
}

let capiBodies: Array<{ url: string; body: any }> = [];
const origFetch = globalThis.fetch;
globalThis.fetch = async (input: unknown, init?: RequestInit): Promise<Response> => {
  const url = typeof input === "string" ? input : (input as Request).url ?? "";
  if (url.includes("graph.facebook.com")) {
    capiBodies.push({ url, body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({ events_received: 1 }), { status: 200 });
  }
  return origFetch(input as RequestInfo, init);
};

function seed(db: MockDb) {
  db.seed("site_settings", [{ id: true, marketing_pause: false }]);
  db.seed("marketing_integrations", [
    { provider: "meta_pixel", enabled: true, connected: true, public_id: "123", test_event_code: null },
    { provider: "meta_capi", enabled: true, connected: true, public_id: "123", test_event_code: null },
  ]);
  db.seed("consent_choices", [{ user_id: "user-1", marketing: true }]);
  db.seed("tool_orders", [
    {
      id: "order-1",
      attribution: {
        visitor_id: "vid-1",
        fbp: "fb.1.1700000000000.1234567890",
        fbc: "fb.1.1700000000000.AbCdEf",
        client_ip_address: "102.89.1.2",
        client_user_agent: "Mozilla/5.0 test",
      },
    },
  ]);
}

const base = {
  event_id: "evt",
  order_id: "order-1",
  user_id: "user-1",
  tool_slug: "quillbot",
  amount: 200,
  currency: "NGN",
  email: "Buyer@Example.com",
};

console.log("• purchase carries email, external_id, IP, UA, fbp, fbc");
{
  capiBodies = [];
  const db = new MockDb();
  seed(db);
  const res = await trackServerConversion(db, { ...base, kind: "purchase" });
  const ud = capiBodies[0]?.body.data[0].user_data;
  assert(res.status === "sent", `sent (got ${res.status} ${res.error ?? ""})`);
  assert(ud?.em?.[0] === hashEmail("buyer@example.com"), "email hashed lower-case");
  assert(ud?.external_id?.[0] === hashValue("user-1"), "external_id is hashed user id");
  assert(ud?.client_ip_address === "102.89.1.2", "IP sent");
  assert(ud?.client_user_agent === "Mozilla/5.0 test", "UA sent");
  assert(ud?.fbp === "fb.1.1700000000000.1234567890", "fbp sent");
  assert(ud?.fbc === "fb.1.1700000000000.AbCdEf", "fbc sent");
  assert(!capiBodies[0].url.includes("/v19.0/"), "no longer pinned to v19.0");
  assert(!JSON.stringify(capiBodies[0].body).includes("Buyer@Example.com"), "raw email never sent");
}

console.log("• renewal does not reuse stale browser identifiers");
{
  capiBodies = [];
  const db = new MockDb();
  seed(db);
  const res = await trackServerConversion(db, { ...base, kind: "renewal_success", event_id: "evt-r" });
  const ud = capiBodies[0]?.body.data[0].user_data;
  assert(res.status === "sent", "renewal sent");
  assert(ud?.client_ip_address === undefined && ud?.fbp === undefined && ud?.fbc === undefined, "no IP/fbp/fbc on renewal");
  assert(!!ud?.em && !!ud?.external_id, "email + external_id still sent");
}

console.log("• order without attribution still sends (consent via user id)");
{
  capiBodies = [];
  const db = new MockDb();
  seed(db);
  db.all("tool_orders")[0].attribution = null;
  const res = await trackServerConversion(db, { ...base, kind: "purchase", event_id: "evt-n" });
  const ud = capiBodies[0]?.body.data[0].user_data;
  assert(res.status === "sent", "sent");
  assert(ud?.client_ip_address === undefined, "no IP when none captured");
}

console.log("• Google Ads validators");
assert(isValidGoogleAdsId("AW-123456789"), "valid AW id");
assert(!isValidGoogleAdsId("G-ABC123"), "GA id rejected");
assert(!isValidGoogleAdsId("AW-12"), "short id rejected");
assert(isValidGoogleAdsLabel("AbC-D_efG-h12345"), "valid label");
assert(!isValidGoogleAdsLabel("AW-123456789/AbC"), "full send_to rejected");
assert(!isValidGoogleAdsLabel("ab"), "short label rejected");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
