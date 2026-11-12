import { strict as assert } from "node:assert";
import vm from "node:vm";
import {
  claudeRoutePolicy as route,
  claudeCookieHeader,
  rewriteClaudeBody,
  claudeBootstrapScript,
  filterClaudeConversationList,
  claudeResponseContainsSecret,
} from "../src/lib/claude-proxy-policy";
import {
  normaliseClaudeSession,
  encryptClaudeSession,
  decryptClaudeSession,
} from "../src/lib/claude-session.server";
const org = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const mine = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const other = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const base = `/api/organizations/${org}/chat_conversations`;
const state = JSON.parse(
  normaliseClaudeSession(
    JSON.stringify({
      cookies: [
        { name: "sessionKey", value: "test-session-secret-12345", domain: ".claude.ai", path: "/" },
        { name: "cf_clearance", value: "discard", domain: ".claude.ai" },
      ],
    }),
  ),
);
assert.equal(state.cookies.length, 1);
assert.throws(() =>
  normaliseClaudeSession(
    '{"cookies":[{"name":"sessionKey","value":"bad","domain":"evil.claude.ai.attacker.com"}]}',
  ),
);
assert.throws(() =>
  normaliseClaudeSession('{"cookies":[{"name":"analytics","value":"x","domain":".claude.ai"}]}'),
);
assert.throws(() =>
  normaliseClaudeSession(
    '{"cookies":[{"name":"sessionKey","value":"bad; Cookie=evil","domain":".claude.ai"}]}',
  ),
);
assert.throws(() =>
  normaliseClaudeSession(
    '{"cookies":[{"name":"sessionKey","value":"old","domain":".claude.ai","expires":1}]}',
  ),
);
const key = "11".repeat(32),
  encrypted = encryptClaudeSession(JSON.stringify(state), key);
assert(!encrypted.includes(state.cookies[0].value));
assert.equal(decryptClaudeSession(encrypted, key), JSON.stringify(state));
assert.throws(() => decryptClaudeSession(encrypted, "22".repeat(32)));
assert.equal(claudeCookieHeader(state), "sessionKey=test-session-secret-12345");
assert.equal(
  claudeCookieHeader({ ...state, cookies: [{ ...state.cookies[0], path: "/api" }] }, "/apix"),
  "",
);
assert.equal(route("GET", base)?.kind, "list");
assert.equal(route("POST", base)?.kind, "create");
assert.equal(route("POST", `${base}/${mine}/completion`)?.conversation, mine);
assert.equal(route("GET", `/chat/${mine}`)?.conversation, mine);
for (const [method, path] of [
  ["DELETE", base],
  ["DELETE", `${base}/${mine}`],
  ["POST", "/api/auth/logout"],
  ["GET", `/api/organizations/${org}/projects`],
  ["GET", `${base}/search`],
  ["GET", `/api/organizations/${org}/files/${other}`],
  ["PATCH", "/api/account"],
  ["GET", "/settings/billing"],
  ["GET", "/__host/evil.com/x"],
  ["POST", `${base}/${mine}/share`],
  ["GET", `/chat/${mine}%2f..%2fsettings`],
  ["GET", "/api/new-unknown-feature"],
])
  assert.equal(route(method, path), null, `${method} ${path} must fail closed`);
assert.deepEqual(
  filterClaudeConversationList(
    [
      { uuid: mine, name: "Mine" },
      { uuid: other, name: "Other" },
    ],
    new Set([mine]),
  ),
  [{ uuid: mine, name: "Mine" }],
);
assert.throws(() => filterClaudeConversationList({ items: [{ uuid: other }] }, new Set([mine])));
assert(claudeResponseContainsSecret("prefix test-session-secret-12345 suffix", state));
assert(!claudeResponseContainsSecret("regular chat text", state));
assert.equal(
  rewriteClaudeBody(
    "https://claude.ai/new https://claude.ai.attacker.com/",
    "https://claude.topratedseotools.com",
  ),
  "https://claude.topratedseotools.com/new https://claude.ai.attacker.com/",
);
new vm.Script(
  claudeBootstrapScript()
    .replace(/^<script>/, "")
    .replace(/<\/script>$/, ""),
);
console.log(
  "Claude vault, route policy, history filtering, secret guard and bootstrap checks passed.",
);

// Exercise the actual handler with two writers and a mocked upstream/database.
const { mock } = await import("bun:test");
let active = true,
  access = true,
  settings = true,
  upstreamCalls = 0;
let lastUpstreamHeaders = new Headers();
const encryptedState = encryptClaudeSession(JSON.stringify(state), key);
process.env.CLAUDE_SESSION_ENCRYPTION_KEY = key;
process.env.CLAUDE_PROXY_VERIFIED = "true";
process.env.CLAUDE_PROXY_PUBLIC_ORIGIN = "https://claude.topratedseotools.com";
const db = {
  from(table: string) {
    const filters: Record<string, unknown> = {};
    const q: any = {
      select() {
        return q;
      },
      eq(k: string, v: unknown) {
        filters[k] = v;
        return q;
      },
      update() {
        return q;
      },
      insert() {
        return q;
      },
      async maybeSingle() {
        if (table === "claude_proxy_sessions")
          return {
            data: active
              ? {
                  id: "session",
                  user_id: "writer-a",
                  source_kind: "grant",
                  source_id: "grant",
                  status: "active",
                  expires_at: new Date(Date.now() + 100000).toISOString(),
                }
              : null,
          };
        if (table === "tool_authorized_sessions")
          return { data: { status: "stored", encrypted_payload: encryptedState } };
        if (table === "tool_settings")
          return { data: { enabled: settings, one_click_auth_enabled: settings } };
        if (table === "tool_access_grants")
          return { data: { status: access ? "active" : "revoked", expires_at: null } };
        if (table === "claude_conversation_owners")
          return {
            data: {
              user_id: filters.conversation_id === mine ? "writer-a" : "writer-b",
              organization_id: org,
            },
          };
        return { data: null };
      },
      then(resolve: any) {
        resolve({
          data: table === "claude_conversation_owners" ? [{ conversation_id: mine }] : null,
          error: null,
        });
      },
    };
    return q;
  },
};
mock.module("../src/integrations/supabase/client.server", () => ({ supabaseAdmin: db }));
const { handleClaudeProxyRequest: handle } = await import("../src/lib/claude-proxy.server");
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (_input: any, init: any) => {
  upstreamCalls++;
  lastUpstreamHeaders = new Headers(init.headers);
  return new Response('event: completion\ndata: {"completion":"hello"}\n\n', {
    headers: { "content-type": "text/event-stream" },
  });
}) as typeof fetch;
const origin = "https://claude.topratedseotools.com";
function request(path: string, method = "GET", body?: string) {
  return new Request(origin + path, {
    method,
    headers: {
      Cookie: `trst_claude_proxy=${"a".repeat(43)}`,
      Origin: origin,
      "Content-Type": "application/json",
      Authorization: "Bearer browser-secret",
    },
    body,
  });
}
try {
  assert.equal((await handle(new Request(origin + "/new"))).status, 401);
  active = false;
  assert.equal((await handle(request("/new"))).status, 401);
  active = true;
  assert.equal((await handle(request(`/chat/${other}`))).status, 404);
  assert.equal((await handle(request(`${base}/${other}`))).status, 404);
  assert.equal(
    (await handle(request(`${base}/${other}/completion`, "POST", '{"prompt":"x"}'))).status,
    404,
  );
  assert.equal((await handle(request("/api/account", "PATCH", "{}"))).status, 403);
  assert.equal((await handle(request(`/api/organizations/${org}/projects`))).status, 403);
  assert.equal(
    (
      await handle(
        request(`${base}/${mine}/completion`, "POST", '{"files":["someone-elses-file"]}'),
      )
    ).status,
    403,
  );
  const crossSite = request(`${base}/${mine}/completion`, "POST", "{}");
  crossSite.headers.set("Origin", "https://attacker.test");
  assert.equal((await handle(crossSite)).status, 403);
  assert.equal(upstreamCalls, 0, "forbidden requests must never contact Claude");
  const stream = await handle(request(`${base}/${mine}/completion`, "POST", '{"prompt":"hello"}'));
  assert.equal(stream.status, 200);
  assert((await stream.text()).includes('"completion":"hello"'));
  assert.equal(lastUpstreamHeaders.get("cookie"), "sessionKey=test-session-secret-12345");
  assert.equal(lastUpstreamHeaders.get("authorization"), null);
  access = false;
  assert.equal((await handle(request(`/chat/${mine}`))).status, 401);
  access = true;
  settings = false;
  assert.equal((await handle(request(`/chat/${mine}`))).status, 503);
  settings = true;
  process.env.CLAUDE_PROXY_VERIFIED = "false";
  assert.equal((await handle(request(`/chat/${mine}`))).status, 503);
} finally {
  globalThis.fetch = originalFetch;
  mock.restore();
}
console.log(
  "Claude handler: foreign-writer access, revocation, disabled launch, CSRF and streaming checks passed.",
);
