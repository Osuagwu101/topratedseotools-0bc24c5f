import test from "node:test";
import assert from "node:assert/strict";
import { createQuillBotLaunchService, hashQuillBotProxyToken, quillBotSessionCookies, activeQuillBotGrant, activeQuillBotOrder, type LaunchRepository, type SessionRow } from "../src/lib/quillbot-launch.server.ts";
function fixture() {
  let time = Date.parse("2026-10-07T10:00:00Z");
  const rows = new Map<string, SessionRow>();
  const devices = new Set<string>();
  const state = { enabled: true, entitled: true, source: true, provider: true, status: "active", account: "account_1", limit: 2, touches: 0 };
  const repo: LaunchRepository = {
    enabled: async () => state.enabled,
    access: async () => state.entitled ? { kind: "grant", id: "grant-1" } : null,
    sourceActive: async () => state.source,
    controls: async () => ({ status: state.status, provider_account_key: state.account, device_limit: state.limit }),
    providerReady: async () => state.provider,
    insert: async row => { const id = String(rows.size + 1); rows.set(id, { ...row, id }); },
    find: async (hash, status) => [...rows.values()].find(r => r.token_hash === hash && r.status === status) ?? null,
    claim: async (row, next, now) => {
      const current = rows.get(row.id);
      if (!current || current.status !== "issued" || current.token_hash !== row.token_hash || Date.parse(current.expires_at) <= Date.parse(now)) return false;
      rows.set(row.id, { ...current, ...next, status: "active" }); return true;
    },
    revoke: async id => { const row = rows.get(id); if (row) row.status = "revoked"; },
    device: async (_user, fingerprint, register) => {
      if (devices.has(fingerprint)) return true;
      if (!register || devices.size >= state.limit) return false;
      devices.add(fingerprint); return true;
    },
    touch: async () => { state.touches++; },
  };
  return { service: createQuillBotLaunchService(repo, () => time), state, rows, devices, advance: (ms: number) => { time += ms; } };
}
const fingerprint = "a".repeat(32);
const enter = (cookie = "") => new Request("https://chatgpt.topratedseotools.com/__qbtest/__trst/enter", { headers: { cookie } });
const sessionRequest = (token: string, device = fingerprint) => enter(`trst_qb_proxy=${token}; trst_qb_device=${device}`);
test("valid ticket exchanges for a different token and hashed active row", async () => {
  const f = fixture(); const launch = await f.service.create("user", fingerprint); const session = await f.service.exchange(enter(), launch.token);
  assert.notEqual(session.token, launch.token); assert.equal(session.fingerprint, fingerprint);
  const row = [...f.rows.values()][0]; assert.equal(row.token_hash, hashQuillBotProxyToken(session.token)); assert.equal(row.status, "active");
  assert.ok(!JSON.stringify(row).includes(session.token)); assert.ok(!JSON.stringify(row).includes(launch.token));
});
test("ticket expires at exactly 60 seconds", async () => { const f = fixture(); const t = await f.service.create("user"); f.advance(60000); await assert.rejects(f.service.exchange(enter(), t.token)); });
test("ticket cannot be reused", async () => { const f = fixture(); const t = await f.service.create("user"); await f.service.exchange(enter(), t.token); await assert.rejects(f.service.exchange(enter(), t.token)); });
test("simultaneous exchanges succeed only once", async () => { const f = fixture(); const t = await f.service.create("user", fingerprint); const result = await Promise.allSettled([f.service.exchange(enter(), t.token), f.service.exchange(enter(), t.token)]); assert.equal(result.filter(r => r.status === "fulfilled").length, 1); });
test("invalid and malformed tickets are rejected", async () => { const f = fixture(); await assert.rejects(f.service.exchange(enter(), "invalid")); await assert.rejects(f.service.exchange(enter(), "z".repeat(43))); });
test("missing entitlement prevents launch", async () => { const f = fixture(); f.state.entitled = false; await assert.rejects(f.service.create("user")); assert.equal(f.rows.size, 0); });
test("disabled tool prevents launch", async () => { const f = fixture(); f.state.enabled = false; await assert.rejects(f.service.create("user")); });
test("unconfigured provider prevents launch", async () => { const f = fixture(); f.state.provider = false; await assert.rejects(f.service.create("user")); });
test("suspended controls prevent launch", async () => { const f = fixture(); f.state.status = "suspended"; await assert.rejects(f.service.create("user")); });
test("revoked entitlement prevents ticket exchange", async () => { const f = fixture(); const t = await f.service.create("user"); f.state.source = false; await assert.rejects(f.service.exchange(enter(), t.token)); assert.equal([...f.rows.values()][0].status, "revoked"); });
test("changed account prevents ticket exchange", async () => { const f = fixture(); const t = await f.service.create("user"); f.state.account = "account_2"; await assert.rejects(f.service.exchange(enter(), t.token)); });
test("missing and invalid proxy sessions are denied", async () => { const f = fixture(); assert.equal(await f.service.require(enter()), null); assert.equal(await f.service.require(sessionRequest("z".repeat(43))), null); });
test("valid proxy session is accepted and touched", async () => { const f = fixture(); const t = await f.service.create("user", fingerprint); const s = await f.service.exchange(enter(), t.token); assert.ok(await f.service.require(sessionRequest(s.token))); assert.equal(f.state.touches, 1); });
test("device mismatch prevents access", async () => { const f = fixture(); const t = await f.service.create("user", fingerprint); const s = await f.service.exchange(enter(), t.token); assert.equal(await f.service.require(sessionRequest(s.token, "b".repeat(32))), null); });
test("conflicting existing device prevents exchange", async () => { const f = fixture(); const t = await f.service.create("user", fingerprint); await assert.rejects(f.service.exchange(enter("trst_qb_device=" + "b".repeat(32)), t.token)); });
test("expired proxy session is revoked", async () => { const f = fixture(); const t = await f.service.create("user", fingerprint); const s = await f.service.exchange(enter(), t.token); f.advance(31 * 86400000); assert.equal(await f.service.require(sessionRequest(s.token)), null); });
test("revocation and account change invalidate active sessions", async () => { const f = fixture(); const t = await f.service.create("user", fingerprint); const s = await f.service.exchange(enter(), t.token); f.state.account = "account_2"; assert.equal(await f.service.require(sessionRequest(s.token)), null); assert.equal([...f.rows.values()][0].status, "revoked"); });
test("unregistered device invalidates active session", async () => { const f = fixture(); const t = await f.service.create("user", fingerprint); const s = await f.service.exchange(enter(), t.token); f.devices.clear(); assert.equal(await f.service.require(sessionRequest(s.token)), null); });
test("new device over the limit cannot exchange", async () => { const f = fixture(); f.state.limit = 1; f.devices.add("b".repeat(32)); const t = await f.service.create("user", fingerprint); await assert.rejects(f.service.exchange(enter(), t.token)); });
test("cookies are scoped, HttpOnly, Secure, SameSite and contain no provider state", () => { const cookies = quillBotSessionCookies("opaque-proxy", fingerprint, "2026-11-01T00:00:00Z"); for (const c of cookies) { assert.match(c, /Path=\/__qbtest;/); assert.match(c, /HttpOnly; Secure; SameSite=Lax/); assert.ok(!c.includes("useridtoken")); } });
test("paid order and manual grant entitlement semantics match StealthWriter", () => { assert.equal(activeQuillBotOrder({ status: "approved", payment_status: "pending" }), false); assert.equal(activeQuillBotOrder({ status: "approved", payment_status: "successful", access_type: "private", fulfilment_status: "pending" }), false); assert.equal(activeQuillBotOrder({ status: "approved", payment_status: "successful" }), true); assert.equal(activeQuillBotGrant({ status: "active", expires_at: "invalid" }), false); assert.equal(activeQuillBotGrant({ status: "active" }), true); });
