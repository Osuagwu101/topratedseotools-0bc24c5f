delete process.env.CLAUDE_BROWSER_RELAY_URL;
delete process.env.CLAUDE_SHARED_BROWSER_TRANSPORT;
import { strict as assert } from "node:assert";
import { mock } from "bun:test";
import {
  encryptClaudeSession,
  decryptClaudeSession,
  normaliseClaudeSession,
} from "../src/lib/claude-session.server";
const key = "11".repeat(32);
process.env.CLAUDE_SESSION_ENCRYPTION_KEY = key;
process.env.CLAUDE_PROXY_VERIFIED = "true";
const state = normaliseClaudeSession(
  JSON.stringify({
    cookies: [{ name: "sessionKey", value: "old-session-123456", domain: ".claude.ai", path: "/" }],
  }),
);
const encrypted = encryptClaudeSession(state, key);
const writes: any[] = [];
let writeError = false;
const db = {
  from(table: string) {
    const filters: Record<string, unknown> = {};
    let patch: any;
    const q: any = {
      select() {
        return q;
      },
      eq(k: string, v: unknown) {
        filters[k] = v;
        return q;
      },
      update(p: any) {
        patch = p;
        return q;
      },
      async maybeSingle() {
        if (table === "tool_authorized_sessions")
          return { data: { status: "stored", encrypted_payload: encrypted } };
        if (table === "tool_settings")
          return { data: { enabled: true, one_click_auth_enabled: true } };
        if (table === "tool_access_grants") return { data: { status: "active", expires_at: null } };
        if (table === "claude_proxy_sessions")
          return {
            data: {
              id: "s",
              user_id: "writer",
              source_kind: "grant",
              source_id: "g",
              expires_at: new Date(Date.now() + 100000).toISOString(),
            },
          };
        return { data: null };
      },
      then(resolve: any) {
        if (table === "tool_authorized_sessions") writes.push({ patch, filters: { ...filters } });
        resolve({
          data: null,
          error:
            table === "tool_authorized_sessions" && writeError
              ? { message: "write failure" }
              : null,
        });
      },
    };
    return q;
  },
};
mock.module("../src/integrations/supabase/client.server", () => ({ supabaseAdmin: db }));
const { handleClaudeProxyRequest: handle } = await import("../src/lib/claude-proxy.server");
const original = globalThis.fetch;
const request = () =>
  new Request("https://claude.topratedseotools.com/api/account", {
    headers: { Cookie: "trst_claude_proxy=" + "a".repeat(43) },
  });
let reply = () =>
  new Response('{"ok":true}', {
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": "sessionKey=rotated-secret-123456; Path=/; Secure; HttpOnly",
    },
  });
globalThis.fetch = (async () => reply()) as typeof fetch;
try {
  let response = await handle(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].filters.tool_slug, "claude");
  assert.equal(writes[0].filters.encrypted_payload, encrypted);
  assert(!writes[0].patch.encrypted_payload.includes("rotated-secret-123456"));
  assert.equal(
    JSON.parse(decryptClaudeSession(writes[0].patch.encrypted_payload, key)).cookies[0].value,
    "rotated-secret-123456",
  );
  writes.length = 0;
  reply = () =>
    new Response('{"session":"rotated-secret-123456"}', {
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": "sessionKey=rotated-secret-123456; Path=/",
      },
    });
  response = await handle(request());
  assert.equal(response.status, 502);
  assert(!(await response.text()).includes("rotated-secret-123456"));
  writes.length = 0;
  reply = () =>
    new Response("challenge", {
      status: 403,
      headers: { "cf-mitigated": "challenge", "Set-Cookie": "sessionKey=bad; Path=/" },
    });
  response = await handle(request());
  assert.equal(response.status, 503);
  assert.equal(writes.length, 0);
  reply = () =>
    new Response('{"ok":true}', {
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": "sessionKey=rotated-secret-123456; Path=/",
      },
    });
  writeError = true;
  response = await handle(request());
  assert.equal(response.status, 503);
  console.log(
    "Claude handler rotation: encrypted scoped persistence, stale-write guard, no client cookies, rotated-secret redaction, challenge rejection and write-failure checks passed.",
  );
} finally {
  globalThis.fetch = original;
  mock.restore();
}
