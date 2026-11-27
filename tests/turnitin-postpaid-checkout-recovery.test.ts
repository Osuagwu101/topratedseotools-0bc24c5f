import test from "node:test";
import assert from "node:assert/strict";
import { recoverPendingPostpaidCheckout } from "../src/lib/turnitin-postpaid-checkout-recovery.ts";

function setup(status: "pending" | "failed" | "success") {
  const events: string[] = [];
  const deps = {
    reference: "checkout-1",
    settlementEnvironment: "live",
    gatewayEnvironment: "live",
    verify: async (reference: string) => {
      events.push(`verify:${reference}`);
      return { status, reference, amount: 1000000, currency: "NGN", raw: {} };
    },
    markFailed: async () => { events.push("failed"); },
    confirm: async () => { events.push("confirmed"); },
  };
  return { deps, events };
}

test("an abandoned/failed gateway checkout is cleared only after live verification", async () => {
  const { deps, events } = setup("failed");
  assert.equal(await recoverPendingPostpaidCheckout(deps), "failed");
  assert.deepEqual(events, ["verify:checkout-1", "failed"]);
});
test("a genuinely pending payment stays pending and cannot be replaced", async () => {
  const { deps, events } = setup("pending");
  assert.equal(await recoverPendingPostpaidCheckout(deps), "pending");
  assert.deepEqual(events, ["verify:checkout-1"]);
});
test("an already paid checkout is confirmed instead of discarded", async () => {
  const { deps, events } = setup("success");
  assert.equal(await recoverPendingPostpaidCheckout(deps), "confirmed");
  assert.deepEqual(events, ["verify:checkout-1", "confirmed"]);
});
test("a verification outage never clears an uncertain payment", async () => {
  const { deps, events } = setup("failed");
  deps.verify = async () => { throw new Error("Gateway unavailable"); };
  await assert.rejects(recoverPendingPostpaidCheckout(deps), /Gateway unavailable/);
  assert.deepEqual(events, []);
});
test("missing reference and environment mismatch fail before contacting the gateway", async () => {
  const { deps, events } = setup("failed");
  await assert.rejects(recoverPendingPostpaidCheckout({ ...deps, reference: null }), /support verification/);
  await assert.rejects(recoverPendingPostpaidCheckout({ ...deps, gatewayEnvironment: "test" }), /environment/);
  assert.deepEqual(events, []);
});
test("a different transaction reference never clears or confirms the checkout", async () => {
  const { deps, events } = setup("failed");
  const verify = deps.verify;
  deps.verify = async (r) => ({ ...await verify(r), reference: "other-checkout" });
  await assert.rejects(recoverPendingPostpaidCheckout(deps), /reference verification failed/);
  assert.deepEqual(events, ["verify:checkout-1"]);
});
test("failed currency/amount/owner validation prevents recovery from reporting success", async () => {
  const { deps, events } = setup("success");
  deps.confirm = async () => { throw new Error("Postpaid settlement metadata verification failed."); };
  await assert.rejects(recoverPendingPostpaidCheckout(deps), /metadata verification/);
  assert.deepEqual(events, ["verify:checkout-1"]);
});
test("a concurrent webhook or failed write prevents opening a replacement", async () => {
  const { deps } = setup("failed");
  deps.markFailed = async () => { throw new Error("Payment changed"); };
  await assert.rejects(recoverPendingPostpaidCheckout(deps), /Payment changed/);
});
