/*
 * Grammarly one-click proxy (dedicated host, e.g. grammarly.topratedseotools.com).
 *
 * Writers launch from their dashboard, exchange a 60-second ticket for an
 * HttpOnly proxy cookie, and use the Grammarly editor through this host. The
 * shared Grammarly login never leaves the server: every upstream request gets
 * the vault cookies and CSRF token added here. The live checking WebSocket is
 * relayed by scripts/grammarly-ws-relay.mjs (nginx routes /__ws/ to it).
 *
 * Shared-account protections:
 *   - account, billing, logout, password and admin surfaces are blocked;
 *   - each writer only sees and opens the documents they created.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash, randomBytes } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  decryptGrammarlySession,
  encryptGrammarlySession,
  normaliseGrammarlySession,
  type GrammarlySessionState,
} from "@/lib/grammarly-session.server";

export const GRAMMARLY_APP_ORIGIN = "https://app.grammarly.com";
export const GRAMMARLY_PROXY_COOKIE = "trst_gr_proxy";
const TOOL_SLUG = "grammarly";
const HANDOFF_TTL_SECONDS = 60;
const SESSION_HOURS = 12;
const MAX_REQUEST_BYTES = 25 * 1024 * 1024;
const CACHE_MS = 30_000;

// ------------------------------------------------------------------ origins

export function grammarlyProxyPublicOrigin() {
  const raw = String(process.env.GRAMMARLY_PROXY_PUBLIC_ORIGIN ?? "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function isDedicatedGrammarlyProxyRequest(request: Request) {
  const origin = grammarlyProxyPublicOrigin();
  return !!origin && new URL(request.url).origin === origin;
}

// -------------------------------------------------------------- host rules

/** Grammarly hosts that writers must never reach through the proxy. */
const BLOCKED_HOSTS = new Set([
  "account.grammarly.com",
  "api.payments.grammarly.com",
  "sso.grammarly.com",
  "redirect.grammarly.com",
  "support.grammarly.com",
  "download-windows.grammarly.com",
  "download-mac.grammarly.com",
  "g-mail.grammarly.com",
  "coda.grammarly.com",
]);

export function isGrammarlyHost(host: string) {
  const h = host.toLowerCase();
  return (
    /^[a-z0-9.-]+$/.test(h) &&
    (h === "grammarly.com" || h.endsWith(".grammarly.com") || h.endsWith(".grammarly.io"))
  );
}

export function isBlockedGrammarlyHost(host: string) {
  return BLOCKED_HOSTS.has(host.toLowerCase());
}

const ALWAYS_BLOCKED_PATH = /(?:^|\/)(?:logout|log_out|log-out|signout|sign_out|sign-out|logout_all)(?:\/|$|\?)/i;

/**
 * Requests that would change or end the shared account for everyone.
 * Reading is allowed; changing account, billing, security or team settings is not.
 */
export function isBlockedGrammarlyRequest(method: string, host: string, pathname: string) {
  const h = host.toLowerCase();
  const m = method.toUpperCase();
  if (isBlockedGrammarlyHost(h)) return true;
  if (ALWAYS_BLOCKED_PATH.test(pathname)) return true;
  const write = !["GET", "HEAD", "OPTIONS"].includes(m);
  if (!write) return false;
  if (h === "auth.grammarly.com") {
    // Token refresh / session checks are fine; anything else (password,
    // email, delete account, profile) is refused.
    return !/(?:^|\/)(?:tokens?|oranonymous|refresh|csrf|grauth)(?:\/|$)/i.test(pathname);
  }
  if (h === "subscription.grammarly.com" || h === "irbis.grammarly.com") return true;
  if (h === "gateway.grammarly.com") {
    return /^\/(?:institution|passport|auth|client-controls|analytics\/api\/institution|cheetah\/v1\/institution|vox\/v2\/institution|knowledge-hub\/v1\/institution)/i.test(pathname);
  }
  if (h === "www.grammarly.com") return true;
  return false;
}

// ------------------------------------------------------------- URL mapping

/** Absolute upstream URL → URL on the proxy host (or null if not Grammarly). */
export function toProxyUrl(absolute: string, publicOrigin: string): string | null {
  let u: URL;
  try {
    u = new URL(absolute);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  if (!isGrammarlyHost(host)) return null;
  const rest = u.pathname + u.search + u.hash;
  if (u.protocol === "wss:" || u.protocol === "ws:") {
    return publicOrigin.replace(/^https:/, "wss:") + "/__ws/" + host + rest;
  }
  if (host === "app.grammarly.com") return publicOrigin + rest;
  return publicOrigin + "/__host/" + host + rest;
}

/** Proxy request path → upstream target. */
export function upstreamTarget(requestUrl: string): { url: URL; host: string } | null {
  const req = new URL(requestUrl);
  const m = req.pathname.match(/^\/__host\/([^/]+)(\/.*)?$/);
  if (m) {
    const host = m[1].toLowerCase();
    if (!isGrammarlyHost(host)) return null;
    const url = new URL(`https://${host}${m[2] || "/"}${req.search}`);
    return { url, host };
  }
  return { url: new URL(`${GRAMMARLY_APP_ORIGIN}${req.pathname}${req.search}`), host: "app.grammarly.com" };
}

const HOST_RE = "([a-z0-9-]+(?:\\.[a-z0-9-]+)*\\.grammarly\\.(?:com|io))";

/** Point every absolute Grammarly URL in a text body at the proxy host. */
export function rewriteGrammarlyBody(text: string, publicOrigin: string, debug = false) {
  const wsOrigin = publicOrigin.replace(/^https:/, "wss:");
  const proxyHost = new URL(publicOrigin).hostname;
  const esc = (s: string) => s.replaceAll("/", "\\/");
  const httpTarget = (host: string) =>
    host.toLowerCase() === "app.grammarly.com" ? publicOrigin : `${publicOrigin}/__host/${host.toLowerCase()}`;
  return text
    .replace(new RegExp(`https://${HOST_RE}`, "gi"), (_, host) => httpTarget(host))
    .replace(new RegExp(`https:\\\\/\\\\/${HOST_RE}`, "gi"), (_, host) => esc(httpTarget(host)))
    .replace(new RegExp(`wss://${HOST_RE}`, "gi"), (_, host) => `${wsOrigin}/__ws/${host.toLowerCase()}`)
    .replace(new RegExp(`wss:\\\\/\\\\/${HOST_RE}`, "gi"), (_, host) => esc(`${wsOrigin}/__ws/${host.toLowerCase()}`))
    .replace(new RegExp(`(["'(=\\s])//${HOST_RE}`, "gi"), (_, pre, host) => `${pre}${httpTarget(host)}`)
    // The editor writes its cookies for ".grammarly.com"; on the proxy host the
    // browser would refuse them and the editor never finishes starting.
    // Keep the leading dot required by Grammarly's cookie-domain validator.
    .replace(/("cookie"\s*:\s*")\.grammarly\.com(")/g, `$1.${proxyHost}$2`)
    .replace(/(\\"cookie\\"\s*:\s*\\")\.grammarly\.com(\\")/g, `$1.${proxyHost}$2`)
    // Debug switch (cookie trst_debug=1): copy the editor's own log to the console.
    .replace(/"copyLogsToConsole"\s*:\s*false/g, debug ? '"copyLogsToConsole":true' : '"copyLogsToConsole":false');
}

/**
 * Runs before Grammarly's own scripts: maps URLs the editor builds at runtime
 * (fetch, XHR, WebSocket, EventSource, beacons) onto the proxy host, and gives
 * the editor a readable CSRF cookie (the real token is added server-side).
 */
export function grammarlyBootstrapScript(debug = false) {
  return `<script>(function(){try{${debug ? GRAMMARLY_DEBUG_CAPTURE : ""}
var O=location.origin,W=O.replace(/^https:/,"wss:");
var R=/^(https?|wss?):\\/\\/([a-z0-9-]+(?:\\.[a-z0-9-]+)*\\.grammarly\\.(?:com|io))(\\/[^]*)?$/i;
function map(u){try{var s=String(u instanceof URL?u.href:u);var m=s.match(R);if(!m)return u;var h=m[2].toLowerCase(),r=m[3]||"/";
if(/^wss?$/i.test(m[1]))return W+"/__ws/"+h+r;if(h==="app.grammarly.com")return O+r;return O+"/__host/"+h+r;}catch(e){return u}}
var F=window.fetch;window.fetch=function(i,n){if(typeof i==="string"||i instanceof URL)return F.call(this,map(i),n);if(i&&i.url){var t=map(i.url);if(t!==i.url)i=new Request(t,i)}return F.call(this,i,n)};
var X=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){arguments[1]=map(u);return X.apply(this,arguments)};
var S=window.WebSocket;function WS(u,p){return p===undefined?new S(map(u)):new S(map(u),p)}WS.prototype=S.prototype;["CONNECTING","OPEN","CLOSING","CLOSED"].forEach(function(k){WS[k]=S[k]});window.WebSocket=WS;
if(window.EventSource){var E=window.EventSource;window.EventSource=function(u,c){return new E(map(u),c)};window.EventSource.prototype=E.prototype}
if(navigator.sendBeacon){var B=navigator.sendBeacon.bind(navigator);navigator.sendBeacon=function(u,d){return B(map(u),d)}}
var WO=window.open;window.open=function(u){if(u){var t=map(u);if(t===u&&/^https?:/i.test(String(u))&&!String(u).startsWith(O))return null;arguments[0]=t}return WO.apply(this,arguments)};
var CD=Object.getOwnPropertyDescriptor(Document.prototype,"cookie");if(CD&&CD.set){Object.defineProperty(document,"cookie",{configurable:true,get:function(){return CD.get.call(document)},set:function(v){CD.set.call(document,String(v).replace(/;\\s*domain=[^;]*/ig,""))}})}
if(document.cookie.indexOf("csrf-token=")<0)document.cookie="csrf-token=trst-proxy; path=/; secure; samesite=lax";
}catch(e){}})();</script>`;
}

/** Troubleshooting only (cookie trst_debug=1): surface editor errors and log uploads in the console. */
const GRAMMARLY_DEBUG_CAPTURE = `
window.addEventListener("error",function(e){console.warn("[trst] error",e.message,e.filename,e.lineno,e.error&&e.error.stack&&String(e.error.stack).slice(0,600))});
window.addEventListener("unhandledrejection",function(e){var r=e.reason;console.warn("[trst] rejection",r&&(r.message||String(r)).slice(0,300),r&&r.stack&&String(r.stack).slice(0,600))});
(function(){
function show(tag,u,b){try{
var out=function(t){console.warn("[trst] "+tag,String(u).slice(0,80),String(t).slice(0,6000))};
if(b==null)return;if(typeof b==="string")return out(b);
var toBuf=b instanceof Blob?b.arrayBuffer():Promise.resolve(b instanceof ArrayBuffer?b:(b.buffer?b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength):null));
toBuf.then(function(buf){if(!buf)return;var u8=new Uint8Array(buf);
if(u8[0]===31&&u8[1]===139&&window.DecompressionStream){return new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream("gzip"))).text().then(out)}
out(new TextDecoder().decode(u8))}).catch(function(){})}catch(x){}}
var F0=window.fetch;window.fetch=function(i,n){try{var u=String(typeof i==="string"?i:i&&i.url);if(/f-log|logv2|crash/.test(u))show("log-upload",u,n&&n.body)}catch(x){}var pending=F0.apply(this,arguments);try{var label=new URL(String(typeof i==="string"?i:i&&i.url),location.href).pathname;console.warn("[trst] request",label);pending.then(function(r){console.warn("[trst] response",label,r.status)},function(e){console.warn("[trst] fetch-failed",label,String(e).slice(0,120))})}catch(x){}return pending};
var XO0=XMLHttpRequest.prototype.open,XS0=XMLHttpRequest.prototype.send;XMLHttpRequest.prototype.open=function(m,u){this.__trstU=String(u);return XO0.apply(this,arguments)};XMLHttpRequest.prototype.send=function(b){try{if(/f-log|logv2|crash/.test(this.__trstU||""))show("log-upload",this.__trstU,b)}catch(x){}return XS0.apply(this,arguments)};
if(navigator.sendBeacon){var SB0=navigator.sendBeacon.bind(navigator);navigator.sendBeacon=function(u,d){try{if(/f-log|logv2|crash/.test(String(u)))show("beacon",u,d)}catch(x){}return SB0(u,d)}}
})();
`;

// --------------------------------------------------------------- the vault

let vaultCache: { value: string; until: number } | null = null;

async function loadEncryptedSession() {
  if (vaultCache && vaultCache.until > Date.now()) return vaultCache.value;
  const { data, error } = await (supabaseAdmin as any)
    .from("tool_authorized_sessions")
    .select("encrypted_payload, status")
    .eq("tool_slug", TOOL_SLUG)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.encrypted_payload || data.status !== "stored") {
    throw new Error("Grammarly needs to be refreshed by Admin before writers can launch it.");
  }
  vaultCache = { value: String(data.encrypted_payload), until: Date.now() + CACHE_MS };
  return vaultCache.value;
}

function vaultState(): Promise<GrammarlySessionState> {
  return loadEncryptedSession().then((enc) => JSON.parse(decryptGrammarlySession(enc)));
}

export function grammarlyCookieHeader(state: GrammarlySessionState, host: string) {
  const h = host.toLowerCase();
  return state.cookies
    .filter((c) => {
      const d = c.domain.toLowerCase().replace(/^\./, "");
      return h === d || h.endsWith("." + d);
    })
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}

/** Keep the vault in step when Grammarly rotates its auth cookies. */
async function persistRotatedCookies(setCookies: string[]) {
  if (!setCookies.length) return;
  const state = await vaultState();
  const names = new Set(state.cookies.map((c) => c.name));
  let changed = false;
  for (const raw of setCookies) {
    const first = raw.split(";", 1)[0] ?? "";
    const eq = first.indexOf("=");
    if (eq <= 0) continue;
    const name = first.slice(0, eq).trim();
    const value = first.slice(eq + 1);
    if (!names.has(name) || !value || /max-age=0|expires=thu, 01 jan 1970/i.test(raw)) continue;
    const cookie = state.cookies.find((c) => c.name === name)!;
    if (cookie.value !== value) {
      cookie.value = value;
      changed = true;
    }
  }
  if (!changed) return;
  const encrypted = encryptGrammarlySession(normaliseGrammarlySession(JSON.stringify(state)));
  vaultCache = { value: encrypted, until: Date.now() + CACHE_MS };
  const now = new Date().toISOString();
  await (supabaseAdmin as any)
    .from("tool_authorized_sessions")
    .update({ encrypted_payload: encrypted, updated_at: now })
    .eq("tool_slug", TOOL_SLUG)
    .eq("status", "stored");
}

// --------------------------------------------------------------- access

const unexpired = (v: string | null | undefined) => !v || new Date(v).getTime() > Date.now();

function isActiveOrder(o: any) {
  return (
    o.status === "approved" &&
    String(o.payment_status ?? "") === "successful" &&
    unexpired(o.expires_at) &&
    (String(o.access_type ?? "shared") !== "private" || String(o.fulfilment_status ?? "") === "active")
  );
}

type Source = { kind: "order" | "grant"; id: string };

async function findActiveAccess(userId: string): Promise<Source | null> {
  const { data: orders } = await (supabaseAdmin as any)
    .from("tool_orders")
    .select("id, expires_at, access_type, fulfilment_status, payment_status, status")
    .eq("user_id", userId)
    .eq("tool_slug", TOOL_SLUG)
    .eq("status", "approved")
    .order("created_at", { ascending: false })
    .limit(20);
  const order = ((orders ?? []) as any[]).find(isActiveOrder);
  if (order) return { kind: "order", id: String(order.id) };
  const { data: grants } = await (supabaseAdmin as any)
    .from("tool_access_grants")
    .select("id, expires_at, status")
    .eq("user_id", userId)
    .eq("tool_slug", TOOL_SLUG)
    .eq("status", "active")
    .order("granted_at", { ascending: false })
    .limit(20);
  const grant = ((grants ?? []) as any[]).find((g) => unexpired(g.expires_at));
  return grant ? { kind: "grant", id: String(grant.id) } : null;
}

async function sourceStillActive(userId: string, source: Source) {
  if (source.kind === "order") {
    const { data } = await (supabaseAdmin as any)
      .from("tool_orders")
      .select("expires_at, access_type, fulfilment_status, payment_status, status")
      .eq("id", source.id)
      .eq("user_id", userId)
      .maybeSingle();
    return !!(data && isActiveOrder(data));
  }
  const { data } = await (supabaseAdmin as any)
    .from("tool_access_grants")
    .select("expires_at, status")
    .eq("id", source.id)
    .eq("user_id", userId)
    .maybeSingle();
  return !!(data && data.status === "active" && unexpired(data.expires_at));
}

async function requireToolEnabled() {
  const { data } = await (supabaseAdmin as any)
    .from("tool_settings")
    .select("enabled, one_click_auth_enabled")
    .eq("tool_slug", TOOL_SLUG)
    .maybeSingle();
  if (!data || data.enabled === false || !data.one_click_auth_enabled) {
    throw new Error("Grammarly One-Click Login is not enabled yet.");
  }
}

export const hashGrammarlyProxyToken = (token: string) =>
  createHash("sha256").update(token, "utf8").digest("hex");

export async function createGrammarlyProxyLaunch(userId: string) {
  const origin = grammarlyProxyPublicOrigin();
  if (!origin) throw new Error("Grammarly is not configured on this server yet.");
  await requireToolEnabled();
  const source = await findActiveAccess(userId);
  if (!source) throw new Error("An active Grammarly subscription or grant is required for One-Click Login.");
  await loadEncryptedSession();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + HANDOFF_TTL_SECONDS * 1000).toISOString();
  const { error } = await (supabaseAdmin as any).from("grammarly_proxy_sessions").insert({
    token_hash: hashGrammarlyProxyToken(token),
    user_id: userId,
    source_kind: source.kind,
    source_id: source.id,
    status: "issued",
    expires_at: expiresAt,
  });
  if (error) throw new Error("Could not start Grammarly. Please try again.");
  await (supabaseAdmin as any).from("tool_usage").insert({ tool_slug: TOOL_SLUG, user_id: userId });
  return {
    launchUrl: `${origin}/__trst/enter?ticket=${encodeURIComponent(token)}`,
    proxyPublicOrigin: origin,
    handoffExpiresAt: expiresAt,
  };
}

function parseCookies(request: Request) {
  const out = new Map<string, string>();
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out.set(part.slice(0, i).trim(), part.slice(i + 1).trim());
  }
  return out;
}

const sessionCache = new Map<string, { row: any; until: number }>();

async function requireProxySession(request: Request) {
  const token = parseCookies(request).get(GRAMMARLY_PROXY_COOKIE);
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const hash = hashGrammarlyProxyToken(token);
  const cached = sessionCache.get(hash);
  if (cached && cached.until > Date.now() && new Date(cached.row.expires_at).getTime() > Date.now()) {
    return cached.row;
  }
  sessionCache.delete(hash);
  const { data: row } = await (supabaseAdmin as any)
    .from("grammarly_proxy_sessions")
    .select("id, user_id, source_kind, source_id, status, expires_at")
    .eq("token_hash", hash)
    .eq("status", "active")
    .maybeSingle();
  if (!row || new Date(String(row.expires_at)).getTime() <= Date.now()) return null;
  const ok = await sourceStillActive(String(row.user_id), { kind: row.source_kind, id: String(row.source_id) });
  if (!ok) {
    await (supabaseAdmin as any).from("grammarly_proxy_sessions").update({ status: "revoked" }).eq("id", row.id);
    return null;
  }
  await (supabaseAdmin as any)
    .from("grammarly_proxy_sessions")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", row.id);
  if (sessionCache.size > 5000) sessionCache.clear();
  sessionCache.set(hash, { row, until: Date.now() + CACHE_MS });
  return row;
}

async function exchangeTicket(ticket: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(ticket)) return plain(403, "This Grammarly link is invalid. Launch again from your account.");
  const hash = hashGrammarlyProxyToken(ticket);
  const { data: row } = await (supabaseAdmin as any)
    .from("grammarly_proxy_sessions")
    .select("id, status, expires_at")
    .eq("token_hash", hash)
    .maybeSingle();
  if (!row || row.status !== "issued" || new Date(row.expires_at).getTime() <= Date.now()) {
    return plain(403, "This Grammarly link has expired. Launch again from your account.");
  }
  const sessionToken = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 3600_000).toISOString();
  const { error } = await (supabaseAdmin as any)
    .from("grammarly_proxy_sessions")
    .update({
      token_hash: hashGrammarlyProxyToken(sessionToken),
      status: "active",
      activated_at: new Date().toISOString(),
      expires_at: expiresAt,
    })
    .eq("id", row.id)
    .eq("status", "issued");
  if (error) return plain(503, "Grammarly is temporarily unavailable. Please try again.");
  const h = new Headers({ Location: "/ddocs", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
  h.append(
    "Set-Cookie",
    `${GRAMMARLY_PROXY_COOKIE}=${sessionToken}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${SESSION_HOURS * 3600}`,
  );
  h.append("Set-Cookie", "csrf-token=trst-proxy; Path=/; Secure; SameSite=Lax");
  return new Response(null, { status: 302, headers: h });
}

// ------------------------------------------------------- document isolation

const ownerCache = new Map<string, string>();
const userDocsCache = new Map<string, { ids: Set<string>; until: number }>();

export async function grammarlyDocumentOwner(documentId: string) {
  const hit = ownerCache.get(documentId);
  if (hit) return hit;
  const { data } = await (supabaseAdmin as any)
    .from("grammarly_document_owners")
    .select("user_id")
    .eq("document_id", documentId)
    .maybeSingle();
  if (data?.user_id) ownerCache.set(documentId, String(data.user_id));
  return data?.user_id ? String(data.user_id) : null;
}

async function ownedDocumentIds(userId: string) {
  const cached = userDocsCache.get(userId);
  if (cached && cached.until > Date.now()) return cached.ids;
  const { data } = await (supabaseAdmin as any)
    .from("grammarly_document_owners")
    .select("document_id")
    .eq("user_id", userId)
    .limit(5000);
  const ids = new Set<string>(((data ?? []) as any[]).map((r) => String(r.document_id)));
  userDocsCache.set(userId, { ids, until: Date.now() + CACHE_MS });
  return ids;
}

async function claimDocument(documentId: string, userId: string) {
  if (ownerCache.has(documentId)) return;
  ownerCache.set(documentId, userId);
  userDocsCache.get(userId)?.ids.add(documentId);
  await (supabaseAdmin as any)
    .from("grammarly_document_owners")
    .upsert({ document_id: documentId, user_id: userId }, { onConflict: "document_id", ignoreDuplicates: true });
}

/** Document id addressed by a dox API path or an editor page URL. */
export function grammarlyDocumentIdFromPath(host: string, pathname: string) {
  const h = host.toLowerCase();
  if (h === "dox.grammarly.com") {
    const m = pathname.match(/^\/documents\/(\d+)(?:\/|$)/);
    return m ? m[1] : null;
  }
  if (h === "app.grammarly.com") {
    const m = pathname.match(/^\/(?:ddocs|docs)\/(\d+)(?:\/|$)/);
    return m ? m[1] : null;
  }
  return null;
}

const isDocLike = (v: any) =>
  v && typeof v === "object" && !Array.isArray(v) &&
  (typeof v.id === "number" || /^\d+$/.test(String(v.id ?? ""))) &&
  ("user_id" in v || "first_content" in v || "title" in v);

/** Keep only the writer's own documents in any document list payload. */
export function filterGrammarlyDocuments(payload: any, owned: { has(id: string): boolean }, depth = 0): any {
  if (depth > 6 || payload === null || typeof payload !== "object") return payload;
  if (Array.isArray(payload)) {
    return payload
      .filter((d) => !isDocLike(d) || owned.has(String(d.id)))
      .map((d) => filterGrammarlyDocuments(d, owned, depth + 1));
  }
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(payload)) out[k] = filterGrammarlyDocuments(v, owned, depth + 1);
  return out;
}

// ---------------------------------------------------------------- helpers

function plain(status: number, message: string) {
  return new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function json(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

const DROP_REQUEST_HEADERS = new Set([
  "host", "cookie", "origin", "referer", "connection", "content-length", "accept-encoding",
  "x-forwarded-for", "x-forwarded-proto", "x-forwarded-host", "x-real-ip", "forwarded",
  "te", "upgrade", "keep-alive", "proxy-authorization", "transfer-encoding",
]);

const DROP_RESPONSE_HEADERS = new Set([
  "set-cookie", "content-length", "content-encoding", "transfer-encoding", "connection",
  "content-security-policy", "content-security-policy-report-only", "strict-transport-security",
  "x-frame-options", "alt-svc", "report-to", "nel", "access-control-allow-origin",
  "access-control-allow-credentials", "access-control-allow-headers", "access-control-allow-methods",
  "access-control-expose-headers", "cross-origin-opener-policy", "cross-origin-embedder-policy",
  "cross-origin-resource-policy",
]);

const STATIC_HOSTS = new Set(["denali-static.grammarly.com", "static-web.grammarly.com", "assets.grammarly.com", "static.institution.grammarly.com"]);
const assetCache = new Map<string, { body: string | ArrayBuffer; type: string; bytes: number }>();
let assetBytes = 0;
function cacheAsset(key: string, body: string | ArrayBuffer, type: string) {
  const bytes = typeof body === "string" ? body.length * 2 : body.byteLength;
  if (bytes > 16 * 1024 * 1024) return;
  assetCache.set(key, { body, type, bytes });
  assetBytes += bytes;
  for (const [k, v] of assetCache) {
    if (assetBytes <= 96 * 1024 * 1024) break;
    assetCache.delete(k);
    assetBytes -= v.bytes;
  }
}

// ----------------------------------------------------------------- handler

export async function handleGrammarlyProxyRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const publicOrigin = url.origin;

  if (url.pathname === "/__trst/enter") {
    const ticket = url.searchParams.get("ticket");
    return ticket ? exchangeTicket(ticket) : plain(401, "Open Grammarly from your Top Rated SEO Tools account.");
  }
  if (url.pathname.startsWith("/__ws/")) {
    return plain(426, "WebSocket upgrade required.");
  }

  let body: ArrayBuffer | undefined;
  if (!["GET", "HEAD"].includes(request.method)) {
    const declared = Number(request.headers.get("content-length") ?? 0);
    if (declared > MAX_REQUEST_BYTES) return plain(413, "Request too large");
    try {
      body = await request.arrayBuffer();
    } catch {
      return plain(400, "Request body unavailable");
    }
    if (body.byteLength > MAX_REQUEST_BYTES) return plain(413, "Request too large");
  }

  let session: any;
  try {
    session = await requireProxySession(request);
  } catch {
    return plain(503, "Grammarly is temporarily unavailable. Please try again.");
  }
  if (!session) return plain(401, "Open Grammarly from your Top Rated SEO Tools account.");
  const writerId = String(session.user_id);

  const target = upstreamTarget(request.url);
  if (!target) return plain(403, "This Grammarly address is not allowed.");
  const { url: upstreamUrl, host } = target;
  const isDocument =
    request.method === "GET" &&
    ((request.headers.get("sec-fetch-dest") ?? "") === "document" ||
      (request.headers.get("accept") ?? "").includes("text/html"));

  if (isBlockedGrammarlyRequest(request.method, host, upstreamUrl.pathname) || (isDocument && host !== "app.grammarly.com")) {
    if (isDocument) {
      return new Response(null, { status: 302, headers: { Location: "/ddocs", "Cache-Control": "no-store" } });
    }
    return json(403, { error: "This action is disabled on the shared Grammarly account." });
  }

  // Per-writer documents.
  const docId = grammarlyDocumentIdFromPath(host, upstreamUrl.pathname);
  if (docId) {
    const owner = await grammarlyDocumentOwner(docId).catch(() => null);
    if (owner !== writerId) {
      if (isDocument) {
        return new Response(null, { status: 302, headers: { Location: "/ddocs", "Cache-Control": "no-store" } });
      }
      return json(404, { error: "Document not found" });
    }
  }

  const cacheable = request.method === "GET" && STATIC_HOSTS.has(host);
  const cacheKey = `${publicOrigin}|${upstreamUrl.toString()}`;
  if (cacheable) {
    const hit = assetCache.get(cacheKey);
    if (hit) {
      return new Response(hit.body, {
        status: 200,
        headers: { "Content-Type": hit.type, "Cache-Control": "private, max-age=31536000, immutable" },
      });
    }
  }

  let state: GrammarlySessionState;
  try {
    state = await vaultState();
  } catch {
    return plain(503, "Grammarly needs to be refreshed by Admin. Please try again later.");
  }

  const headers = new Headers();
  for (const [name, value] of request.headers) {
    const n = name.toLowerCase();
    if (DROP_REQUEST_HEADERS.has(n) || n.startsWith("cf-") || n.startsWith("sec-fetch-") || n.startsWith("x-forwarded")) continue;
    headers.set(name, value);
  }
  headers.set("Accept-Encoding", "identity");
  const cookie = grammarlyCookieHeader(state, host);
  if (cookie) headers.set("Cookie", cookie);
  if (request.headers.has("origin") || !["GET", "HEAD"].includes(request.method)) {
    headers.set("Origin", GRAMMARLY_APP_ORIGIN);
  }
  headers.set("Referer", `${GRAMMARLY_APP_ORIGIN}/ddocs`);
  const csrf = state.cookies.find((c) => c.name === "csrf-token")?.value;
  if (csrf && (headers.has("x-csrf-token") || !["GET", "HEAD"].includes(request.method))) {
    headers.set("x-csrf-token", csrf);
  }

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, { method: request.method, headers, body, redirect: "manual" });
  } catch {
    return plain(503, "Grammarly is temporarily unavailable. Please try again.");
  }

  const setCookies = (upstream.headers as any).getSetCookie?.() ?? [];
  if (setCookies.length) void persistRotatedCookies(setCookies).catch(() => undefined);

  if (upstream.status >= 300 && upstream.status < 400) {
    const location = upstream.headers.get("location") ?? "/";
    const absolute = new URL(location, upstreamUrl).toString();
    if (/\/(?:signin|login)(?:[/?#]|$)/i.test(new URL(absolute).pathname)) {
      return plain(503, "Grammarly needs to be refreshed by Admin. Please try again later.");
    }
    const mapped = toProxyUrl(absolute, publicOrigin);
    if (!mapped) return plain(403, "This Grammarly link leads outside Grammarly.");
    return new Response(null, { status: upstream.status, headers: { Location: mapped, "Cache-Control": "no-store" } });
  }

  const out = new Headers();
  for (const [name, value] of upstream.headers) {
    if (!DROP_RESPONSE_HEADERS.has(name.toLowerCase())) out.set(name, value);
  }
  out.set("Referrer-Policy", "no-referrer");
  out.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  if (request.method === "HEAD") return new Response(null, { status: upstream.status, headers: out });

  const type = upstream.headers.get("content-type") ?? "application/octet-stream";
  if (type.includes("text/event-stream")) {
    out.set("Cache-Control", "no-store");
    return new Response(upstream.body, { status: upstream.status, headers: out });
  }

  const textual = /text\/|javascript|json|xml|svg/i.test(type);
  if (!textual) {
    if (cacheable && upstream.ok) {
      const bytes = await upstream.arrayBuffer();
      cacheAsset(cacheKey, bytes, type);
      out.set("Cache-Control", "private, max-age=31536000, immutable");
      return new Response(bytes, { status: upstream.status, headers: out });
    }
    return new Response(upstream.body, { status: upstream.status, headers: out });
  }

  const debug = parseCookies(request).get("trst_debug") === "1";
  let text = rewriteGrammarlyBody(await upstream.text(), publicOrigin, debug);

  if (type.includes("text/html")) {
    text = text.replace(/<head([^>]*)>/i, (m) => m + grammarlyBootstrapScript(debug));
    out.set("Cache-Control", "no-store");
  }

  if (host === "dox.grammarly.com" && type.includes("json") && upstream.ok) {
    try {
      const payload = JSON.parse(text);
      // A new document (create / upload / copy) belongs to its creator.
      if (request.method === "POST" && isDocLike(payload)) {
        await claimDocument(String(payload.id), writerId);
      }
      if (request.method === "GET" && /^\/documents\/?$/.test(upstreamUrl.pathname)) {
        const owned = await ownedDocumentIds(writerId);
        if (upstreamUrl.searchParams.get("onlyCnt") === "true" && payload && typeof payload === "object" && !Array.isArray(payload)) {
          for (const k of Object.keys(payload)) if (typeof payload[k] === "number") payload[k] = owned.size;
          text = JSON.stringify(payload);
        } else {
          text = JSON.stringify(filterGrammarlyDocuments(payload, owned));
        }
      }
    } catch {
      /* leave non-JSON untouched */
    }
  }

  if (cacheable && upstream.ok) {
    cacheAsset(cacheKey, text, type);
    out.set("Cache-Control", "private, max-age=31536000, immutable");
  }
  return new Response(text, { status: upstream.status, headers: out });
}
