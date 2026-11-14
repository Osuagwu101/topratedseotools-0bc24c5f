import { strict as assert } from "node:assert";
import {
  claudeUpstreamHeaders as headers,
  applyClaudeResponseCookies as rotate,
} from "../src/lib/claude-upstream-policy";
import { normaliseClaudeSession } from "../src/lib/claude-session.server";
const origin = "https://claude.topratedseotools.com";
const state = JSON.parse(
  normaliseClaudeSession(
    JSON.stringify({
      cookies: [
        { name: "sessionKey", value: "old-session-value", domain: ".claude.ai", path: "/" },
      ],
    }),
  ),
);
const request = new Request(origin + "/api/organizations", {
  headers: {
    "User-Agent": "client-user-agent",
    "Accept-Language": "en-GB",
    "sec-ch-ua": "actual-client-value",
    Referer: origin + "/chat/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa?view=chat#private-fragment",
    Cookie: "trst_claude_proxy=writer-secret",
    Authorization: "Bearer top-rated-secret",
    "X-Forwarded-For": "private-network",
    Host: "attacker.test",
    "anthropic-client-version": "test-version",
  },
});
const h = headers(request, "sessionKey=vault-value");
assert.equal(h.get("cookie"), "sessionKey=vault-value");
assert.equal(h.get("user-agent"), "client-user-agent");
assert.equal(h.get("accept-language"), "en-GB");
assert.equal(h.get("sec-ch-ua"), "actual-client-value");
assert.equal(h.get("anthropic-client-version"), "test-version");
assert.equal(h.get("origin"), "https://claude.ai");
assert.equal(
  h.get("referer"),
  "https://claude.ai/chat/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa?view=chat",
);
for (const name of ["authorization", "host", "x-forwarded-for"]) assert.equal(h.get(name), null);
for (const referer of [
  "https://attacker.test/new",
  origin + "/__trst/enter?ticket=private",
  origin + "/__host/evil.test/x",
  origin + "/__browser/enter?ticket=private",
]) {
  assert.equal(
    headers(new Request(origin + "/new", { headers: { referer } }), "sessionKey=v").get("referer"),
    "https://claude.ai/new",
  );
}
function response(cookie: string, status = 200, extra: Record<string, string> = {}) {
  return new Response(null, { status, headers: { "set-cookie": cookie, ...extra } });
}
let result = rotate(
  state,
  response(
    "sessionKey=new-session-value; Domain=.claude.ai; Path=/; Secure; HttpOnly; Max-Age=3600",
  ),
  "/new",
  1000000,
);
assert(result.changed);
assert.equal(result.state.cookies[0].value, "new-session-value");
assert.equal(result.state.cookies[0].expires, 4600);
assert.equal(state.cookies[0].value, "old-session-value");
for (const cookie of [
  "sessionKey=attacker; Domain=evil.test; Path=/",
  "newSecret=not-allowed; Domain=claude.ai; Path=/",
  "cf_clearance=challenge-state; Domain=claude.ai; Path=/",
  "__cf_bm=challenge-state; Domain=claude.ai; Path=/",
])
  assert.equal(rotate(state, response(cookie)).changed, false);
for (const status of [401, 403, 500])
  assert.equal(rotate(state, response("sessionKey=bad; Path=/", status)).changed, false);
assert.equal(
  rotate(state, response("sessionKey=bad; Path=/", 200, { "cf-mitigated": "challenge" })).changed,
  false,
);
assert.equal(
  rotate(state, response("sessionKey=bad; Path=/", 302, { location: "https://attacker.test" }))
    .changed,
  false,
);
result = rotate(state, response("sessionKey=deleted; Path=/; Max-Age=0"));
assert(result.changed);
assert.equal(result.state.cookies.length, 0);
assert.throws(() => normaliseClaudeSession(JSON.stringify(result.state)));
result = rotate(state, response("sessionKey=path-value; Path=/api; Secure"));
assert.equal(result.state.cookies.length, 2);
assert.equal(result.state.cookies[0].value, "old-session-value");
console.log(
  "Claude upstream parity: header forwarding, Referer mapping, credential boundaries, rotation scope, expiry and challenge guards passed.",
);
