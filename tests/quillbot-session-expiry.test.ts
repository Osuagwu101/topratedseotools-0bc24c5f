import test from "node:test";
import assert from "node:assert/strict";
import { quillBotSessionExpiry } from "../src/lib/quillbot-session.server.ts";
const token = (payload: unknown) => "eyJhbGciOiJSUzI1NiJ9." + Buffer.from(JSON.stringify(payload)).toString("base64url") + ".signature";
test("expiry identifies the saved session lifetime without exposing claims", () => {
  const result = quillBotSessionExpiry(token({exp:1791381139,iat:1791377539,sub:"private-user"}), Date.parse("2026-10-07T15:00:00Z"));
  assert.deepEqual(result, {expiresAt:"2026-10-07T13:52:19.000Z",expired:true});
});
test("fresh ID token remains acceptable before its expiry", () => {
  assert.equal(quillBotSessionExpiry(token({exp:2000}), 1999000).expired, false);
  assert.equal(quillBotSessionExpiry(token({exp:2000}), 2000000).expired, true);
});
test("opaque and malformed token formats do not gain an invented lifetime", () => {
  for (const value of ["opaque-token", "a.b.c", token({}), token({exp:"2000"}), token({exp:1e100})]) {
    assert.deepEqual(quillBotSessionExpiry(value), {expiresAt:null,expired:null});
  }
});
