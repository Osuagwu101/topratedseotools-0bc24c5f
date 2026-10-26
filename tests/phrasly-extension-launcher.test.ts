import test from "node:test";
import assert from "node:assert/strict";
import { createPhraslyLauncher, type ExtensionRuntime } from "../src/lib/phrasly-extension/launcher.ts";

const id = "a".repeat(32);
const token = { payload: "fixture", signature: "a".repeat(64) };
function setup({ enabled = true, outcome = { ok: true, provider_login: "not_performed" }, noReply = "", handoff = async () => token } = {}) {
  const messages: Record<string, unknown>[] = []; let issued = 0;
  const runtime: ExtensionRuntime = { sendMessage(_id, message, reply) {
    const data = message as Record<string, unknown>; messages.push(data);
    if (data.type === noReply) return;
    reply(data.type === "trst_ping" ? { ok: true, protocol: 2, enabled } : outcome);
  } };
  const bridge = createPhraslyLauncher({ extensionId: id, runtime, timeoutMs: 20,
    requestHandoff: async () => { issued++; return handoff(); } });
  return { bridge, messages, issued: () => issued };
}
test("installed enabled bridge requests one handoff and preserves the AWS message", async () => {
  const fixture = setup();
  assert.deepEqual(await fixture.bridge.launch("humanizer"), { ok: true, provider_login: "not_performed" });
  assert.equal(fixture.issued(), 1);
  assert.deepEqual(fixture.messages, [{ type: "trst_ping" }, { type: "trst_access", ...token }]);
});
test("disabled extension does not request a handoff", async () => {
  const fixture = setup({ enabled: false });
  assert.equal((await fixture.bridge.launch("humanizer")).error, "extension_disabled");
  assert.equal(fixture.issued(), 0);
});
test("missing extension or SSR runtime does not request a handoff", async () => {
  const bridge = createPhraslyLauncher({ extensionId: id, requestHandoff: async () => { assert.fail("must not issue"); } });
  assert.equal((await bridge.launch("ai_detector")).error, "extension_unavailable");
});
test("readiness timeout does not issue a handoff", async () => {
  const fixture = setup({ noReply: "trst_ping" });
  assert.equal((await fixture.bridge.launch("humanizer")).error, "extension_unavailable"); assert.equal(fixture.issued(), 0);
});
test("a lost launch response is reported without replaying a handoff", async () => {
  const fixture = setup({ noReply: "trst_access" });
  assert.equal((await fixture.bridge.launch("humanizer")).error, "launch_state_unknown");
  assert.equal(fixture.issued(), 1); assert.equal(fixture.messages.length, 2);
});
test("backend errors and malformed handoffs do not reach the worker", async () => {
  for (const handoff of [async () => { throw new Error("private detail"); }, async () => ({ payload: "?", signature: "bad" })]) {
    const fixture = setup({ handoff }); const result = await fixture.bridge.launch("humanizer");
    assert.equal(result.ok, false); assert.ok(["handoff_unavailable", "invalid_handoff"].includes(result.error!));
    assert.equal(fixture.messages.length, 1);
  }
});
test("browser lastError is consumed and not exposed", async () => {
  const runtime: ExtensionRuntime = { lastError: { message: "private browser detail" }, sendMessage(_id, _message, reply) { reply(undefined); } };
  const bridge = createPhraslyLauncher({ extensionId: id, runtime, requestHandoff: async () => token });
  assert.deepEqual(await bridge.probe(), { ok: false, error: "extension_unavailable" });
});
test("invalid extension IDs fail before any external messaging", () => {
  for (const extensionId of ["", "a".repeat(31), "z".repeat(32), "https://example.com/"]) {
    assert.throws(() => createPhraslyLauncher({ extensionId, requestHandoff: async () => token }), /invalid_extension_configuration/);
  }
});
test("a provider-login assertion cannot be reported as a successful launch", async () => {
  const fixture = setup({ outcome: { ok: true, provider_login: "authenticated" } });
  assert.deepEqual(await fixture.bridge.launch("humanizer"), { ok: false, error: "launch_failed" });
});
