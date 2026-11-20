import { strict as assert } from "node:assert";
import { normaliseQuillBotSession, normaliseQuillBotFirebaseAuth, quillBotSessionRenewable, QUILLBOT_EXPORT_SOURCE } from "../src/lib/quillbot-session.server";

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (exp: number) => [b64({ alg: "RS256" }), b64({ sub: "user-1", exp, iat: exp - 3600 }), "sig".repeat(40)].join(".");
const expired = jwt(Math.floor(Date.now() / 1000) - 7200);
const key = "firebase:authUser:AIzaSyTestKey_abcdef123:[DEFAULT]";
const record = { store: "indexedDB", key, value: { uid: "user-1", stsTokenManager: { refreshToken: "r".repeat(200), accessToken: expired, expirationTime: 1 } } };

// Export-snippet format keeps cookies, adds useridtoken, and carries the sign-in record.
const out = JSON.parse(normaliseQuillBotSession(JSON.stringify({
  source: QUILLBOT_EXPORT_SOURCE, version: 1,
  cookie: "connect.sid=abc; cf_clearance=drop; authenticated=true; premium=true",
  useridtoken: "", firebase_auth: JSON.stringify(record),
})));
assert.deepEqual(Object.keys(out).sort(), ["cookie", "firebase_auth", "useridtoken"]);
assert.equal(out.useridtoken, expired, "falls back to the record's access token when the cookie is httpOnly");
assert(out.cookie.includes("connect.sid=abc") && out.cookie.includes("useridtoken=") && !out.cookie.includes("cf_clearance"));
assert.equal(JSON.parse(out.firebase_auth).value.stsTokenManager.refreshToken.length, 200);
assert(quillBotSessionRenewable(JSON.stringify(out)));

// Stored state round-trips (decrypt -> normalise on every launch, and token rotation).
const again = JSON.parse(normaliseQuillBotSession(JSON.stringify({ ...out, useridtoken: jwt(Math.floor(Date.now() / 1000) + 3600) })));
assert.equal(again.firebase_auth, out.firebase_auth);

// Plain cookie sessions still work and are not renewable.
const plain = normaliseQuillBotSession(JSON.stringify({ cookie: "useridtoken=x", useridtoken: "x".repeat(120) }));
assert(!quillBotSessionRenewable(plain));

// Bad records are refused.
assert.throws(() => normaliseQuillBotFirebaseAuth({ key: "evil", value: record.value }));
assert.throws(() => normaliseQuillBotFirebaseAuth({ key, value: { stsTokenManager: {} } }), /refresh token/);
assert.throws(() => normaliseQuillBotSession(JSON.stringify({ source: QUILLBOT_EXPORT_SOURCE, cookie: "", useridtoken: "", firebase_auth: "{}" })));
console.log("QuillBot refresh-token sessions: export parsing, httpOnly fallback, round-trip, plain-cookie compatibility and validation passed.");
