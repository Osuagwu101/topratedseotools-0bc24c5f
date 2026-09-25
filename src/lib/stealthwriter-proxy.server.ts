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
import {
  consumeStealthWriterUsage,
  ensureStealthWriterUserControls,
  featureForStealthWriterUsagePath,
  getStealthWriterUsageSnapshot,
  getStealthWriterUserLabel,
  grantedStealthWriterFeatures,
  isAllowedStealthWriterDocumentPath,
  isFreeStealthWriterRehumanize,
  isValidStealthWriterDeviceFingerprint,
  pickStealthWriterLandingPath,
  registerOrTouchStealthWriterDevice,
  STEALTHWRITER_DEVICE_COOKIE,
  stealthWriterAllowedAssetHosts,
} from "@/lib/stealthwriter-controls.server";

export const STEALTHWRITER_PROXY_BASE = "/api/stealthwriter-proxy";
export const STEALTHWRITER_LANDING_PATH = "/dashboard/humanizer";
export const STEALTHWRITER_UPSTREAM_ORIGIN = "https://stealthwriter.ai";
export const STEALTHWRITER_PROXY_COOKIE = "trst_sw_proxy";
export const STEALTHWRITER_APP_DEVICE_COOKIE = "trst_app_device";

export function stealthWriterProxyPublicOrigin() {
  const raw = String(process.env.STEALTHWRITER_PROXY_PUBLIC_ORIGIN ?? "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function isDedicatedStealthWriterProxyRequest(request: Request) {
  const publicOrigin = stealthWriterProxyPublicOrigin();
  return !!publicOrigin && new URL(request.url).origin === publicOrigin;
}

function proxyBaseForRequest(request: Request) {
  return isDedicatedStealthWriterProxyRequest(request) ? "" : STEALTHWRITER_PROXY_BASE;
}

function proxyCookiePathForRequest(request: Request) {
  return isDedicatedStealthWriterProxyRequest(request) ? "/" : STEALTHWRITER_PROXY_BASE;
}

export const STEALTHWRITER_HANDOFF_TTL_SECONDS = 60;
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

export function isUnexpiredStealthWriterAccess(
  value: string | null | undefined,
  nowMs = Date.now(),
) {
  return !value || new Date(value).getTime() > nowMs;
}

export function isActiveStealthWriterOrder(
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
    isUnexpiredStealthWriterAccess(order.expires_at, nowMs) &&
    (String(order.access_type ?? "shared") !== "private" ||
      String(order.fulfilment_status ?? "") === "active")
  );
}

export function isActiveStealthWriterGrant(
  grant: { expires_at?: string | null; status?: string | null },
  nowMs = Date.now(),
) {
  return (
    grant.status === "active" &&
    isUnexpiredStealthWriterAccess(grant.expires_at, nowMs)
  );
}

export function isStealthWriterUpstreamAuthRejected(status: number) {
  return status === 401 || status === 403;
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

  const activeOrder = ((orders ?? []) as any[]).find((order) =>
    isActiveStealthWriterOrder(order),
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
    isActiveStealthWriterGrant(grant),
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
    return !!(data && isActiveStealthWriterOrder(data));
  }

  const { data } = await (supabaseAdmin as any)
    .from("tool_access_grants")
    .select("expires_at, status")
    .eq("id", source.id)
    .eq("user_id", userId)
    .eq("tool_slug", "stealthwriter")
    .maybeSingle();
  return !!(data && isActiveStealthWriterGrant(data));
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

export async function createStealthWriterProxyLaunch(
  userId: string,
  appDeviceFingerprint?: string | null,
) {
  await requireToolEnabled();

  const source = await findActiveAccess(userId);
  if (!source) {
    throw new Error(
      "A successful active StealthWriter subscription is required for One-Click Login.",
    );
  }

  // Fail before issuing a ticket if Phase 2 has not been configured.
  await loadEncryptedStealthWriterSession();

  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashStealthWriterProxyToken(token);
  // Exactly like the AWS engine's signed handoff: the URL itself is valid
  // for only 60 seconds. The long-lived proxy session begins after exchange.
  const expiresAt = new Date(
    Date.now() + STEALTHWRITER_HANDOFF_TTL_SECONDS * 1000,
  ).toISOString();

  const { error } = await (supabaseAdmin as any)
    .from("stealthwriter_proxy_sessions")
    .insert({
      token_hash: tokenHash,
      user_id: userId,
      source_kind: source.kind,
      source_id: source.id,
      status: "issued",
      device_fingerprint: isValidStealthWriterDeviceFingerprint(appDeviceFingerprint)
        ? appDeviceFingerprint
        : null,
      expires_at: expiresAt,
    });
  if (error) throw new Error("Could not start StealthWriter. Please try again.");

  await (supabaseAdmin as any)
    .from("tool_usage")
    .insert({ tool_slug: "stealthwriter", user_id: userId });

  const publicOrigin = stealthWriterProxyPublicOrigin();
  return {
    launchUrl: publicOrigin
      ? `${publicOrigin}/__trst/enter?ticket=${encodeURIComponent(token)}`
      : `${STEALTHWRITER_PROXY_BASE}?ticket=${encodeURIComponent(token)}`,
    proxyPublicOrigin: publicOrigin,
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

export function readStealthWriterAppDeviceFingerprint(request: Request) {
  const value = parseCookieHeader(request).get(STEALTHWRITER_APP_DEVICE_COOKIE);
  return isValidStealthWriterDeviceFingerprint(value) ? String(value) : null;
}

function appDeviceCookie(fingerprint: string) {
  return [
    `${STEALTHWRITER_APP_DEVICE_COOKIE}=${fingerprint}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Expires=${new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toUTCString()}`,
  ].join("; ");
}

export function ensureStealthWriterAppDeviceResponse(request: Request) {
  const existing = readStealthWriterAppDeviceFingerprint(request);
  const fingerprint = existing ?? randomBytes(16).toString("hex");
  const headers = standardHeaders();
  if (!existing) headers.append("Set-Cookie", appDeviceCookie(fingerprint));
  return new Response(null, { status: 204, headers });
}

function proxyCookie(token: string, expiresAt: string, cookiePath: string) {
  return [
    `${STEALTHWRITER_PROXY_COOKIE}=${token}`,
    `Path=${cookiePath}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Expires=${new Date(expiresAt).toUTCString()}`,
  ].join("; ");
}

function deviceCookie(fingerprint: string, cookiePath: string) {
  return [
    `${STEALTHWRITER_DEVICE_COOKIE}=${fingerprint}`,
    `Path=${cookiePath}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Expires=${new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toUTCString()}`,
  ].join("; ");
}

async function exchangeLaunchTicket(request: Request, ticket: string) {
  const tokenHash = hashStealthWriterProxyToken(ticket);
  const nowIso = new Date().toISOString();

  const { data: row } = await (supabaseAdmin as any)
    .from("stealthwriter_proxy_sessions")
    .select("id, user_id, source_kind, source_id, expires_at, status, device_fingerprint")
    .eq("token_hash", tokenHash)
    .eq("status", "issued")
    .gt("expires_at", nowIso)
    .maybeSingle();

  if (!row) return forbidden("This StealthWriter launch link is no longer valid.");

  await requireToolEnabled();
  const userId = String(row.user_id);
  const stillActive = await sourceStillActive(userId, {
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

  // AWS parity: stable per-browser device identity. A new device above the
  // customer's limit suspends StealthWriter access until Admin reviews it.
  const cookieDevice = parseCookieHeader(request).get(STEALTHWRITER_DEVICE_COOKIE);
  const deviceFingerprint = isValidStealthWriterDeviceFingerprint(row.device_fingerprint)
    ? String(row.device_fingerprint)
    : isValidStealthWriterDeviceFingerprint(cookieDevice)
      ? String(cookieDevice)
      : randomBytes(16).toString("hex");

  let deviceGate;
  try {
    deviceGate = await registerOrTouchStealthWriterDevice(
      userId,
      deviceFingerprint,
      "Device",
    );
  } catch {
    return unavailable();
  }
  if (!deviceGate.ok) {
    return forbidden(
      "Your StealthWriter access has been suspended for logging in from too many devices. Please contact Admin.",
    );
  }

  const controls = await ensureStealthWriterUserControls(userId);
  const grantedFeatures = grantedStealthWriterFeatures(controls);
  if (!grantedFeatures.length) {
    return forbidden("You do not have an active StealthWriter feature.");
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
      device_fingerprint: deviceFingerprint,
    })
    .eq("id", row.id)
    .eq("status", "issued")
    .select("id")
    .maybeSingle();
  if (error || !activated) return forbidden("This StealthWriter launch link was already used.");

  const landing = pickStealthWriterLandingPath(grantedFeatures);
  const proxyBase = proxyBaseForRequest(request);
  const cookiePath = proxyCookiePathForRequest(request);
  const target = new URL(
    `${proxyBase}${landing}`,
    request.url,
  );

  const headers = standardHeaders();
  headers.set("Location", target.toString());
  headers.append("Set-Cookie", proxyCookie(sessionToken, sessionExpiresAt, cookiePath));
  headers.append("Set-Cookie", deviceCookie(deviceFingerprint, cookiePath));

  return new Response(null, { status: 302, headers });
}

async function requireProxySession(request: Request) {
  const cookies = parseCookieHeader(request);
  const token = cookies.get(STEALTHWRITER_PROXY_COOKIE);
  const deviceFingerprint = cookies.get(STEALTHWRITER_DEVICE_COOKIE);
  if (!token || !isValidStealthWriterDeviceFingerprint(deviceFingerprint)) return null;

  const tokenHash = hashStealthWriterProxyToken(token);
  const nowIso = new Date().toISOString();
  const { data: row } = await (supabaseAdmin as any)
    .from("stealthwriter_proxy_sessions")
    .select("id, user_id, source_kind, source_id, expires_at, status, device_fingerprint")
    .eq("token_hash", tokenHash)
    .eq("status", "active")
    .maybeSingle();

  if (!row || row.device_fingerprint !== deviceFingerprint) return null;
  if (new Date(String(row.expires_at)).getTime() <= Date.now()) {
    await (supabaseAdmin as any)
      .from("stealthwriter_proxy_sessions")
      .update({ status: "expired" })
      .eq("id", row.id);
    return null;
  }

  await requireToolEnabled();
  const controls = await ensureStealthWriterUserControls(String(row.user_id));
  if (controls.status !== "active") {
    await (supabaseAdmin as any)
      .from("stealthwriter_proxy_sessions")
      .update({ status: "revoked" })
      .eq("id", row.id);
    return null;
  }

  const { data: registeredDevice } = await (supabaseAdmin as any)
    .from("stealthwriter_devices")
    .select("id")
    .eq("user_id", row.user_id)
    .eq("device_fingerprint", deviceFingerprint)
    .maybeSingle();
  if (!registeredDevice?.id) {
    await (supabaseAdmin as any)
      .from("stealthwriter_proxy_sessions")
      .update({ status: "revoked" })
      .eq("id", row.id);
    return null;
  }

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

  await Promise.all([
    (supabaseAdmin as any)
      .from("stealthwriter_proxy_sessions")
      .update({ last_seen_at: nowIso })
      .eq("id", row.id),
    (supabaseAdmin as any)
      .from("stealthwriter_devices")
      .update({ last_seen_at: nowIso })
      .eq("id", registeredDevice.id),
  ]);

  return row;
}

export function rewriteStealthWriterBody(
  text: string,
  contentType: string,
  proxyBase = STEALTHWRITER_PROXY_BASE,
) {
  const escapedProxy = proxyBase.replaceAll("/", "\\/");
  let out = text
    .replaceAll(STEALTHWRITER_UPSTREAM_ORIGIN, proxyBase)
    .replaceAll(
      "https:\\/\\/stealthwriter.ai",
      escapedProxy,
    );

  // AWS asset_domains parity, but kept fixed-host: only first-party
  // *.stealthwriter.ai hosts from the server allow-list can be routed.
  for (const host of stealthWriterAllowedAssetHosts()) {
    const routed = `${proxyBase}/__host/${host}`;
    out = out
      .replaceAll(`https://${host}`, routed)
      .replaceAll(
        `https:\\/\\/${host}`,
        routed.replaceAll("/", "\\/"),
      );
  }

  if (contentType.includes("text/html")) {
    out = out
      .replace(
        /(<(?:script|img|link|a|form|source|video|audio)[^>]+(?:src|href|action|poster)=["'])\/(?!\/)/gi,
        `$1${proxyBase}/`,
      )
      .replace(
        /<head([^>]*)>/i,
        `<head$1><base href="${proxyBase}/"><script src="/api/stealthwriter-proxy-bootstrap"></script>`,
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

export function rewriteStealthWriterLocation(
  location: string,
  baseOrigin = STEALTHWRITER_UPSTREAM_ORIGIN,
  proxyBase = STEALTHWRITER_PROXY_BASE,
) {
  const absolute = new URL(location, baseOrigin);
  if (absolute.origin === STEALTHWRITER_UPSTREAM_ORIGIN) {
    return `${proxyBase}${absolute.pathname}${absolute.search}${absolute.hash}`;
  }
  if (absolute.protocol === "https:" && stealthWriterAllowedAssetHosts().includes(absolute.hostname)) {
    return `${proxyBase}/__host/${absolute.hostname}${absolute.pathname}${absolute.search}${absolute.hash}`;
  }
  return null;
}

function upstreamHeaders(
  request: Request,
  cookieHeader: string,
  targetOrigin = STEALTHWRITER_UPSTREAM_ORIGIN,
  includeMasterCookie = true,
  proxyBase = STEALTHWRITER_PROXY_BASE,
) {
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
  h.set("Origin", targetOrigin);

  const incomingReferer = request.headers.get("referer");
  let referer = `${targetOrigin}/`;
  if (incomingReferer) {
    try {
      const r = new URL(incomingReferer);
      const proxiedPath =
        proxyBase === ""
          ? r.pathname
          : r.pathname.startsWith(proxyBase)
            ? r.pathname.slice(proxyBase.length)
            : "";
      if (proxiedPath) {
        const hostPrefix = proxiedPath.match(/^\/__host\/([^/]+)(\/.*)?$/);
        if (hostPrefix && `https://${hostPrefix[1]}` === targetOrigin) {
          referer = targetOrigin + (hostPrefix[2] || "/") + r.search;
        } else if (!hostPrefix && targetOrigin === STEALTHWRITER_UPSTREAM_ORIGIN) {
          referer = targetOrigin + (proxiedPath || "/") + r.search;
        }
      }
    } catch {
      /* use upstream root */
    }
  }
  h.set("Referer", referer);
  if (includeMasterCookie) h.set("Cookie", cookieHeader);
  return h;
}

export function extractStealthWriterCookieRotations(setCookies: string[]) {
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
  return updates;
}

export function applyStealthWriterCookieRotations(
  plaintext: string,
  setCookies: string[],
) {
  const current = JSON.parse(
    normaliseStealthWriterSession(plaintext),
  ) as Record<string, string>;
  const updates = extractStealthWriterCookieRotations(setCookies);
  let changed = false;
  for (const key of STEALTHWRITER_SESSION_KEYS) {
    if (updates[key] && updates[key] !== current[key]) {
      current[key] = updates[key];
      changed = true;
    }
  }
  return {
    changed,
    plaintext: normaliseStealthWriterSession(JSON.stringify(current)),
  };
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

  const updates = extractStealthWriterCookieRotations(setCookies);
  if (!Object.keys(updates).length) return;

  const encrypted = await loadEncryptedStealthWriterSession();
  const currentPlaintext = decryptStealthWriterSession(encrypted);
  const rotated = applyStealthWriterCookieRotations(currentPlaintext, setCookies);
  if (!rotated.changed) return;

  const nextEncrypted = encryptStealthWriterSession(rotated.plaintext);
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

  const dedicatedProxy = isDedicatedStealthWriterProxyRequest(request);
  const proxyBase = dedicatedProxy ? "" : STEALTHWRITER_PROXY_BASE;

  if (
    ((dedicatedProxy && url.pathname === "/__trst/enter") ||
      (!dedicatedProxy && url.pathname === STEALTHWRITER_PROXY_BASE)) &&
    ticket
  ) {
    return exchangeLaunchTicket(request, ticket);
  }

  let proxySession;
  try {
    proxySession = await requireProxySession(request);
  } catch {
    return unavailable();
  }
  if (!proxySession) return unauthorized();

  const userId = String(proxySession.user_id);

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

  const suffix = dedicatedProxy
    ? url.pathname
    : url.pathname.startsWith(STEALTHWRITER_PROXY_BASE)
      ? url.pathname.slice(STEALTHWRITER_PROXY_BASE.length)
      : "";

  // Internal AWS-parity usage/status endpoint consumed by the injected widget.
  if (suffix === "/__trst/usage") {
    if (request.method !== "GET") {
      return new Response("Method not allowed", { status: 405, headers: standardHeaders() });
    }
    try {
      const [snapshot, userLabel] = await Promise.all([
        getStealthWriterUsageSnapshot(userId),
        getStealthWriterUserLabel(userId),
      ]);
      return Response.json(
        { ...snapshot, user_label: userLabel },
        { headers: standardHeaders("application/json; charset=utf-8") },
      );
    } catch {
      return unavailable();
    }
  }

  let targetOrigin = STEALTHWRITER_UPSTREAM_ORIGIN;
  let targetPath = suffix || STEALTHWRITER_LANDING_PATH;
  let isSecondaryHost = false;

  const routedHost = targetPath.match(/^\/__host\/([^/]+)(\/.*)?$/);
  if (routedHost) {
    const host = routedHost[1].toLowerCase();
    if (!stealthWriterAllowedAssetHosts().includes(host)) {
      return forbidden("This StealthWriter asset host is not allowed.");
    }
    targetOrigin = `https://${host}`;
    targetPath = routedHost[2] || "/";
    isSecondaryHost = true;
  }

  const target = new URL(
    targetPath.startsWith("/") ? targetPath : `/${targetPath}`,
    targetOrigin,
  );
  target.search = url.search;

  let controls;
  try {
    controls = await ensureStealthWriterUserControls(userId);
  } catch {
    return unavailable();
  }
  const grantedFeatures = grantedStealthWriterFeatures(controls);
  if (!grantedFeatures.length) {
    return forbidden("You do not have an active StealthWriter feature.");
  }

  if (!isSecondaryHost) {
    // AWS Step 3: master-account surfaces remain blocked even if linked.
    if (isBlockedStealthWriterPath(target.pathname)) {
      return forbidden("This StealthWriter account action is disabled.");
    }

    // AWS Step 3.5: real page navigations are default-deny. A user can only
    // open common paths plus the exact feature pages they were granted.
    if (
      request.headers.get("sec-fetch-dest") === "document" &&
      !isAllowedStealthWriterDocumentPath(target.pathname, grantedFeatures)
    ) {
      const landing = pickStealthWriterLandingPath(grantedFeatures);
      const h = standardHeaders();
      h.set("Location", `${proxyBase}${landing}`);
      return new Response(null, { status: 302, headers: h });
    }

    // AWS feature API gate + daily counters. Humanizer and AI Detector have
    // independent limits. Rehumanize is a free repeat exactly like the source.
    const usageFeature = featureForStealthWriterUsagePath(target.pathname);
    if (
      usageFeature &&
      !["GET", "HEAD", "OPTIONS"].includes(request.method)
    ) {
      if (!grantedFeatures.includes(usageFeature)) {
        return forbidden("You do not have access to this StealthWriter feature.");
      }
      try {
        const usage = await consumeStealthWriterUsage(
          userId,
          usageFeature,
          isFreeStealthWriterRehumanize(usageFeature, request),
        );
        if (!usage.allowed) {
          return new Response(
            `Daily limit reached (${usage.dailyLimit}/day). Please try again tomorrow.`,
            { status: 429, headers: standardHeaders("text/plain; charset=utf-8") },
          );
        }
      } catch {
        return unavailable();
      }
    }
  }

  let cookieHeader = "";
  if (!isSecondaryHost) {
    try {
      const encrypted = await loadEncryptedStealthWriterSession();
      const plaintext = decryptStealthWriterSession(encrypted);
      cookieHeader = buildStealthWriterCookieHeader(plaintext);
    } catch {
      return unavailable();
    }
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
      headers: upstreamHeaders(
        request,
        cookieHeader,
        targetOrigin,
        !isSecondaryHost,
        proxyBase,
      ),
      body,
      redirect: "manual",
    });
  } catch {
    return unavailable();
  }

  // Only the canonical StealthWriter origin is allowed to rotate the master
  // Better Auth session. Secondary asset hosts never receive or update it.
  if (!isSecondaryHost) {
    try {
      await persistRotatedStealthWriterCookies(upstream);
    } catch {
      return unavailable();
    }
    if (isStealthWriterUpstreamAuthRejected(upstream.status)) return unavailable();
  }

  if (upstream.status >= 300 && upstream.status < 400) {
    const location = upstream.headers.get("location") ?? "/";
    const rewritten = rewriteStealthWriterLocation(location, targetOrigin, proxyBase);
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

  // Never forward upstream Set-Cookie. The customer browser receives only
  // Top Rated SEO Tools proxy/device cookies, never StealthWriter master auth.
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
    return new Response(rewriteStealthWriterBody(text, contentType, proxyBase), {
      status: upstream.status,
      headers,
    });
  }

  return new Response(await upstream.arrayBuffer(), {
    status: upstream.status,
    headers,
  });
}
