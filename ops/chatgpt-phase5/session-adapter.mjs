import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import {
  MAX_REQUEST_BYTES,
  Phase4PolicyError,
  sanitizeUpstreamHeaders,
  sanitizeUpstreamResponseHeaders,
  rewriteLocation,
  rewriteTextBody,
  bodyMode,
} from "../chatgpt-phase4/transport.mjs";

export const CHATGPT_SESSION_FORMAT = "chatgpt_minimal_cookie_json_v3";
const AAD_V3 = Buffer.from("topratedseotools:chatgpt:minimal_cookie_json:v3", "utf8");
const LEGACY_AAD = Buffer.from("topratedseotools:chatgpt:session_state_json:v1", "utf8");

const SAFE_CODES = new Set([
  "missing_chatgpt_session_source",
  "chatgpt_account_mismatch",
  "chatgpt_session_invalid",
  "chatgpt_session_token_missing",
  "chatgpt_session_token_incomplete",
  "chatgpt_session_token_ambiguous",
  "chatgpt_session_cookie_scope_invalid",
  "chatgpt_session_expired",
  "upstream_network_error",
  "upstream_auth_rejected",
  "upstream_edge_challenge",
  "upstream_external_redirect",
  "request_too_large",
]);

export class Phase5SessionError extends Error {
  constructor(code, status = 503) {
    super(code);
    this.code = SAFE_CODES.has(code) ? code : "chatgpt_session_invalid";
    this.status = status;
  }
}

const fail = (code, status) => { throw new Phase5SessionError(code, status); };

export const CHATGPT_SESSION_COOKIE = "__Secure-next-auth.session-token";
export const CHATGPT_SESSION_CHUNK_PREFIX = CHATGPT_SESSION_COOKIE + ".";
export const CHATGPT_SUPPORTING_COOKIE_NAMES = [
  "__Host-next-auth.csrf-token",
  "__Secure-next-auth.callback-url",
  "__Secure-oai-is",
  "_account",
  "_puid",
  "_uasid",
  "_umsid",
  "oai-did",
  "oai-sc",
  "oai_client_auth_info",
  "oai-client-auth-info",
  "oai-client-session-epoch",
  "oai-hlib",
  "__oailb",
];

function isChatGptSessionDomain(raw) {
  const host = String(raw || "").trim().toLowerCase().replace(/^\./, "");
  return host === "chatgpt.com" || host.endsWith(".chatgpt.com");
}

function isAllowedAuthCookieName(name) {
  return (
    name === CHATGPT_SESSION_COOKIE ||
    /^__Secure-next-auth\.session-token\.\d+$/.test(name) ||
    CHATGPT_SUPPORTING_COOKIE_NAMES.includes(name)
  );
}

function validateSessionTokenStructure(cookies) {
  const byName = new Map(cookies.map(cookie => [cookie.name, cookie]));
  const unchunked = byName.get(CHATGPT_SESSION_COOKIE);
  const chunks = cookies
    .map(cookie => {
      const match = cookie.name.match(/^__Secure-next-auth\.session-token\.(\d+)$/);
      return match ? { index: Number(match[1]), cookie } : null;
    })
    .filter(Boolean)
    .sort((a,b) => a.index-b.index);

  if (unchunked && chunks.length) fail("chatgpt_session_token_ambiguous");

  if (!unchunked && !chunks.length) fail("chatgpt_session_token_missing");

  if (chunks.length) {
    if (chunks.length < 2 || chunks[0].index !== 0) {
      fail("chatgpt_session_token_incomplete");
    }
    for (let index=0; index<chunks.length; index++) {
      if (chunks[index].index !== index) {
        fail("chatgpt_session_token_incomplete");
      }
    }
  }
}

export function normalisePhase5Session(raw) {
  let parsed;
  try { parsed = typeof raw === "string" ? JSON.parse(raw) : raw; }
  catch { fail("chatgpt_session_invalid"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    fail("chatgpt_session_invalid");
  }

  const input = parsed.cookies ?? parsed.authenticated_cookies;
  if (!Array.isArray(input) || input.length < 1 || input.length > 48) {
    fail("chatgpt_session_invalid");
  }

  const kept = [];
  const names = new Set();

  for (const item of input) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;

    const name = typeof item.name === "string" ? item.name.trim() : "";
    if (!isAllowedAuthCookieName(name)) continue;

    const value = typeof item.value === "string" ? item.value : "";
    const domain = typeof item.domain === "string" ? item.domain.trim() : "";
    const path = typeof item.path === "string" && item.path.startsWith("/") ? item.path : "/";

    if (!value || value.length > 128000 || /[\r\n;]/.test(value)) {
      fail("chatgpt_session_invalid");
    }
    if (!isChatGptSessionDomain(domain) || path !== "/") {
      fail("chatgpt_session_cookie_scope_invalid");
    }
    if (names.has(name)) fail("chatgpt_session_invalid");
    names.add(name);

    const cookie = { name, value, domain, path };
    if (typeof item.expires === "number" && Number.isFinite(item.expires)) {
      cookie.expires = item.expires;
    }
    kept.push(cookie);
  }

  validateSessionTokenStructure(kept);

  const sessionCookies = kept
    .filter(cookie =>
      cookie.name === CHATGPT_SESSION_COOKIE ||
      cookie.name.startsWith(CHATGPT_SESSION_CHUNK_PREFIX)
    )
    .sort((a,b) => {
      if (a.name === CHATGPT_SESSION_COOKIE) return -1;
      if (b.name === CHATGPT_SESSION_COOKIE) return 1;
      return Number(a.name.slice(CHATGPT_SESSION_CHUNK_PREFIX.length)) -
        Number(b.name.slice(CHATGPT_SESSION_CHUNK_PREFIX.length));
    });

  const supportingCookies = CHATGPT_SUPPORTING_COOKIE_NAMES.flatMap(name => {
    const cookie = kept.find(candidate => candidate.name === name);
    return cookie ? [cookie] : [];
  });

  return JSON.stringify({ version: 3, cookies: [...sessionCookies, ...supportingCookies] });
}

function keyFromEnvironment() {
  const raw = String(process.env.CHATGPT_SESSION_ENCRYPTION_KEY || "").trim();
  if (raw) {
    const key = /^[0-9a-f]{64}$/i.test(raw)
      ? Buffer.from(raw, "hex")
      : Buffer.from(raw, "base64");
    if (key.length !== 32) fail("chatgpt_session_invalid");
    return key;
  }

  const service = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!service) fail("missing_chatgpt_session_source");
  return Buffer.from(hkdfSync(
    "sha256",
    Buffer.from(service, "utf8"),
    Buffer.from("topratedseotools", "utf8"),
    Buffer.from("chatgpt-session-encryption:v1", "utf8"),
    32,
  ));
}

function decryptWithAad(value, key, aad) {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(value.iv, "base64"),
  );
  decipher.setAAD(aad);
  decipher.setAuthTag(Buffer.from(value.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(value.ct, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function decryptPhase5Envelope(envelope) {
  let value;
  try { value = JSON.parse(envelope); } catch { fail("chatgpt_session_invalid"); }
  if (
    !value || value.v !== 1 || value.alg !== "A256GCM" ||
    typeof value.iv !== "string" ||
    typeof value.tag !== "string" ||
    typeof value.ct !== "string"
  ) fail("chatgpt_session_invalid");

  const key = keyFromEnvironment();
  for (const aad of [AAD_V3, LEGACY_AAD]) {
    try { return decryptWithAad(value, key, aad); }
    catch { /* try legacy/new alternate */ }
  }
  fail("chatgpt_session_invalid");
}

export function encryptPhase5State(plaintext) {
  const normalised = normalisePhase5Session(plaintext);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFromEnvironment(), iv);
  cipher.setAAD(AAD_V3);
  const ct = Buffer.concat([
    cipher.update(normalised, "utf8"),
    cipher.final(),
  ]);
  return JSON.stringify({
    v: 1,
    alg: "A256GCM",
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    ct: ct.toString("base64"),
  });
}

async function supabase(endpoint, options = {}) {
  const base = String(process.env.SUPABASE_URL || "").trim();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!base || !key) fail("missing_chatgpt_session_source");

  let response;
  try {
    response = await fetch(base + endpoint, {
      method: options.method || "GET",
      headers: {
        apikey: key,
        Authorization: "Bearer " + key,
        "Content-Type": "application/json",
        Prefer: "return=representation",
        ...(options.headers || {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    fail("missing_chatgpt_session_source");
  }
  if (!response.ok) fail("missing_chatgpt_session_source");
  if (response.status === 204) return null;
  return response.json();
}

async function verifySingleAccount(assignedAccountId) {
  const rows = await supabase(
    "/rest/v1/tool_accounts?" +
    new URLSearchParams({
      select: "id,tool_slug,enabled,status,expires_at",
      tool_slug: "eq.chatgpt",
      enabled: "eq.true",
      status: "eq.working",
      limit: "2",
    }),
  );
  if (!Array.isArray(rows) || rows.length !== 1) fail("chatgpt_account_mismatch");
  const account = rows[0];
  if (String(account.id) !== String(assignedAccountId)) fail("chatgpt_account_mismatch");
  if (account.expires_at && Date.parse(account.expires_at) <= Date.now()) {
    fail("chatgpt_account_mismatch");
  }
  return account;
}

async function loadVaultRow() {
  const rows = await supabase(
    "/rest/v1/tool_authorized_sessions?" +
    new URLSearchParams({
      select: "tool_slug,encrypted_payload,session_format,status,updated_at",
      tool_slug: "eq.chatgpt",
      limit: "1",
    }),
  );
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row || row.status !== "stored" || !row.encrypted_payload) {
    fail("missing_chatgpt_session_source");
  }
  return row;
}

async function persistMigratedState(normalised, row) {
  const now = new Date().toISOString();
  const payload = encryptPhase5State(normalised);
  await supabase(
    "/rest/v1/tool_authorized_sessions?tool_slug=eq.chatgpt",
    {
      method: "PATCH",
      body: {
        encrypted_payload: payload,
        session_format: CHATGPT_SESSION_FORMAT,
        updated_at: now,
        rotated_at: now,
      },
    },
  );
  return { ...row, encrypted_payload: payload, session_format: CHATGPT_SESSION_FORMAT };
}

export async function loadSingleAccountSession(assignedAccountId) {
  await verifySingleAccount(assignedAccountId);
  let row = await loadVaultRow();
  const plaintext = decryptPhase5Envelope(row.encrypted_payload);
  const normalised = normalisePhase5Session(plaintext);

  if (row.session_format !== CHATGPT_SESSION_FORMAT || plaintext !== normalised) {
    row = await persistMigratedState(normalised, row);
  }
  return {
    row,
    state: JSON.parse(normalised),
  };
}

function domainMatches(cookieDomain, host) {
  const domain = cookieDomain.toLowerCase().replace(/^\./, "");
  const h = host.toLowerCase();
  return h === domain || (cookieDomain.startsWith(".") && h.endsWith("." + domain));
}

export function buildPhase5CookieHeader(state, targetUrl) {
  const target = new URL(targetUrl);
  const now = Date.now();
  return state.cookies
    .filter(cookie => {
      if (!domainMatches(cookie.domain, target.hostname)) return false;
      if (
        typeof cookie.expires === "number" &&
        Number.isFinite(cookie.expires) &&
        cookie.expires > 0 &&
        cookie.expires * 1000 <= now
      ) return false;
      const path = cookie.path || "/";
      return target.pathname === path ||
        target.pathname.startsWith(path.endsWith("/") ? path : path + "/");
    })
    .map(cookie => cookie.name + "=" + cookie.value)
    .join("; ");
}

export function extractPhase5Rotations(setCookies, existingNames) {
  const allowed = new Set(existingNames);
  const updates = {};
  for (const raw of setCookies) {
    const first = String(raw || "").split(";", 1)[0] || "";
    const i = first.indexOf("=");
    if (i <= 0) continue;
    const name = first.slice(0, i).trim();
    const value = first.slice(i + 1);
    if (allowed.has(name) && value && !/[\r\n;]/.test(value)) {
      updates[name] = value;
    }
  }
  return updates;
}

export function applyPhase5Rotations(state, setCookies) {
  const updates = extractPhase5Rotations(
    setCookies,
    state.cookies.map(cookie => cookie.name),
  );
  let changed = false;
  const next = {
    version: 3,
    cookies: state.cookies.map(cookie => {
      const value = updates[cookie.name];
      if (!value || value === cookie.value) return cookie;
      changed = true;
      return { ...cookie, value };
    }),
  };
  return { changed, state: next, plaintext: JSON.stringify(next) };
}

async function persistRotations(row, state, upstream) {
  const getSetCookie = upstream.headers.getSetCookie?.bind(upstream.headers);
  const setCookies = typeof getSetCookie === "function"
    ? getSetCookie()
    : upstream.headers.get("set-cookie")
      ? [upstream.headers.get("set-cookie")]
      : [];
  if (!setCookies.length) return;

  const rotated = applyPhase5Rotations(state, setCookies);
  if (!rotated.changed) return;

  const now = new Date().toISOString();
  await supabase(
    "/rest/v1/tool_authorized_sessions?tool_slug=eq.chatgpt&status=eq.stored",
    {
      method: "PATCH",
      body: {
        encrypted_payload: encryptPhase5State(rotated.plaintext),
        session_format: CHATGPT_SESSION_FORMAT,
        updated_at: now,
        rotated_at: now,
      },
    },
  );
}

function safeRedirect(location, baseOrigin) {
  try { return rewriteLocation(location, baseOrigin); }
  catch (error) {
    if (error instanceof Phase4PolicyError) fail("upstream_external_redirect");
    throw error;
  }
}

export async function proxyWithSingleChatGptSession(request, route, gatewaySession) {
  const assignedAccountId = gatewaySession?.entitlement?.account;
  if (!assignedAccountId) fail("chatgpt_account_mismatch");

  const { row, state } = await loadSingleAccountSession(assignedAccountId);
  const cookieHeader = route.secondaryHost
    ? ""
    : buildPhase5CookieHeader(state, route.target.toString());

  if (!route.secondaryHost) {
    console.info(JSON.stringify({
      component: "chatgpt_phase5_auth_meta",
      session_format: row.session_format,
      cookie_names: state.cookies.map(cookie => cookie.name),
      target_host: route.target.hostname,
      target_path: route.target.pathname,
    }));
  }

  if (!route.secondaryHost && !cookieHeader) fail("chatgpt_session_expired");

  const headers = sanitizeUpstreamHeaders(request, route.targetOrigin);
  if (cookieHeader) headers.set("cookie", cookieHeader);

  let body;
  if (!["GET", "HEAD"].includes(request.method)) {
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength > MAX_REQUEST_BYTES) fail("request_too_large", 413);
    body = bytes;
  }

  let upstream;
  try {
    upstream = await fetch(route.target, {
      method: request.method,
      headers,
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(120_000),
    });
  } catch {
    fail("upstream_network_error");
  }

  if (!route.secondaryHost) {
    console.info(JSON.stringify({
      component: "chatgpt_phase5_upstream_meta",
      status: upstream.status,
      target_host: route.target.hostname,
      target_path: route.target.pathname,
      content_type: upstream.headers.get("content-type") || null,
    }));
    await persistRotations(row, state, upstream);
    if (upstream.status === 401) fail("upstream_auth_rejected");
    if (upstream.status === 403) {
      const mitigated = String(upstream.headers.get("cf-mitigated") || "").toLowerCase();
      fail(mitigated === "challenge" ? "upstream_edge_challenge" : "upstream_auth_rejected");
    }
  }

  if (upstream.status >= 300 && upstream.status < 400) {
    const location = upstream.headers.get("location") || "/";
    const rewritten = safeRedirect(location, route.targetOrigin);
    const h = sanitizeUpstreamResponseHeaders(upstream.headers);
    h.set("location", rewritten);
    return new Response(null, { status: upstream.status, headers: h });
  }

  const responseHeaders = sanitizeUpstreamResponseHeaders(upstream.headers);
  if (request.method === "HEAD") {
    return new Response(null, { status: upstream.status, headers: responseHeaders });
  }

  const contentType = upstream.headers.get("content-type") || "application/octet-stream";
  const mode = bodyMode(contentType);
  if (mode === "rewrite") {
    const text = await upstream.text();
    return new Response(rewriteTextBody(text, contentType), {
      status: upstream.status,
      headers: responseHeaders,
    });
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}
