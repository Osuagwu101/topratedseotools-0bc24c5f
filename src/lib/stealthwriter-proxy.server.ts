/*
 * Phase 3 — StealthWriter server-side one-click proxy.
 *
 * Trust boundaries:
 * - customer access is re-checked server-side;
 * - the Phase 2 StealthWriter session is decrypted only on the server;
 * - upstream Better Auth cookies are never returned to the customer;
 * - this is a fixed-host proxy for stealthwriter.ai, never an open proxy.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash, randomBytes } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  decryptStealthWriterSession,
  encryptStealthWriterSession,
  normaliseStealthWriterSession,
  STEALTHWRITER_SESSION_KEYS,
} from "@/lib/stealthwriter-session.server";

export const STEALTHWRITER_PROXY_BASE = "/api/stealthwriter-proxy";
export const STEALTHWRITER_LANDING_PATH = "/dashboard/humanizer";
export const STEALTHWRITER_UPSTREAM_ORIGIN = "https://stealthwriter.ai";
export const STEALTHWRITER_PROXY_COOKIE = "trst_sw_proxy";

const HANDOFF_TTL_SECONDS = 60;
const MAX_REQUEST_BYTES = 5 * 1024 * 1024;

type AccessSource = {
  kind: "order" | "grant";
  id: string;
};

const BLOCKED_STEALTHWRITER_PATH_PREFIXES = [
  "/logout",
  "/signout",
  "/sign-out",
  "/billing",
  "/account",
  "/accounts",
  "/subscription",
  "/subscriptions",
  "/settings/billing",
  "/settings/account",
] as const;

export function isBlockedStealthWriterPath(pathname: string) {
  return BLOCKED_STEALTHWRITER_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix + "/"),
  );
}

function isUnexpired(value: string | null | undefined) {
  return !value || new Date(value).getTime() > Date.now();
}

/**
 * The AWS reference keeps the user-side proxy session long-lived and treats
 * the 60-second value only as the signed handoff lifetime. The master
 * StealthWriter login lifetime is NOT imposed here; upstream Better Auth owns
 * it and can extend it by rotating the saved cookies.
 *
 * Default: 30 days so our own proxy cookie never shortens an otherwise-valid
 * upstream session. The upstream Better Auth session can still expire earlier
 * (commonly around 7 days) or be extended by normal cookie rotation.
 */
export function proxySessionDays() {
  const raw = Number(process.env.STEALTHWRITER_PROXY_SESSION_DAYS ?? 30);
  if (!Number.isFinite(raw)) return 30;
  return Math.max(7, Math.min(30, Math.round(raw)));
}

export function hashStealthWriterProxyToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function buildStealthWriterCookieHeader(plaintext: string) {
  const normalised = normaliseStealthWriterSession(plaintext);
  const parsed = JSON.parse(normalised) as Record<string, string>;
  return STEALTHWRITER_SESSION_KEYS.map(
    (key) => `${key}=${parsed[key]}`,
  ).join("; ");
}

async function requireToolEnabled() {
  const { data, error } = await (supabaseAdmin as any)
    .from("tool_settings")
    .select("enabled, one_click_auth_enabled")
    .eq("tool_slug", "stealthwriter")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data?.enabled === false || !data?.one_click_auth_enabled) {
    throw new Error("StealthWriter One-Click Login is not enabled.");
  }
}

async function findActiveAccess(userId: string): Promise<AccessSource | null> {
  const nowIso = new Date().toISOString();

  const { data: orders, error: orderError } = await (supabaseAdmin as any)
    .from("tool_orders")
    .select("id, expires_at, access_type, fulfilment_status, payment_status, status")
    .eq("user_id", userId)
    .eq("tool_slug", "stealthwriter")
    .eq("status", "approved")
    .order("created_at", { ascending: false })
    .limit(20);
  if (orderError) throw new Error(orderError.message);

  const activeOrder = ((orders ?? []) as any[]).find(
    (order) =>
      isUnexpired(order.expires_at) &&
      String(order.payment_status ?? "successful") === "successful" &&
      (String(order.access_type ?? "shared") !== "private" ||
        String(order.fulfilment_status ?? "") === "active"),
  );
  if (activeOrder) return { kind: "order", id: String(activeOrder.id) };

  const { data: grants, error: grantError } = await (supabaseAdmin as any)
    .from("tool_access_grants")
    .select("id, expires_at, status")
    .eq("user_id", userId)
    .eq("tool_slug", "stealthwriter")
    .eq("status", "active")
    .order("granted_at", { ascending: false })
    .limit(20);
  if (grantError) throw new Error(grantError.message);

  const activeGrant = ((grants ?? []) as any[]).find((grant) =>
    isUnexpired(grant.expires_at),
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
      .eq("tool_slug", "stealthwriter")
      .maybeSingle();
    return !!(
      data &&
      data.status === "approved" &&
      String(data.payment_status ?? "successful") === "successful" &&
      isUnexpired(data.expires_at) &&
      (String(data.access_type ?? "shared") !== "private" ||
        String(data.fulfilment_status ?? "") === "active")
    );
  }

  const { data } = await (supabaseAdmin as any)
    .from("tool_access_grants")
    .select("expires_at, status")
    .eq("id", source.id)
    .eq("user_id", userId)
    .eq("tool_slug", "stealthwriter")
    .maybeSingle();
  return !!(data && data.status === "active" && isUnexpired(data.expires_at));
}

async function loadEncryptedStealthWriterSession() {
  const { data, error } = await (supabaseAdmin as any)
    .from("tool_authorized_sessions")
    .select("encrypted_payload, status")
    .eq("tool_slug", "stealthwriter")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.encrypted_payload || data.status !== "stored") {
    throw new Error(
      "StealthWriter authentication needs to be refreshed by Admin.",
    );
  }
  return String(data.encrypted_payload);
}

export async function createStealthWriterProxyLaunch(userId: string) {
  await requireToolEnabled();

  const source = await findActiveAccess(userId);
  if (!source) {
    throw new Error(
      "A successful active StealthWriter subscription is required for One-Click Login.",
    );
  }

  // Fail before issuing a ticket if Phase 2 has not been configured.
  await loadEncryptedStealthWriterSession();

  const fiveMinutesAgo = new Date(Date.now() - 5 * 60_000).toISOString();
  const { count } = await (supabaseAdmin as any)
    .from("stealthwriter_proxy_sessions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", fiveMinutesAgo);
  if ((count ?? 0) >= 3) {
    throw new Error(
      "Too many StealthWriter launch attempts. Please wait a few minutes and try again.",
    );
  }

  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashStealthWriterProxyToken(token);
  // Exactly like the AWS engine's signed handoff: the URL itself is valid
  // for only 60 seconds. The long-lived proxy session begins after exchange.
  const expiresAt = new Date(
    Date.now() + HANDOFF_TTL_SECONDS * 1000,
  ).toISOString();

  const { error } = await (supabaseAdmin as any)
    .from("stealthwriter_proxy_sessions")
    .insert({
      token_hash: tokenHash,
      user_id: userId,
      source_kind: source.kind,
      source_id: source.id,
      status: "issued",
      expires_at: expiresAt,
    });
  if (error) throw new Error("Could not start StealthWriter. Please try again.");

  await (supabaseAdmin as any)
    .from("tool_usage")
    .insert({ tool_slug: "stealthwriter", user_id: userId });

  return {
    launchUrl: `${STEALTHWRITER_PROXY_BASE}?ticket=${encodeURIComponent(token)}`,
    // This is the handoff expiry, not the StealthWriter/master-session expiry.
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
    `${STEALTHWRITER_PROXY_COOKIE}=${token}`,
    "Path=/api/stealthwriter-proxy",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Expires=${new Date(expiresAt).toUTCString()}`,
  ].join("; ");
}

async function exchangeLaunchTicket(request: Request, ticket: string) {
  const tokenHash = hashStealthWriterProxyToken(ticket);
  const nowIso = new Date().toISOString();

  const { data: row } = await (supabaseAdmin as any)
    .from("stealthwriter_proxy_sessions")
    .select("id, user_id, source_kind, source_id, expires_at, status")
    .eq("token_hash", tokenHash)
    .eq("status", "issued")
    .gt("expires_at", nowIso)
    .maybeSingle();

  if (!row) return forbidden("This StealthWriter launch link is no longer valid.");

  await requireToolEnabled();
  const stillActive = await sourceStillActive(String(row.user_id), {
    kind: row.source_kind as "order" | "grant",
    id: String(row.source_id),
  });
  if (!stillActive) {
    await (supabaseAdmin as any)
      .from("stealthwriter_proxy_sessions")
      .update({ status: "revoked" })
      .eq("id", row.id);
    return forbidden("Your StealthWriter access is no longer active.");
  }

  // Exchange the URL ticket for a different HttpOnly cookie token. The
  // original ticket becomes useless immediately after this atomic transition.
  const sessionToken = randomBytes(32).toString("base64url");
  const sessionExpiresAt = new Date(
    Date.now() + proxySessionDays() * 24 * 60 * 60 * 1000,
  ).toISOString();
  const { data: activated, error } = await (supabaseAdmin as any)
    .from("stealthwriter_proxy_sessions")
    .update({
      token_hash: hashStealthWriterProxyToken(sessionToken),
      status: "active",
      activated_at: nowIso,
      last_seen_at: nowIso,
      expires_at: sessionExpiresAt,
    })
    .eq("id", row.id)
    .eq("status", "issued")
    .select("id")
    .maybeSingle();
  if (error || !activated) return forbidden("This StealthWriter launch link was already used.");

  const target = new URL(
    `${STEALTHWRITER_PROXY_BASE}${STEALTHWRITER_LANDING_PATH}`,
    request.url,
  );

  return new Response(null, {
    status: 302,
    headers: {
      Location: target.toString(),
      "Set-Cookie": proxyCookie(sessionToken, sessionExpiresAt),
      "Cache-Control": "no-store, max-age=0",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex, nofollow, noarchive",
    },
  });
}

async function requireProxySession(request: Request) {
  const token = parseCookieHeader(request).get(STEALTHWRITER_PROXY_COOKIE);
  if (!token) return null;

  const tokenHash = hashStealthWriterProxyToken(token);
  const nowIso = new Date().toISOString();
  const { data: row } = await (supabaseAdmin as any)
    .from("stealthwriter_proxy_sessions")
    .select("id, user_id, source_kind, source_id, expires_at, status")
    .eq("token_hash", tokenHash)
    .eq("status", "active")
    .maybeSingle();

  if (!row) return null;
  if (new Date(String(row.expires_at)).getTime() <= Date.now()) {
    await (supabaseAdmin as any)
      .from("stealthwriter_proxy_sessions")
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
      .from("stealthwriter_proxy_sessions")
      .update({ status: "revoked" })
      .eq("id", row.id);
    return null;
  }

  await (supabaseAdmin as any)
    .from("stealthwriter_proxy_sessions")
    .update({ last_seen_at: nowIso })
    .eq("id", row.id);

  return row;
}

export function rewriteStealthWriterBody(
  text: string,
  contentType: string,
) {
  const escapedProxy = STEALTHWRITER_PROXY_BASE.replaceAll("/", "\\/");
  let out = text
    .replaceAll(STEALTHWRITER_UPSTREAM_ORIGIN, STEALTHWRITER_PROXY_BASE)
    .replaceAll(
      "https:\\/\\/stealthwriter.ai",
      escapedProxy,
    );

  if (contentType.includes("text/html")) {
    out = out
      .replace(
        /(<(?:script|img|link|a|form|source|video|audio)[^>]+(?:src|href|action|poster)=["'])\/(?!\/)/gi,
        `$1${STEALTHWRITER_PROXY_BASE}/`,
      )
      .replace(
        /<head([^>]*)>/i,
        `<head$1><base href="${STEALTHWRITER_PROXY_BASE}/"><script src="/api/stealthwriter-proxy-bootstrap"></script>`,
      );
  }

  if (contentType.includes("text/css")) {
    out = out.replace(
      /url\((['"]?)\/(?!\/)/g,
      `url($1${STEALTHWRITER_PROXY_BASE}/`,
    );
  }

  return out;
}

export function rewriteStealthWriterLocation(location: string) {
  const absolute = new URL(location, STEALTHWRITER_UPSTREAM_ORIGIN);
  if (
    absolute.origin !== STEALTHWRITER_UPSTREAM_ORIGIN &&
    absolute.origin !== "https://www.stealthwriter.ai"
  ) {
    return null;
  }
  return `${STEALTHWRITER_PROXY_BASE}${absolute.pathname}${absolute.search}${absolute.hash}`;
}

function upstreamHeaders(request: Request, cookieHeader: string) {
  const h = new Headers();

  // Mirror the AWS engine: keep normal browser request characteristics while
  // replacing only the security-sensitive routing/authentication pieces.
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
    "sec-fetch-dest",
    "sec-fetch-mode",
    "sec-fetch-site",
    "sec-fetch-user",
    "upgrade-insecure-requests",
  ];
  for (const name of copy) {
    const value = request.headers.get(name);
    if (value) h.set(name, value);
  }
  const userAgent = request.headers.get("user-agent");
  if (userAgent) h.set("User-Agent", userAgent);
  if (!h.has("Accept-Language")) h.set("Accept-Language", "en-US,en;q=0.9");
  h.set("Accept-Encoding", "identity");
  h.set("Origin", STEALTHWRITER_UPSTREAM_ORIGIN);

  const incomingReferer = request.headers.get("referer");
  let referer = `${STEALTHWRITER_UPSTREAM_ORIGIN}/`;
  if (incomingReferer) {
    try {
      const r = new URL(incomingReferer);
      if (r.pathname.startsWith(STEALTHWRITER_PROXY_BASE)) {
        referer =
          STEALTHWRITER_UPSTREAM_ORIGIN +
          r.pathname.slice(STEALTHWRITER_PROXY_BASE.length) +
          r.search;
      }
    } catch {
      /* use upstream root */
    }
  }
  h.set("Referer", referer);
  h.set("Cookie", cookieHeader);
  return h;
}

async function persistRotatedStealthWriterCookies(upstream: Response) {
  // AWS reference behavior: Better Auth may rotate these cookie values on
  // ordinary requests. Never forward Set-Cookie to the customer; merge only
  // the two allowlisted values back into the encrypted server-side vault.
  const headers = upstream.headers as Headers & { getSetCookie?: () => string[] };
  const setCookies =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : (() => {
          const raw = headers.get("set-cookie");
          return raw ? [raw] : [];
        })();

  if (!setCookies.length) return;

  const updates: Record<string, string> = {};
  for (const raw of setCookies) {
    const first = raw.split(";", 1)[0] ?? "";
    const eq = first.indexOf("=");
    if (eq <= 0) continue;
    const name = first.slice(0, eq).trim();
    const value = first.slice(eq + 1);
    if (
      (STEALTHWRITER_SESSION_KEYS as readonly string[]).includes(name) &&
      value !== ""
    ) {
      updates[name] = value;
    }
  }
  if (!Object.keys(updates).length) return;

  const encrypted = await loadEncryptedStealthWriterSession();
  const currentPlaintext = decryptStealthWriterSession(encrypted);
  const current = JSON.parse(
    normaliseStealthWriterSession(currentPlaintext),
  ) as Record<string, string>;
  let changed = false;
  for (const key of STEALTHWRITER_SESSION_KEYS) {
    if (updates[key] && updates[key] !== current[key]) {
      current[key] = updates[key];
      changed = true;
    }
  }
  if (!changed) return;

  const nextPlaintext = normaliseStealthWriterSession(JSON.stringify(current));
  const nextEncrypted = encryptStealthWriterSession(nextPlaintext);
  await (supabaseAdmin as any)
    .from("tool_authorized_sessions")
    .update({
      encrypted_payload: nextEncrypted,
      rotated_at: new Date().toISOString(),
    })
    .eq("tool_slug", "stealthwriter")
    .eq("status", "stored");
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

function forbidden(message = "StealthWriter access is not available.") {
  return new Response(message, { status: 403, headers: standardHeaders("text/plain; charset=utf-8") });
}

function unauthorized() {
  return new Response("Open StealthWriter from your Top Rated SEO Tools account.", {
    status: 401,
    headers: standardHeaders("text/plain; charset=utf-8"),
  });
}

function unavailable() {
  return new Response(
    "StealthWriter is temporarily unavailable. Please contact Admin if this continues.",
    { status: 503, headers: standardHeaders("text/plain; charset=utf-8") },
  );
}

export async function handleStealthWriterProxyRequest(request: Request) {
  const url = new URL(request.url);
  const ticket = url.searchParams.get("ticket");

  if (url.pathname === STEALTHWRITER_PROXY_BASE && ticket) {
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
    if (origin && origin !== url.origin) return forbidden("Cross-site proxy requests are blocked.");
  }

  const suffix = url.pathname.startsWith(STEALTHWRITER_PROXY_BASE)
    ? url.pathname.slice(STEALTHWRITER_PROXY_BASE.length)
    : "";
  const path = suffix || STEALTHWRITER_LANDING_PATH;
  const target = new URL(path.startsWith("/") ? path : `/${path}`, STEALTHWRITER_UPSTREAM_ORIGIN);
  target.search = url.search;

  // AWS reference Step 3: customer navigation can never reach master-account
  // logout, billing, subscription or account-management surfaces.
  if (isBlockedStealthWriterPath(target.pathname)) {
    return forbidden("This StealthWriter account action is disabled.");
  }

  let cookieHeader: string;
  try {
    const encrypted = await loadEncryptedStealthWriterSession();
    const plaintext = decryptStealthWriterSession(encrypted);
    cookieHeader = buildStealthWriterCookieHeader(plaintext);
  } catch {
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
    return unavailable();
  }

  // Persist any Better Auth cookie rotation before handling redirects/body.
  try {
    await persistRotatedStealthWriterCookies(upstream);
  } catch {
    // Do not silently lose a Better Auth rotation. The AWS engine persists
    // rotations synchronously because the next request may require the new value.
    return unavailable();
  }

  if (upstream.status === 401 || upstream.status === 403) return unavailable();

  if (upstream.status >= 300 && upstream.status < 400) {
    const location = upstream.headers.get("location") ?? "/";
    const rewritten = rewriteStealthWriterLocation(location);
    if (!rewritten) return unavailable();
    const h = standardHeaders();
    h.set("Location", rewritten);
    return new Response(null, { status: upstream.status, headers: h });
  }

  const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
  const headers = standardHeaders(contentType);

  for (const name of ["content-disposition", "etag", "last-modified", "accept-ranges", "content-range"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }

  // Never forward Set-Cookie. The customer browser must never receive the
  // authorised StealthWriter session or any refreshed upstream auth cookie.
  const isText =
    contentType.includes("text/html") ||
    contentType.includes("text/css") ||
    contentType.includes("javascript") ||
    contentType.includes("application/json") ||
    contentType.includes("text/plain");

  if (request.method === "HEAD") {
    return new Response(null, { status: upstream.status, headers });
  }

  if (isText) {
    const text = await upstream.text();
    return new Response(rewriteStealthWriterBody(text, contentType), {
      status: upstream.status,
      headers,
    });
  }

  return new Response(await upstream.arrayBuffer(), {
    status: upstream.status,
    headers,
  });
}
