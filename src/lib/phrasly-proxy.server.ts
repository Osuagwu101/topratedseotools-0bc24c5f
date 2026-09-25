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
  normalisePhraslySession,
  type PhraslySessionState,
} from "@/lib/phrasly-session.server";

export const PHRASLY_PROXY_BASE = "/api/phrasly-proxy";
export const PHRASLY_LANDING_PATH = "/dashboard";
export const PHRASLY_UPSTREAM_ORIGIN = "https://phrasly.ai";
export const PHRASLY_PROXY_COOKIE = "trst_ph_proxy";
export const PHRASLY_HANDOFF_TTL_SECONDS = 60;
const MAX_REQUEST_BYTES = 5 * 1024 * 1024;

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

export function buildPhraslyCookieHeader(plaintext: string) {
  const parsed = JSON.parse(
    normalisePhraslySession(plaintext),
  ) as PhraslySessionState;

  return parsed.authenticated_cookies
    .filter((cookie) => {
      const domain = cookie.domain.toLowerCase().replace(/^\./, "");
      return domain === "phrasly.ai";
    })
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
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

  return {
    launchUrl: `${PHRASLY_PROXY_BASE}?ticket=${encodeURIComponent(token)}`,
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

function proxyCookie(token: string, expiresAt: string) {
  return [
    `${PHRASLY_PROXY_COOKIE}=${token}`,
    `Path=${PHRASLY_PROXY_BASE}`,
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

  const target = new URL(
    `${PHRASLY_PROXY_BASE}${PHRASLY_LANDING_PATH}`,
    request.url,
  );
  const headers = standardHeaders();
  headers.set("Location", target.toString());
  headers.append("Set-Cookie", proxyCookie(sessionToken, sessionExpiresAt));
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
  const target = new URL(
    `${targetPath}${url.search}`,
    PHRASLY_UPSTREAM_ORIGIN,
  );
  // Ticket is a Topratedseotools handoff secret; it must never reach Phrasly.
  target.searchParams.delete("ticket");

  let cookieHeader = "";
  try {
    const encrypted = await loadEncryptedPhraslySession();
    const plaintext = decryptPhraslySession(encrypted);
    cookieHeader = buildPhraslyCookieHeader(plaintext);
  } catch {
    return unavailable();
  }
  if (!cookieHeader) return unavailable();

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
    return unavailable();
  }

  // Never forward upstream Set-Cookie. Phase 4 will add allowlisted,
  // server-side cookie rotation persistence after live Phrasly validation.
  if (upstream.status === 401 || upstream.status === 403) {
    return unavailable();
  }

  if (upstream.status >= 300 && upstream.status < 400) {
    const location = upstream.headers.get("location") ?? "/";
    const rewritten = rewritePhraslyLocation(location);
    if (!rewritten) return unavailable();
    const h = standardHeaders();
    h.set("Location", rewritten);
    return new Response(null, { status: upstream.status, headers: h });
  }

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
