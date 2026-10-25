import test from "node:test";
import assert from "node:assert/strict";
import { issueAwsHandoff, issueAwsRecordToken, signAwsClaims, verifyAwsToken, watUsageDay, secondsUntilWatReset, underDailyLimit } from "../src/lib/phrasly-extension/protocol.server.ts";
const secret = "fixture-secret-for-protocol-tests-only-not-live";
const now = 1_000_000;

test("handoff reproduces AWS field order, base64url and HMAC-SHA256 hex", () => {
  const expectedJson = '{"uid":42,"tool_id":7,"feature":"humanizer","exp":1000060}';
  const expectedPayload = Buffer.from(expectedJson).toString("base64url");
  // Independent Python hmac/hashlib vector for the recovered PHP representation.
  const expectedSignature = "f9b9b38e856c9e68e5f689de2087349faba2d954f1a5c0c77a12b22a131dbe51";
  const token = issueAwsHandoff(42, 7, "humanizer", now, secret);
  assert.deepEqual(token, { payload: expectedPayload, signature: expectedSignature });
  assert.deepEqual(verifyAwsToken(token.payload, token.signature, "handoff", now, secret), JSON.parse(expectedJson));
});
test("Supabase UUID identity retains the same wire field without copying AWS users", () => {
  const token = issueAwsHandoff("00000000-0000-4000-8000-000000000001", "phrasly", "ai_detector", now, secret);
  assert.equal(verifyAwsToken(token.payload, token.signature, "handoff", now, secret).tool_id, "phrasly");
});
test("handoff has the recovered exact expiry boundary and expires after it", () => {
  const t = issueAwsHandoff(42, 7, "humanizer", now, secret);
  assert.equal(verifyAwsToken(t.payload, t.signature, "handoff", now + 60, secret).uid, 42);
  assert.throws(() => verifyAwsToken(t.payload, t.signature, "handoff", now + 61, secret), /token_expired/);
});
test("separate record token lives four hours and contains no provider credential", () => {
  const record = issueAwsRecordToken(42, 7, now, secret);
  const [payload, signature] = record.split(".");
  const data = verifyAwsToken(payload, signature, "record", now, secret);
  assert.deepEqual(data, { uid: 42, tool_id: 7, exp: now + 14400 });
  assert.throws(() => verifyAwsToken(payload, signature, "record", now + 14401, secret), /token_expired/);
});
test("handoff cannot be substituted for a record token", () => {
  const t = issueAwsHandoff(42, 7, "humanizer", now, secret);
  assert.throws(() => verifyAwsToken(t.payload, t.signature, "record", now, secret), /bad_token/);
});
test("record token cannot be substituted for a handoff", () => {
  const [payload, signature] = issueAwsRecordToken(42, 7, now, secret).split(".");
  assert.throws(() => verifyAwsToken(payload, signature, "handoff", now, secret), /bad_token/);
});
test("modified payload and incorrect signature fail validation", () => {
  const t = issueAwsHandoff(42, 7, "humanizer", now, secret);
  assert.throws(() => verifyAwsToken(t.payload.slice(0, -1) + "A", t.signature, "handoff", now, secret), /bad_signature/);
  assert.throws(() => verifyAwsToken(t.payload, "0".repeat(64), "handoff", now, secret), /bad_signature/);
});
for (const signature of ["", "0", "z".repeat(64)]) test(`malformed signature length ${signature.length}`, () => {
  const t = issueAwsHandoff(42, 7, "humanizer", now, secret);
  assert.throws(() => verifyAwsToken(t.payload, signature, "handoff", now, secret), /bad_token/);
});
test("a new deployment needs its own sufficiently long secret", () => {
  assert.throws(() => issueAwsHandoff(42, 7, "humanizer", now, "short"), /handoff_secret_required/);
});
for (const data of [
  { uid: 0, tool_id: 7, feature: "humanizer", exp: now + 60 },
  { uid: 42, tool_id: 7, feature: "unknown", exp: now + 60 },
  { uid: 42, tool_id: 7, feature: "humanizer", exp: now + 61 },
  { uid: 42, tool_id: 7, feature: "humanizer", exp: now + 60, role: "admin" },
]) test(`signed malformed claims ${JSON.stringify(data)}`, () => {
  const t = signAwsClaims(data as never, secret);
  assert.throws(() => verifyAwsToken(t.payload, t.signature, "handoff", now, secret), /bad_token/);
});
test("WAT day and reset cross 23:00 UTC, matching Africa/Lagos midnight", () => {
  const before = Date.parse("2026-10-25T22:59:59Z") / 1000;
  assert.equal(watUsageDay(before), "2026-10-25"); assert.equal(secondsUntilWatReset(before), 1);
  assert.equal(watUsageDay(before + 1), "2026-10-26"); assert.equal(secondsUntilWatReset(before + 1), 86400);
});
for (const [used, limit, allowed] of [[0, 0, false], [0, 20, true], [19, 20, true], [20, 20, false], [21, 20, false], [-1, 20, false], [1.5, 20, false]] as const) {
  test(`quota boundary ${used}/${limit}`, () => assert.equal(underDailyLimit(used, limit), allowed));
}
