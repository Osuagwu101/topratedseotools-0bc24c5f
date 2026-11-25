/**
 * Every paid sale reaches Meta as Purchase from the server, so Sales
 * campaigns see buyers who reject cookies too.
 * Run: bun tests/meta-purchase-events.test.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mapEventName } from "../src/lib/marketing/server-events";

assert.equal(mapEventName("purchase"), "Purchase");
assert.equal(mapEventName("subscription_start"), "Purchase", "first subscription payment is a Purchase");
assert.equal(mapEventName("renewal_success"), "Purchase");
assert.equal(mapEventName("refund"), "Refund");
assert.equal(mapEventName("renewal_failed"), "SubscriptionRenewalFailed");

// Browser and server use the same event_id for a subscription payment, so Meta deduplicates them.
const verify = readFileSync("src/lib/paystack.functions.ts", "utf8");
assert.ok(verify.includes("event_id: `subscription_start:${orderSafe.id as string}`"));
assert.ok(verify.includes("event_id: buildEventId(kind, args.orderId)"));
const webhook = readFileSync("src/lib/paystack-webhook.ts", "utf8");
assert.ok(webhook.includes('kind: isOneTime ? "purchase" : "subscription_start",\n      eventKey: order.id as string'));
console.log("meta-purchase-events tests passed");
