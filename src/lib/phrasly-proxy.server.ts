/*
 * Phase 3 — Phrasly server-side one-click proxy for authorised internal writers.
 *
 * Trust boundaries:
 * - customer/writer entitlement is re-checked server-side;
 * - the Phase 2 Phrasly session is decrypted only on the server;
 * - upstream Phrasly cookies are never returned to the writer;
 * - this is a fixed-host proxy for phrasly.ai, never an open proxy;
 * - browser-storage state remains in the vault and is not exposed client-side.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash, randomBytes } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  decryptPhraslySession,
  encryptPhraslySession,
  normalisePhraslySession,
  PHRASLY_AUTH_COOKIE_NAME,
  type PhraslySessionState,
} from "@/lib/phrasly-session.server";

export const PHRASLY_PROXY_BASE = "/api/phrasly-proxy";
export const PHRASLY_LANDING_PATH = "/dashboard";
export const PHRASLY_UPSTREAM_ORIGIN = "https://phrasly.ai";
export const PHRASLY_PROXY_COOKIE = "trst_ph_proxy";
export const PHRASLY_HANDOFF_TTL_SECONDS = 60;
const MAX_REQUEST_BYTES = 5 * 1024 * 1024;

export function phraslyProxyPublicOrigin() {
  const raw = String(process.env.PHRASLY_PROXY_PUBLIC_ORIGIN ?? "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function isDedicatedPhraslyProxyRequest(request: Request) {
  const publicOrigin = phraslyProxyPublicOrigin();
  return !!publicOrigin && new URL(request.url).origin === publicOrigin;
}

function proxyBaseForRequest(request: Request) {
  return isDedicatedPhraslyProxyRequest(request) ? "" : PHRASLY_PROXY_BASE;
}

function proxyCookiePathForRequest(request: Request) {
  return isDedicatedPhraslyProxyRequest(request) ? "/" : PHRASLY_PROXY_BASE;
}

export function phraslyAllowedAssetHosts() {
  const configured = String(process.env.PHRASLY_ASSET_HOSTS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return Array.from(new Set(configured)).filter(
    (host) => host !== "phrasly.ai" && host.endsWith(".phrasly.ai"),
  );
}

type AccessSource = {
  kind: "order" | "grant";
  id: string;
};

export function isUnexpiredPhraslyAccess(
  value: string | null | undefined,
  nowMs = Date.now(),
) {
  return !value || new Date(value).getTime() > nowMs;
}

export function isActivePhraslyOrder(
  order: {
    expires_at?: string | null;
    access_type?: string | null;
    fulfilment_status?: string | null;
    payment_status?: string | null;
    status?: string | null;
  },
  nowMs = Date.now(),
) {
  return (
    order.status === "approved" &&
    String(order.payment_status ?? "") === "successful" &&
    isUnexpiredPhraslyAccess(order.expires_at, nowMs) &&
    (String(order.access_type ?? "shared") !== "private" ||
      String(order.fulfilment_status ?? "") === "active")
  );
}

export function isActivePhraslyGrant(
  grant: { expires_at?: string | null; status?: string | null },
  nowMs = Date.now(),
) {
  return (
    grant.status === "active" &&
    isUnexpiredPhraslyAccess(grant.expires_at, nowMs)
  );
}

export function hashPhraslyProxyToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function phraslyProxySessionHours() {
  const raw = Number(process.env.PHRASLY_PROXY_SESSION_HOURS ?? 12);
  if (!Number.isFinite(raw)) return 12;
  return Math.max(1, Math.min(24, Math.round(raw)));
}

function cookieMatchesPhraslyTarget(
  cookie: PhraslySessionState["authenticated_cookies"][number],
  target: URL,
) {
  const host = target.hostname.toLowerCase();
  const domain = cookie.domain.toLowerCase().replace(/^\./, "");
  const domainMatches =
    host === domain ||
    (cookie.domain.startsWith(".") && host.endsWith(`.${domain}`));
  if (!domainMatches) return false;

  const cookiePath = cookie.path || "/";
  const targetPath = target.pathname || "/";
  if (
    targetPath !== cookiePath &&
    !targetPath.startsWith(cookiePath.endsWith("/") ? cookiePath : cookiePath + "/")
  ) {
    return false;
  }

  if (
    typeof cookie.expires === "number" &&
    Number.isFinite(cookie.expires) &&
    cookie.expires > 0 &&
    cookie.expires * 1000 <= Date.now()
  ) {
    return false;
  }
  return true;
}

export function buildPhraslyCookieHeader(
  plaintext: string,
  targetUrl = PHRASLY_UPSTREAM_ORIGIN + "/",
) {
  const parsed = JSON.parse(
    normalisePhraslySession(plaintext),
  ) as PhraslySessionState;
  const target = new URL(targetUrl);

  const cookies = parsed.authenticated_cookies.filter((cookie) =>
    cookieMatchesPhraslyTarget(cookie, target),
  );

  const sessionCookie = cookies.find(
    (cookie) => cookie.name === PHRASLY_AUTH_COOKIE_NAME,
  );
  if (!sessionCookie) {
    throw new Error('The stored Phrasly "session" cookie is missing.');
  }

  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

async function requireToolEnabled() {
  const { data, error } = await (supabaseAdmin as any)
    .from("tool_settings")
    .select("enabled, one_click_auth_enabled")
    .eq("tool_slug", "phrasly")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data?.enabled === false || !data?.one_click_auth_enabled) {
    throw new Error("Phrasly One-Click Login is not enabled.");
  }
}

async function findActiveAccess(userId: string): Promise<AccessSource | null> {
  const { data: orders, error: orderError } = await (supabaseAdmin as any)
    .from("tool_orders")
    .select("id, expires_at, access_type, fulfilment_status, payment_status, status")
    .eq("user_id", userId)
    .eq("tool_slug", "phrasly")
    .eq("status", "approved")
    .order("created_at", { ascending: false })
    .limit(20);
  if (orderError) throw new Error(orderError.message);

  const activeOrder = ((orders ?? []) as any[]).find((order) =>
    isActivePhraslyOrder(order),
  );
  if (activeOrder) return { kind: "order", id: String(activeOrder.id) };

  const { data: grants, error: grantError } = await (supabaseAdmin as any)
    .from("tool_access_grants")
    .select("id, expires_at, status")
    .eq("user_id", userId)
    .eq("tool_slug", "phrasly")
    .eq("status", "active")
    .order("granted_at", { ascending: false })
    .limit(20);
  if (grantError) throw new Error(grantError.message);

  const activeGrant = ((grants ?? []) as any[]).find((grant) =>
    isActivePhraslyGrant(grant),
  );
  return activeGrant ? { kind: "grant", id: String(activeGrant.id) } : null;
}

async function sourceStillActive(
  userId: string,
  source: AccessSource,
): Promise<boolean> {
  if (source.kind === "order") {
    const { data } = await (supabaseAdmin as any)
      .from("tool_orders")
      .select("expires_at, access_type, fulfilment_status, payment_status, status")
      .eq("id", source.id)
      .eq("user_id", userId)
      .eq("tool_slug", "phrasly")
      .maybeSingle();
    return !!(data && isActivePhraslyOrder(data));
  }

  const { data } = await (supabaseAdmin as any)
    .from("tool_access_grants")
    .select("expires_at, status")
    .eq("id", source.id)
    .eq("user_id", userId)
    .eq("tool_slug", "phrasly")
    .maybeSingle();
  return !!(data && isActivePhraslyGrant(data));
}

async function loadEncryptedPhraslySession() {
  const { data, error } = await (supabaseAdmin as any)
    .from("tool_authorized_sessions")
    .select("encrypted_payload, status")
    .eq("tool_slug", "phrasly")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.encrypted_payload || data.status !== "stored") {
    throw new Error(
      "Phrasly needs to be refreshed by Admin before writers can launch it.",
    );
  }
  return String(data.encrypted_payload);
}

export function extractPhraslyCookieRotations(
  setCookies: string[],
  allowedNames: Iterable<string>,
) {
  const allowed = new Set(allowedNames);
  const updates: Record<string, string> = {};
  for (const raw of setCookies) {
    const first = raw.split(";", 1)[0] ?? "";
    const eq = first.indexOf("=");
    if (eq <= 0) continue;
    const name = first.slice(0, eq).trim();
    const value = first.slice(eq + 1);
    if (allowed.has(name) && value !== "") updates[name] = value;
  }
  return updates;
}

export function applyPhraslyCookieRotations(
  plaintext: string,
  setCookies: string[],
) {
  const current = JSON.parse(
    normalisePhraslySession(plaintext),
  ) as PhraslySessionState;
  const updates = extractPhraslyCookieRotations(
    setCookies,
    current.authenticated_cookies.map((cookie) => cookie.name),
  );
  let changed = false;

  for (const cookie of current.authenticated_cookies) {
    const nextValue = updates[cookie.name];
    if (nextValue && nextValue !== cookie.value) {
      cookie.value = nextValue;
      changed = true;
    }
  }

  return {
    changed,
    plaintext: normalisePhraslySession(JSON.stringify(current)),
  };
}

async function persistRotatedPhraslyCookies(upstream: Response) {
  const headers = upstream.headers as Headers & { getSetCookie?: () => string[] };
  const setCookies =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : (() => {
          const raw = headers.get("set-cookie");
          return raw ? [raw] : [];
        })();
  if (!setCookies.length) return;

  const encrypted = await loadEncryptedPhraslySession();
  const currentPlaintext = decryptPhraslySession(encrypted);
  const rotated = applyPhraslyCookieRotations(currentPlaintext, setCookies);
  if (!rotated.changed) return;

  const nowIso = new Date().toISOString();
  const { error } = await (supabaseAdmin as any)
    .from("tool_authorized_sessions")
    .update({
      encrypted_payload: encryptPhraslySession(rotated.plaintext),
      rotated_at: nowIso,
      updated_at: nowIso,
    })
    .eq("tool_slug", "phrasly")
    .eq("status", "stored");
  if (error) throw new Error(error.message);
}

function classifyPhrasly403(upstream: Response): PhraslyProxyDiagnosticCode {
  const mitigated = String(upstream.headers.get("cf-mitigated") ?? "").toLowerCase();
  if (mitigated === "challenge") return "upstream_403_edge_challenge";
  return "upstream_403";
}

type PhraslyProxyDiagnosticCode =
  | "session_decrypt_failed"
  | "session_cookie_missing"
  | "upstream_network_error"
  | "upstream_401"
  | "upstream_403"
  | "upstream_403_edge_challenge"
  | "upstream_external_redirect"
  | "upstream_redirect"
  | "upstream_ok";

async function recordPhraslyProxyDiagnostic(
  proxySessionId: string,
  code: PhraslyProxyDiagnosticCode,
  upstreamStatus: number | null = null,
) {
  try {
    await (supabaseAdmin as any)
      .from("phrasly_proxy_sessions")
      .update({
        last_error_code: code === "upstream_ok" ? null : code,
        last_upstream_status: upstreamStatus,
        diagnostic_updated_at: new Date().toISOString(),
      })
      .eq("id", proxySessionId);
  } catch {
    // Diagnostics are non-fatal and must never interrupt writer access.
  }
}

export async function createPhraslyProxyLaunch(userId: string) {
  await requireToolEnabled();

  const source = await findActiveAccess(userId);
  if (!source) {
    throw new Error(
      "An active Phrasly subscription or grant is required for One-Click Login.",
    );
  }

  // Fail before issuing a ticket if Admin has not stored a usable session.
  await loadEncryptedPhraslySession();

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(
    Date.now() + PHRASLY_HANDOFF_TTL_SECONDS * 1000,
  ).toISOString();

  const { error } = await (supabaseAdmin as any)
    .from("phrasly_proxy_sessions")
    .insert({
      token_hash: hashPhraslyProxyToken(token),
      user_id: userId,
      source_kind: source.kind,
      source_id: source.id,
      status: "issued",
      expires_at: expiresAt,
    });
  if (error) throw new Error("Could not start Phrasly. Please try again.");

  await (supabaseAdmin as any)
    .from("tool_usage")
    .insert({ tool_slug: "phrasly", user_id: userId });

  const publicOrigin = phraslyProxyPublicOrigin();
  return {
    launchUrl: publicOrigin
      ? `${publicOrigin}/__trst/enter?ticket=${encodeURIComponent(token)}`
      : `${PHRASLY_PROXY_BASE}?ticket=${encodeURIComponent(token)}`,
    proxyPublicOrigin: publicOrigin,
    handoffExpiresAt: expiresAt,
  };
}

function parseCookieHeader(request: Request) {
  const out = new Map<string, string>();
  const raw = request.headers.get("cookie") ?? "";
  for (const chunk of raw.split(";")) {
    const idx = chunk.indexOf("=");
    if (idx <= 0) continue;
    const key = chunk.slice(0, idx).trim();
    const value = chunk.slice(idx + 1).trim();
    if (key) out.set(key, value);
  }
  return out;
}

function proxyCookie(token: string, expiresAt: string, cookiePath: string) {
  return [
    `${PHRASLY_PROXY_COOKIE}=${token}`,
    `Path=${cookiePath}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Expires=${new Date(expiresAt).toUTCString()}`,
  ].join("; ");
}

async function exchangeLaunchTicket(request: Request, ticket: string) {
  const nowIso = new Date().toISOString();
  const { data: row } = await (supabaseAdmin as any)
    .from("phrasly_proxy_sessions")
    .select("id, user_id, source_kind, source_id, expires_at, status")
    .eq("token_hash", hashPhraslyProxyToken(ticket))
    .eq("status", "issued")
    .gt("expires_at", nowIso)
    .maybeSingle();

  if (!row) return forbidden("This Phrasly launch link is no longer valid.");

  await requireToolEnabled();
  const userId = String(row.user_id);
  const stillActive = await sourceStillActive(userId, {
    kind: row.source_kind as "order" | "grant",
    id: String(row.source_id),
  });
  if (!stillActive) {
    await (supabaseAdmin as any)
      .from("phrasly_proxy_sessions")
      .update({ status: "revoked" })
      .eq("id", row.id);
    return forbidden("Your Phrasly access is no longer active.");
  }

  try {
    await loadEncryptedPhraslySession();
  } catch {
    return unavailable();
  }

  const sessionToken = randomBytes(32).toString("base64url");
  const sessionExpiresAt = new Date(
    Date.now() + phraslyProxySessionHours() * 60 * 60 * 1000,
  ).toISOString();

  const { data: activated, error } = await (supabaseAdmin as any)
    .from("phrasly_proxy_sessions")
    .update({
      token_hash: hashPhraslyProxyToken(sessionToken),
      status: "active",
      activated_at: nowIso,
      last_seen_at: nowIso,
      expires_at: sessionExpiresAt,
    })
    .eq("id", row.id)
    .eq("status", "issued")
    .select("id")
    .maybeSingle();
  if (error || !activated) {
    return forbidden("This Phrasly launch link was already used.");
  }

  const proxyBase = proxyBaseForRequest(request);
  const cookiePath = proxyCookiePathForRequest(request);
  const target = new URL(
    `${proxyBase}${PHRASLY_LANDING_PATH}`,
    request.url,
  );
  const headers = standardHeaders();
  headers.set("Location", target.toString());
  headers.append(
    "Set-Cookie",
    proxyCookie(sessionToken, sessionExpiresAt, cookiePath),
  );
  return new Response(null, { status: 302, headers });
}

async function requireProxySession(request: Request) {
  const token = parseCookieHeader(request).get(PHRASLY_PROXY_COOKIE);
  if (!token) return null;

  const nowIso = new Date().toISOString();
  const { data: row } = await (supabaseAdmin as any)
    .from("phrasly_proxy_sessions")
    .select("id, user_id, source_kind, source_id, expires_at, status")
    .eq("token_hash", hashPhraslyProxyToken(token))
    .eq("status", "active")
    .maybeSingle();

  if (!row) return null;
  if (new Date(String(row.expires_at)).getTime() <= Date.now()) {
    await (supabaseAdmin as any)
      .from("phrasly_proxy_sessions")
      .update({ status: "expired" })
      .eq("id", row.id);
    return null;
  }

  await requireToolEnabled();
  const stillActive = await sourceStillActive(String(row.user_id), {
    kind: row.source_kind as "order" | "grant",
    id: String(row.source_id),
  });
  if (!stillActive) {
    await (supabaseAdmin as any)
      .from("phrasly_proxy_sessions")
      .update({ status: "revoked" })
      .eq("id", row.id);
    return null;
  }

  await (supabaseAdmin as any)
    .from("phrasly_proxy_sessions")
    .update({ last_seen_at: nowIso })
    .eq("id", row.id);

  return row;
}

export function rewritePhraslyBody(
  text: string,
  contentType: string,
  proxyBase = PHRASLY_PROXY_BASE,
) {
  const escapedProxy = proxyBase.replaceAll("/", "\\/");
  let out = text
    .replaceAll(PHRASLY_UPSTREAM_ORIGIN, proxyBase)
    .replaceAll("https:\\/\\/phrasly.ai", escapedProxy);

  if (contentType.includes("text/html")) {
    out = out
      .replace(
        /(<(?:script|img|link|a|form|source|video|audio)[^>]+(?:src|href|action|poster)=["'])\/(?!\/)/gi,
        `$1${proxyBase}/`,
      )
      .replace(
        /<head([^>]*)>/i,
        `<head$1><base href="${proxyBase}/"><script src="/api/phrasly-proxy-bootstrap"></script>`,
      );
  }

  if (contentType.includes("text/css")) {
    out = out.replace(
      /url\((['"]?)\/(?!\/)/g,
      `url($1${proxyBase}/`,
    );
  }

  return out;
}

export function buildPhraslyUpstreamUrl(
  requestUrl: string,
  targetPath: string,
) {
  const incoming = new URL(requestUrl);
  const target = new URL(PHRASLY_UPSTREAM_ORIGIN);
  // Assign pathname on an already-fixed origin rather than resolving targetPath
  // as a URL. This prevents //host or backslash variants from ever escaping
  // the single allowed upstream origin.
  target.pathname = targetPath.startsWith("/") ? targetPath : `/${targetPath}`;
  target.search = incoming.search;
  target.searchParams.delete("ticket");
  return target;
}

export function rewritePhraslyLocation(
  location: string,
  baseOrigin = PHRASLY_UPSTREAM_ORIGIN,
  proxyBase = PHRASLY_PROXY_BASE,
) {
  const absolute = new URL(location, baseOrigin);
  if (absolute.origin !== PHRASLY_UPSTREAM_ORIGIN) return null;
  return `${proxyBase}${absolute.pathname}${absolute.search}${absolute.hash}`;
}

function upstreamHeaders(request: Request, cookieHeader: string) {
  const h = new Headers();
  const copy = [
    "accept",
    "accept-language",
    "content-type",
    "if-none-match",
    "if-modified-since",
    "range",
    "rsc",
    "next-router-state-tree",
    "next-router-prefetch",
    "next-url",
    "purpose",
    "x-nextjs-data",
    "sec-ch-ua",
    "sec-ch-ua-mobile",
    "sec-ch-ua-platform",
  ];
  for (const name of copy) {
    const value = request.headers.get(name);
    if (value) h.set(name, value);
  }

  const userAgent = request.headers.get("user-agent");
  if (userAgent) h.set("User-Agent", userAgent);
  if (!h.has("Accept-Language")) h.set("Accept-Language", "en-US,en;q=0.9");
  h.set("Accept-Encoding", "identity");
  h.set("Origin", PHRASLY_UPSTREAM_ORIGIN);
  h.set("Referer", `${PHRASLY_UPSTREAM_ORIGIN}/`);
  h.set("Cookie", cookieHeader);
  return h;
}

function standardHeaders(contentType?: string) {
  const h = new Headers({
    "Cache-Control": "no-store, max-age=0",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
  });
  if (contentType) h.set("Content-Type", contentType);
  return h;
}

function forbidden(message = "Phrasly access is not available.") {
  return new Response(message, {
    status: 403,
    headers: standardHeaders("text/plain; charset=utf-8"),
  });
}

function unauthorized() {
  return new Response(
    "Open Phrasly from your Top Rated SEO Tools account.",
    {
      status: 401,
      headers: standardHeaders("text/plain; charset=utf-8"),
    },
  );
}

function unavailable() {
  return new Response(
    "Phrasly is temporarily unavailable. Admin may need to refresh the authorised session.",
    {
      status: 503,
      headers: standardHeaders("text/plain; charset=utf-8"),
    },
  );
}

export async function handlePhraslyProxyRequest(request: Request) {
  const url = new URL(request.url);
  const ticket = url.searchParams.get("ticket");

  if (url.pathname === PHRASLY_PROXY_BASE && ticket) {
    return exchangeLaunchTicket(request, ticket);
  }

  let proxySession;
  try {
    proxySession = await requireProxySession(request);
  } catch {
    return unavailable();
  }
  if (!proxySession) return unauthorized();

  if (!["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"].includes(request.method)) {
    return new Response("Method not allowed", {
      status: 405,
      headers: standardHeaders("text/plain; charset=utf-8"),
    });
  }

  if (!["GET", "HEAD"].includes(request.method)) {
    const origin = request.headers.get("origin");
    if (origin && origin !== url.origin) {
      return forbidden("Cross-site proxy requests are blocked.");
    }
  }

  const suffix = url.pathname.startsWith(PHRASLY_PROXY_BASE)
    ? url.pathname.slice(PHRASLY_PROXY_BASE.length)
    : "";
  const targetPath = suffix || PHRASLY_LANDING_PATH;
  const target = buildPhraslyUpstreamUrl(request.url, targetPath);

  let cookieHeader = "";
  try {
    const encrypted = await loadEncryptedPhraslySession();
    const plaintext = decryptPhraslySession(encrypted);
    cookieHeader = buildPhraslyCookieHeader(plaintext);
  } catch {
    await recordPhraslyProxyDiagnostic(
      String(proxySession.id),
      "session_decrypt_failed",
    );
    return unavailable();
  }
  if (!cookieHeader) {
    await recordPhraslyProxyDiagnostic(
      String(proxySession.id),
      "session_cookie_missing",
    );
    return unavailable();
  }

  let body: ArrayBuffer | undefined;
  if (!["GET", "HEAD"].includes(request.method)) {
    const declared = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) {
      return new Response("Request too large", {
        status: 413,
        headers: standardHeaders("text/plain; charset=utf-8"),
      });
    }
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength > MAX_REQUEST_BYTES) {
      return new Response("Request too large", {
        status: 413,
        headers: standardHeaders("text/plain; charset=utf-8"),
      });
    }
    body = bytes;
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers: upstreamHeaders(request, cookieHeader),
      body,
      redirect: "manual",
    });
  } catch {
    await recordPhraslyProxyDiagnostic(
      String(proxySession.id),
      "upstream_network_error",
    );
    return unavailable();
  }

  // Never forward upstream Set-Cookie. Phase 4 will add allowlisted,
  // server-side cookie rotation persistence after live Phrasly validation.
  if (upstream.status === 401) {
    await recordPhraslyProxyDiagnostic(
      String(proxySession.id),
      "upstream_401",
      upstream.status,
    );
    return unavailable();
  }
  if (upstream.status === 403) {
    await recordPhraslyProxyDiagnostic(
      String(proxySession.id),
      "upstream_403",
      upstream.status,
    );
    return unavailable();
  }

  if (upstream.status >= 300 && upstream.status < 400) {
    const location = upstream.headers.get("location") ?? "/";
    const rewritten = rewritePhraslyLocation(location);
    if (!rewritten) {
      await recordPhraslyProxyDiagnostic(
        String(proxySession.id),
        "upstream_external_redirect",
        upstream.status,
      );
      return unavailable();
    }
    await recordPhraslyProxyDiagnostic(
      String(proxySession.id),
      "upstream_redirect",
      upstream.status,
    );
    const h = standardHeaders();
    h.set("Location", rewritten);
    return new Response(null, { status: upstream.status, headers: h });
  }

  await recordPhraslyProxyDiagnostic(
    String(proxySession.id),
    "upstream_ok",
    upstream.status,
  );

  const contentType =
    upstream.headers.get("content-type") ?? "application/octet-stream";
  const headers = standardHeaders(contentType);
  for (const name of [
    "content-disposition",
    "etag",
    "last-modified",
    "accept-ranges",
    "content-range",
  ]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }

  if (request.method === "HEAD") {
    return new Response(null, { status: upstream.status, headers });
  }

  const isText =
    contentType.includes("text/html") ||
    contentType.includes("text/css") ||
    contentType.includes("javascript") ||
    contentType.includes("application/json") ||
    contentType.includes("text/plain");

  if (isText) {
    const text = await upstream.text();
    return new Response(rewritePhraslyBody(text, contentType), {
      status: upstream.status,
      headers,
    });
  }

  return new Response(await upstream.arrayBuffer(), {
    status: upstream.status,
    headers,
  });
}
