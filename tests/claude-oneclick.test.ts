delete process.env.CLAUDE_BROWSER_RELAY_URL;
delete process.env.CLAUDE_SHARED_BROWSER_TRANSPORT;
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
  ["GET", `/api/organizations/${org}/files/${other}/../../settings`],
  ["DELETE", `/api/organizations/${org}/conversations/${mine}/wiggle/upload-file`],
  ["PUT", `/api/${org}/upload`],
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
delete process.env.CLAUDE_BROWSER_RELAY_URL;
// Provider files already uploaded: one by this writer, one by another writer.
const fileOwners: any[] = [
  { file_id: "file-of-writer-a-001", user_id: "writer-a", organization_id: org, provider_account_key: "account_1" },
  { file_id: "someone-elses-file", user_id: "writer-b", organization_id: org, provider_account_key: "account_1" },
];
const db = {
  async rpc(){return {data:{allowed:true,limit:25,used:1,remaining:24},error:null};},
  from(table: string) {
    const filters: Record<string, unknown> = {};
    let inList: string[] | null = null;
    const q: any = {
      in(_k: string, v: string[]) {
        inList = v;
        return q;
      },
      async upsert(rows: any[]) {
        for (const r of rows) if (!fileOwners.some((f) => f.file_id === r.file_id)) fileOwners.push(r);
        return { error: null };
      },
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
                  id: "session", provider_account_key:"account_1",
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
        if(table==="claude_user_controls")return {data:{provider_account_key:"account_1"}};
        if(table==="claude_provider_accounts")return {data:{status:"connected"}};
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
        if (table === "claude_file_owners")
          return resolve({ data: fileOwners.filter((f) => !inList || inList.includes(f.file_id)), error: null });
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
let uploadResponse: any = { file_uuid: "new-upload-file-0001", file_name: "report.docx" };
globalThis.fetch = (async (input: any, init: any) => {
  upstreamCalls++;
  lastUpstreamHeaders = new Headers(init.headers);
  const path = new URL(String(input)).pathname;
  if (/\/(?:upload|upload-file)$/.test(path))
    return new Response(JSON.stringify(uploadResponse), { headers: { "content-type": "application/json" } });
  if (/\/files\/[^/]+\/preview$/.test(path))
    return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "content-type": "image/png" } });
  if (/\/wiggle\/download-file$/.test(path))
    return new Response("<script>alert(1)</script>", { headers: { "content-type": "text/html", "content-disposition": "inline; filename=x.html" } });
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
    404,
  );
  assert.equal((await handle(request(`${base}/${mine}/completion`, "POST", '{"project_uuid":"p"}'))).status, 403);
  assert.equal((await handle(request(`/api/${org}/files/someone-elses-file/preview`))).status, 404);
  assert.equal(
    (await handle(request(`/api/organizations/${org}/conversations/${other}/wiggle/download-file?path=/mnt/user-data/uploads/a.docx`))).status,
    404,
  );
  assert.equal(
    (await handle(request(`/api/organizations/${org}/conversations/${mine}/wiggle/upload-file`, "POST", "{}"))).status,
    415,
    "uploads must be multipart",
  );
  const crossSite = request(`${base}/${mine}/completion`, "POST", "{}");
  crossSite.headers.set("Origin", "https://attacker.test");
  assert.equal((await handle(crossSite)).status, 403);
  assert.equal((await handle(request(base,"POST",JSON.stringify({uuid:other})))).status,404);
  assert.equal((await handle(request(base,"POST",JSON.stringify({uuid:"bad"})))).status,400);
  assert.equal(upstreamCalls, 0, "forbidden requests must never contact Claude");
  // Writer uploads a file in their own chat; ownership is recorded from the provider response.
  const form = new FormData();
  form.append("file", new Blob(["hello"], { type: "text/plain" }), "report.txt");
  const upload = new Request(`${origin}/api/organizations/${org}/conversations/${mine}/wiggle/upload-file`, {
    method: "POST",
    headers: { Cookie: `trst_claude_proxy=${"a".repeat(43)}`, Origin: origin },
    body: form,
  });
  const uploaded = await handle(upload);
  assert.equal(uploaded.status, 200);
  assert(fileOwners.some((f) => f.file_id === "new-upload-file-0001" && f.user_id === "writer-a" && f.conversation_id === mine));
  // A provider id already owned by someone else is never handed to this writer.
  uploadResponse = { file_uuid: "someone-elses-file" };
  const legacyForm = new FormData();
  legacyForm.append("file", new Blob(["x"]), "x.pdf");
  const conflict = await handle(new Request(`${origin}/api/${org}/upload`, {
    method: "POST", headers: { Cookie: `trst_claude_proxy=${"a".repeat(43)}`, Origin: origin }, body: legacyForm,
  }));
  assert.equal(conflict.status, 503);
  assert.equal(fileOwners.find((f) => f.file_id === "someone-elses-file").user_id, "writer-b");
  // Own files can be attached, inline text attachments are fine, previews stream back sandboxed.
  for (const payload of [
    { prompt: "summarise", files: ["new-upload-file-0001", "file-of-writer-a-001"] },
    { prompt: "summarise", attachments: [{ file_name: "a.docx", extracted_content: "text" }] },
    { prompt: "summarise", files: [{ path: "/mnt/user-data/uploads/report.txt" }] },
  ]) {
    const sent = await handle(request(`${base}/${mine}/completion`, "POST", JSON.stringify(payload)));
    assert.equal(sent.status, 200, JSON.stringify(payload));
    await sent.text();
  }
  const preview = await handle(request(`/api/${org}/files/file-of-writer-a-001/preview`));
  assert.equal(preview.status, 200);
  assert.equal(preview.headers.get("content-type"), "image/png");
  assert.match(preview.headers.get("content-security-policy") ?? "", /sandbox/);
  const download = await handle(request(`/api/organizations/${org}/conversations/${mine}/wiggle/download-file?path=/mnt/user-data/outputs/x.html`));
  assert.equal(download.status, 200);
  assert.match(download.headers.get("content-disposition") ?? "", /^attachment/);
  assert.equal(await download.text(), "<script>alert(1)</script>", "file bytes are returned unmodified");
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
