/*
 * Phase 3 — ChatGPT server-side one-click proxy for authorised internal writers.
 *
 * Trust boundaries:
 * - customer/writer entitlement is re-checked server-side;
 * - the Phase 2 ChatGPT session is decrypted only on the server;
 * - upstream ChatGPT cookies are never returned to the writer;
 * - this is a fixed-host proxy for chatgpt.com, never an open proxy;
 * - browser-storage state remains in the vault and is not exposed client-side.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash, randomBytes } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  decryptChatGptSession,
  encryptChatGptSession,
  normaliseChatGptSession,
  type ChatGptSessionState,
} from "@/lib/chatgpt-session.server";
import {
  assertChatGptLaunchRateLimit,
  ensureChatGptUserControls,
  isBlockedChatGptDocumentPath,
  isChatGptDocumentRequest,
  isValidChatGptDeviceFingerprint,
  registerOrTouchChatGptDevice,
  CHATGPT_APP_DEVICE_COOKIE,
  CHATGPT_DEVICE_COOKIE,
} from "@/lib/chatgpt-controls.server";

export const CHATGPT_PROXY_BASE = "/api/chatgpt-proxy";
export const CHATGPT_LANDING_PATH = "/";
export const CHATGPT_UPSTREAM_ORIGIN = "https://chatgpt.com";
export const CHATGPT_PROXY_COOKIE = "trst_cg_proxy";
export const CHATGPT_HANDOFF_TTL_SECONDS = 60;
const MAX_REQUEST_BYTES = 25 * 1024 * 1024;

// ---- Performance caches ----------------------------------------------------
// Every ChatGPT page pulls ~40 assets and dozens of API calls through this
// proxy. Re-validating the writer session (8+ database round trips) and
// re-loading the vault on every one made first loads take 20s+. Validated
// sessions and the vault are cached briefly; revocations still apply within
// CHATGPT_SESSION_CACHE_MS.
const CHATGPT_SESSION_CACHE_MS = 30_000;
const CHATGPT_VAULT_CACHE_MS = 30_000;
const CHATGPT_ASSET_CACHE_MAX_BYTES = 96 * 1024 * 1024;
const proxySessionCache = new Map<string, { row: any; until: number }>();
let vaultCache: { value: string; until: number } | null = null;
type CachedAsset = { body: string | ArrayBuffer; contentType: string; bytes: number };
const assetCache = new Map<string, CachedAsset>();
let assetCacheBytes = 0;

export function isImmutableChatGPTAssetPath(targetOrigin: string, pathname: string) {
  return targetOrigin === CHATGPT_UPSTREAM_ORIGIN && pathname.startsWith("/cdn/assets/");
}

function getCachedAsset(key: string) {
  const hit = assetCache.get(key);
  if (hit) {
    assetCache.delete(key);
    assetCache.set(key, hit); // LRU refresh
  }
  return hit;
}

function putCachedAsset(key: string, asset: CachedAsset) {
  if (asset.bytes > 16 * 1024 * 1024) return;
  const old = assetCache.get(key);
  if (old) {
    assetCacheBytes -= old.bytes;
    assetCache.delete(key);
  }
  assetCache.set(key, asset);
  assetCacheBytes += asset.bytes;
  for (const [k, v] of assetCache) {
    if (assetCacheBytes <= CHATGPT_ASSET_CACHE_MAX_BYTES) break;
    assetCache.delete(k);
    assetCacheBytes -= v.bytes;
  }
}

export function chatgptProxyPublicOrigin() {
  const raw = String(process.env.CHATGPT_PROXY_PUBLIC_ORIGIN ?? "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function isDedicatedChatGPTProxyRequest(request: Request) {
  const publicOrigin = chatgptProxyPublicOrigin();
  return !!publicOrigin && new URL(request.url).origin === publicOrigin;
}

function proxyBaseForRequest(request: Request) {
  return isDedicatedChatGPTProxyRequest(request) ? "" : CHATGPT_PROXY_BASE;
}

function proxyCookiePathForRequest(request: Request) {
  return isDedicatedChatGPTProxyRequest(request) ? "/" : CHATGPT_PROXY_BASE;
}

// OpenAI's per-region file storage (uploads, downloads, generated images),
// e.g. sdmntprcentralus.oaiusercontent.com. It only accepts browser uploads
// from chatgpt.com (CORS), so on our proxy host those requests are routed
// through /__host/<host>/... like other asset hosts.
export function isChatGPTUserContentHost(host: string) {
  const h = host.toLowerCase();
  return /^[a-z0-9-]+\.oaiusercontent\.com$/.test(h);
}

export function isAllowedChatGPTRoutedHost(host: string) {
  return chatgptAllowedAssetHosts().includes(host.toLowerCase()) || isChatGPTUserContentHost(host);
}

export function chatgptAllowedAssetHosts() {
  const configured = String(process.env.CHATGPT_ASSET_HOSTS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return Array.from(new Set(["cdn.oaistatic.com", "persistent.oaistatic.com", ...configured])).filter(
    (host) =>
      (host.endsWith(".chatgpt.com") && host !== "chatgpt.com") ||
      host === "oaistatic.com" ||
      host.endsWith(".oaistatic.com"),
  );
}

type AccessSource = {
  kind: "order" | "grant";
  id: string;
};

export function isUnexpiredChatGPTAccess(
  value: string | null | undefined,
  nowMs = Date.now(),
) {
  return !value || new Date(value).getTime() > nowMs;
}

export function isActiveChatGPTOrder(
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
    isUnexpiredChatGPTAccess(order.expires_at, nowMs) &&
    (String(order.access_type ?? "shared") !== "private" ||
      String(order.fulfilment_status ?? "") === "active")
  );
}

export function isActiveChatGPTGrant(
  grant: { expires_at?: string | null; status?: string | null },
  nowMs = Date.now(),
) {
  return (
    grant.status === "active" &&
    isUnexpiredChatGPTAccess(grant.expires_at, nowMs)
  );
}

export function hashChatGPTProxyToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function chatgptProxySessionHours() {
  const raw = Number(process.env.CHATGPT_PROXY_SESSION_HOURS ?? 12);
  if (!Number.isFinite(raw)) return 12;
  return Math.max(1, Math.min(24, Math.round(raw)));
}

function cookieMatchesChatGPTTarget(
  cookie: ChatGptSessionState["cookies"][number],
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

export function buildChatGPTCookieHeader(
  plaintext: string,
  targetUrl = CHATGPT_UPSTREAM_ORIGIN + "/",
  requireSession = true,
) {
  const parsed = JSON.parse(
    normaliseChatGptSession(plaintext),
  ) as ChatGptSessionState;
  const target = new URL(targetUrl);

  const cookies = parsed.cookies.filter((cookie) =>
    cookieMatchesChatGPTTarget(cookie, target),
  );

  if (requireSession && cookies.length === 0) {
    throw new Error("The stored ChatGPT session has no reusable first-party cookie for this target.");
  }

  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

async function requireToolEnabled() {
  const { data, error } = await (supabaseAdmin as any)
    .from("tool_settings")
    .select("enabled, one_click_auth_enabled")
    .eq("tool_slug", "chatgpt")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data?.enabled === false || !data?.one_click_auth_enabled) {
    throw new Error("ChatGPT One-Click Login is not enabled.");
  }
}

async function findActiveAccess(userId: string): Promise<AccessSource | null> {
  const { data: orders, error: orderError } = await (supabaseAdmin as any)
    .from("tool_orders")
    .select("id, expires_at, access_type, fulfilment_status, payment_status, status")
    .eq("user_id", userId)
    .eq("tool_slug", "chatgpt")
    .eq("status", "approved")
    .order("created_at", { ascending: false })
    .limit(20);
  if (orderError) throw new Error(orderError.message);

  const activeOrder = ((orders ?? []) as any[]).find((order) =>
    isActiveChatGPTOrder(order),
  );
  if (activeOrder) return { kind: "order", id: String(activeOrder.id) };

  const { data: grants, error: grantError } = await (supabaseAdmin as any)
    .from("tool_access_grants")
    .select("id, expires_at, status")
    .eq("user_id", userId)
    .eq("tool_slug", "chatgpt")
    .eq("status", "active")
    .order("granted_at", { ascending: false })
    .limit(20);
  if (grantError) throw new Error(grantError.message);

  const activeGrant = ((grants ?? []) as any[]).find((grant) =>
    isActiveChatGPTGrant(grant),
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
      .eq("tool_slug", "chatgpt")
      .maybeSingle();
    return !!(data && isActiveChatGPTOrder(data));
  }

  const { data } = await (supabaseAdmin as any)
    .from("tool_access_grants")
    .select("expires_at, status")
    .eq("id", source.id)
    .eq("user_id", userId)
    .eq("tool_slug", "chatgpt")
    .maybeSingle();
  return !!(data && isActiveChatGPTGrant(data));
}

async function loadEncryptedChatGPTSession() {
  if (vaultCache && vaultCache.until > Date.now()) return vaultCache.value;
  const { data, error } = await (supabaseAdmin as any)
    .from("tool_authorized_sessions")
    .select("encrypted_payload, status")
    .eq("tool_slug", "chatgpt")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.encrypted_payload || data.status !== "stored") {
    throw new Error(
      "ChatGPT needs to be refreshed by Admin before writers can launch it.",
    );
  }
  vaultCache = { value: String(data.encrypted_payload), until: Date.now() + CHATGPT_VAULT_CACHE_MS };
  return vaultCache.value;
}

export function extractChatGPTCookieRotations(
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

export function applyChatGPTCookieRotations(
  plaintext: string,
  setCookies: string[],
) {
  const current = JSON.parse(
    normaliseChatGptSession(plaintext),
  ) as ChatGptSessionState;
  const updates = extractChatGPTCookieRotations(
    setCookies,
    current.cookies.map((cookie) => cookie.name),
  );
  let changed = false;

  for (const cookie of current.cookies) {
    const nextValue = updates[cookie.name];
    if (nextValue && nextValue !== cookie.value) {
      cookie.value = nextValue;
      changed = true;
    }
  }

  return {
    changed,
    plaintext: normaliseChatGptSession(JSON.stringify(current)),
  };
}

async function persistRotatedChatGPTCookies(upstream: Response) {
  const headers = upstream.headers as Headers & { getSetCookie?: () => string[] };
  const setCookies =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : (() => {
          const raw = headers.get("set-cookie");
          return raw ? [raw] : [];
        })();
  if (!setCookies.length) return;

  const encrypted = await loadEncryptedChatGPTSession();
  const currentPlaintext = decryptChatGptSession(encrypted);
  const rotated = applyChatGPTCookieRotations(currentPlaintext, setCookies);
  if (!rotated.changed) return;

  const nowIso = new Date().toISOString();
  const nextEncrypted = encryptChatGptSession(rotated.plaintext);
  vaultCache = { value: nextEncrypted, until: Date.now() + CHATGPT_VAULT_CACHE_MS };
  const { error } = await (supabaseAdmin as any)
    .from("tool_authorized_sessions")
    .update({
      encrypted_payload: nextEncrypted,
      rotated_at: nowIso,
      updated_at: nowIso,
    })
    .eq("tool_slug", "chatgpt")
    .eq("status", "stored");
  if (error) throw new Error(error.message);
}

function classifyChatGPT403(upstream: Response): ChatGPTProxyDiagnosticCode {
  const mitigated = String(upstream.headers.get("cf-mitigated") ?? "").toLowerCase();
  if (mitigated === "challenge") return "upstream_403_edge_challenge";
  return "upstream_403";
}

type ChatGPTProxyDiagnosticCode =
  | "session_decrypt_failed"
  | "session_cookie_missing"
  | "upstream_network_error"
  | "upstream_401"
  | "upstream_403"
  | "upstream_403_edge_challenge"
  | "upstream_external_redirect"
  | "upstream_redirect"
  | "upstream_ok";

const okDiagnosticAt = new Map<string, number>();
function shouldRecordOkDiagnostic(sessionId: string) {
  const last = okDiagnosticAt.get(sessionId) ?? 0;
  if (Date.now() - last < 60_000) return false;
  if (okDiagnosticAt.size > 5000) okDiagnosticAt.clear();
  okDiagnosticAt.set(sessionId, Date.now());
  return true;
}

async function recordChatGPTProxyDiagnostic(
  proxySessionId: string,
  code: ChatGPTProxyDiagnosticCode,
  upstreamStatus: number | null = null,
) {
  try {
    await (supabaseAdmin as any)
      .from("chatgpt_proxy_sessions")
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

export async function createChatGPTProxyLaunch(
  userId: string,
  appDeviceFingerprint?: string | null,
) {
  await requireToolEnabled();

  const controls = await ensureChatGptUserControls(userId);
  if (controls.status !== "active") {
    throw new Error("Your ChatGPT access is suspended. Please contact Admin.");
  }
  await assertChatGptLaunchRateLimit(userId);

  const source = await findActiveAccess(userId);
  if (!source) {
    throw new Error(
      "An active ChatGPT subscription or grant is required for One-Click Login.",
    );
  }

  // Fail before issuing a ticket if Admin has not stored a usable session.
  await loadEncryptedChatGPTSession();

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(
    Date.now() + CHATGPT_HANDOFF_TTL_SECONDS * 1000,
  ).toISOString();

  const { error } = await (supabaseAdmin as any)
    .from("chatgpt_proxy_sessions")
    .insert({
      token_hash: hashChatGPTProxyToken(token),
      user_id: userId,
      source_kind: source.kind,
      source_id: source.id,
      status: "issued",
      device_fingerprint: isValidChatGptDeviceFingerprint(appDeviceFingerprint)
        ? appDeviceFingerprint
        : null,
      expires_at: expiresAt,
    });
  if (error) throw new Error("Could not start ChatGPT. Please try again.");

  await (supabaseAdmin as any)
    .from("tool_usage")
    .insert({ tool_slug: "chatgpt", user_id: userId });

  const publicOrigin = chatgptProxyPublicOrigin();
  return {
    launchUrl: publicOrigin
      ? `${publicOrigin}/__trst/enter?ticket=${encodeURIComponent(token)}`
      : `${CHATGPT_PROXY_BASE}?ticket=${encodeURIComponent(token)}`,
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

export function readChatGptAppDeviceFingerprint(request: Request) {
  const value = parseCookieHeader(request).get(CHATGPT_APP_DEVICE_COOKIE);
  return isValidChatGptDeviceFingerprint(value) ? String(value) : null;
}

function appDeviceCookie(fingerprint: string) {
  return [
    `${CHATGPT_APP_DEVICE_COOKIE}=${fingerprint}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Expires=${new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toUTCString()}`,
  ].join("; ");
}

export function ensureChatGptAppDeviceResponse(request: Request) {
  const existing = readChatGptAppDeviceFingerprint(request);
  const fingerprint = existing ?? randomBytes(16).toString("hex");
  const headers = standardHeaders();
  if (!existing) headers.append("Set-Cookie", appDeviceCookie(fingerprint));
  return new Response(null, { status: 204, headers });
}

function proxyCookie(token: string, expiresAt: string, cookiePath: string) {
  return [
    `${CHATGPT_PROXY_COOKIE}=${token}`,
    `Path=${cookiePath}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Expires=${new Date(expiresAt).toUTCString()}`,
  ].join("; ");
}

function deviceCookie(fingerprint: string, cookiePath: string) {
  return [
    `${CHATGPT_DEVICE_COOKIE}=${fingerprint}`,
    `Path=${cookiePath}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Expires=${new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toUTCString()}`,
  ].join("; ");
}

async function exchangeLaunchTicket(request: Request, ticket: string) {
  const nowIso = new Date().toISOString();
  const { data: row } = await (supabaseAdmin as any)
    .from("chatgpt_proxy_sessions")
    .select("id, user_id, source_kind, source_id, expires_at, status, device_fingerprint")
    .eq("token_hash", hashChatGPTProxyToken(ticket))
    .eq("status", "issued")
    .gt("expires_at", nowIso)
    .maybeSingle();

  if (!row) return forbidden("This ChatGPT launch link is no longer valid.");

  await requireToolEnabled();
  const userId = String(row.user_id);
  const stillActive = await sourceStillActive(userId, {
    kind: row.source_kind as "order" | "grant",
    id: String(row.source_id),
  });
  if (!stillActive) {
    await (supabaseAdmin as any)
      .from("chatgpt_proxy_sessions")
      .update({ status: "revoked" })
      .eq("id", row.id);
    return forbidden("Your ChatGPT access is no longer active.");
  }

  const cookieDevice = parseCookieHeader(request).get(CHATGPT_DEVICE_COOKIE);
  const deviceFingerprint = isValidChatGptDeviceFingerprint(row.device_fingerprint)
    ? String(row.device_fingerprint)
    : isValidChatGptDeviceFingerprint(cookieDevice)
      ? String(cookieDevice)
      : randomBytes(16).toString("hex");

  try {
    const deviceGate = await registerOrTouchChatGptDevice(
      userId,
      deviceFingerprint,
      "Device",
    );
    if (!deviceGate.ok) {
      return forbidden(
        "Your ChatGPT access is suspended because the device limit was exceeded. Please contact Admin.",
      );
    }
  } catch {
    return unavailable();
  }

  try {
    await loadEncryptedChatGPTSession();
  } catch {
    return unavailable();
  }

  const sessionToken = randomBytes(32).toString("base64url");
  const sessionExpiresAt = new Date(
    Date.now() + chatgptProxySessionHours() * 60 * 60 * 1000,
  ).toISOString();

  const { data: activated, error } = await (supabaseAdmin as any)
    .from("chatgpt_proxy_sessions")
    .update({
      token_hash: hashChatGPTProxyToken(sessionToken),
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
  if (error || !activated) {
    return forbidden("This ChatGPT launch link was already used.");
  }

  const proxyBase = proxyBaseForRequest(request);
  const cookiePath = proxyCookiePathForRequest(request);
  const target = new URL(
    `${proxyBase}${CHATGPT_LANDING_PATH}`,
    request.url,
  );
  const headers = standardHeaders();
  headers.set("Location", target.toString());
  headers.append(
    "Set-Cookie",
    proxyCookie(sessionToken, sessionExpiresAt, cookiePath),
  );
  headers.append("Set-Cookie", deviceCookie(deviceFingerprint, cookiePath));
  return new Response(null, { status: 302, headers });
}

async function requireProxySession(request: Request) {
  const cookies = parseCookieHeader(request);
  const token = cookies.get(CHATGPT_PROXY_COOKIE);
  const deviceFingerprint = cookies.get(CHATGPT_DEVICE_COOKIE);
  if (!token || !isValidChatGptDeviceFingerprint(deviceFingerprint)) return null;

  const cacheKey = `${hashChatGPTProxyToken(token)}:${deviceFingerprint}`;
  const cached = proxySessionCache.get(cacheKey);
  if (cached && cached.until > Date.now()) {
    if (new Date(String(cached.row.expires_at)).getTime() > Date.now()) return cached.row;
  }
  proxySessionCache.delete(cacheKey);

  const nowIso = new Date().toISOString();
  const { data: row } = await (supabaseAdmin as any)
    .from("chatgpt_proxy_sessions")
    .select("id, user_id, source_kind, source_id, expires_at, status, device_fingerprint")
    .eq("token_hash", hashChatGPTProxyToken(token))
    .eq("status", "active")
    .maybeSingle();

  if (!row || row.device_fingerprint !== deviceFingerprint) return null;
  if (new Date(String(row.expires_at)).getTime() <= Date.now()) {
    await (supabaseAdmin as any)
      .from("chatgpt_proxy_sessions")
      .update({ status: "expired" })
      .eq("id", row.id);
    return null;
  }

  await requireToolEnabled();

  const controls = await ensureChatGptUserControls(String(row.user_id));
  if (controls.status !== "active") {
    await (supabaseAdmin as any)
      .from("chatgpt_proxy_sessions")
      .update({ status: "revoked" })
      .eq("id", row.id);
    return null;
  }

  const { data: registeredDevice } = await (supabaseAdmin as any)
    .from("chatgpt_devices")
    .select("id")
    .eq("user_id", row.user_id)
    .eq("device_fingerprint", deviceFingerprint)
    .maybeSingle();
  if (!registeredDevice?.id) {
    await (supabaseAdmin as any)
      .from("chatgpt_proxy_sessions")
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
      .from("chatgpt_proxy_sessions")
      .update({ status: "revoked" })
      .eq("id", row.id);
    return null;
  }

  await (supabaseAdmin as any)
    .from("chatgpt_devices")
    .update({ last_seen_at: nowIso })
    .eq("user_id", row.user_id)
    .eq("device_fingerprint", deviceFingerprint);

  await (supabaseAdmin as any)
    .from("chatgpt_proxy_sessions")
    .update({ last_seen_at: nowIso })
    .eq("id", row.id);

  if (proxySessionCache.size > 5000) proxySessionCache.clear();
  proxySessionCache.set(cacheKey, { row, until: Date.now() + CHATGPT_SESSION_CACHE_MS });
  return row;
}

// ChatGPT's client picks its API base from the hostname: "/backend-api" on
// chatgpt.com, otherwise "/__codex-api" (and "/__codex-anon-api" for logged-out
// calls). Those prefixes only exist on chatgpt.com as SPA fallbacks (HTML 200 /
// plain 400), so on our proxy host map them back to the real API paths.
export function mapChatGPTClientApiPath(path: string) {
  const m = path.match(/^\/(__codex-api|__codex-anon-api)(?=\/|$)(.*)$/);
  if (!m) return path;
  return (m[1] === "__codex-api" ? "/backend-api" : "/backend-anon") + (m[2] || "");
}

export function rewriteChatGPTBody(
  text: string,
  contentType: string,
  proxyBase = CHATGPT_PROXY_BASE,
  publicOrigin = "",
) {
  // Absolute upstream URLs must stay absolute: ChatGPT's client calls
  // `new URL("https://chatgpt.com/...")` without a base, so rewriting the
  // origin to "" (dedicated host) or a bare path throws "Invalid URL" and
  // the app never hydrates. Pass the proxy's public origin to keep them valid.
  const absoluteBase = `${publicOrigin}${proxyBase}`;
  const escapedProxy = absoluteBase.replaceAll("/", "\\/");
  let out = text
    .replaceAll(CHATGPT_UPSTREAM_ORIGIN, absoluteBase)
    .replaceAll("https:\\/\\/chatgpt.com", escapedProxy);

  for (const host of chatgptAllowedAssetHosts()) {
    const routed = `${absoluteBase}/__host/${host}`;
    out = out
      .replaceAll(`https://${host}`, routed)
      .replaceAll(
        `https:\\/\\/${host}`,
        routed.replaceAll("/", "\\/"),
      );
  }
  out = out
    .replace(
      /https:\/\/([a-z0-9-]+\.oaiusercontent\.com)/g,
      `${absoluteBase}/__host/$1`,
    )
    .replace(
      /https:\\\/\\\/([a-z0-9-]+\.oaiusercontent\.com)/g,
      `${absoluteBase.replaceAll("/", "\\/")}\\/__host\\/$1`,
    );

  if (contentType.includes("text/html")) {
    out = out
      .replace(
        /(<(?:script|img|link|a|form|source|video|audio)[^>]+(?:src|href|action|poster)=["'])\/(?!\/)/gi,
        `$1${proxyBase}/`,
      )
      .replace(
        /<head([^>]*)>/i,
        `<head$1><base href="${proxyBase}/"><script src="/api/chatgpt-proxy-bootstrap"></script>`,
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

export function buildChatGPTUpstreamUrl(
  requestUrl: string,
  targetPath: string,
  targetOrigin = CHATGPT_UPSTREAM_ORIGIN,
) {
  const incoming = new URL(requestUrl);
  const target = new URL(targetOrigin);
  target.pathname = targetPath.startsWith("/") ? targetPath : `/${targetPath}`;
  target.search = incoming.search;
  target.searchParams.delete("ticket");
  return target;
}

export function rewriteChatGPTLocation(
  location: string,
  baseOrigin = CHATGPT_UPSTREAM_ORIGIN,
  proxyBase = CHATGPT_PROXY_BASE,
) {
  const absolute = new URL(location, baseOrigin);
  if (absolute.origin === CHATGPT_UPSTREAM_ORIGIN) {
    return `${proxyBase}${absolute.pathname}${absolute.search}${absolute.hash}`;
  }
  if (
    absolute.protocol === "https:" &&
    isAllowedChatGPTRoutedHost(absolute.hostname)
  ) {
    return `${proxyBase}/__host/${absolute.hostname}${absolute.pathname}${absolute.search}${absolute.hash}`;
  }
  return null;
}

// ChatGPT's web app authenticates every /backend-api call with
// `Authorization: Bearer <accessToken>` (obtained from /api/auth/session) and
// attaches device, client-version and sentinel headers. The session cookie
// alone is rejected with 401, so these must pass through to chatgpt.com.
const CHATGPT_FORWARDED_HEADER_PREFIXES = ["oai-", "openai-sentinel-", "x-openai-"];

export function isForwardedChatGPTClientHeader(name: string) {
  const lower = name.toLowerCase();
  return (
    lower === "authorization" ||
    CHATGPT_FORWARDED_HEADER_PREFIXES.some((prefix) => lower.startsWith(prefix))
  );
}

export function upstreamHeaders(
  request: Request,
  cookieHeader: string,
  targetOrigin = CHATGPT_UPSTREAM_ORIGIN,
  includeMasterCookie = true,
  proxyBase = CHATGPT_PROXY_BASE,
) {
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
  // Only first-party chatgpt.com calls carry the account's bearer token;
  // never leak it to secondary asset hosts.
  if (targetOrigin === CHATGPT_UPSTREAM_ORIGIN) {
    for (const [name, value] of request.headers) {
      if (value && isForwardedChatGPTClientHeader(name)) h.set(name, value);
    }
  } else if (isChatGPTUserContentHost(new URL(targetOrigin).host)) {
    // Azure blob uploads need their x-ms-* headers (blob type, version, etc.).
    for (const [name, value] of request.headers) {
      if (value && name.toLowerCase().startsWith("x-ms-")) h.set(name, value);
    }
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
        } else if (!hostPrefix && targetOrigin === CHATGPT_UPSTREAM_ORIGIN) {
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

function forbidden(message = "ChatGPT access is not available.") {
  return new Response(message, {
    status: 403,
    headers: standardHeaders("text/plain; charset=utf-8"),
  });
}

function unauthorized() {
  return new Response(
    "Open ChatGPT from your Top Rated SEO Tools account.",
    {
      status: 401,
      headers: standardHeaders("text/plain; charset=utf-8"),
    },
  );
}

function unavailable() {
  return new Response(
    "ChatGPT is temporarily unavailable. Admin may need to refresh the authorised session.",
    {
      status: 503,
      headers: standardHeaders("text/plain; charset=utf-8"),
    },
  );
}

export async function handleChatGPTProxyRequest(request: Request) {
  const url = new URL(request.url);
  const ticket = url.searchParams.get("ticket");
  const dedicatedProxy = isDedicatedChatGPTProxyRequest(request);
  const proxyBase = dedicatedProxy ? "" : CHATGPT_PROXY_BASE;

  if (
    ((dedicatedProxy && url.pathname === "/__trst/enter") ||
      (!dedicatedProxy && url.pathname === CHATGPT_PROXY_BASE)) &&
    ticket
  ) {
    return exchangeLaunchTicket(request, ticket);
  }

  // Read the request body before any slow checks: the incoming stream can be
  // torn down while we wait ("Response body object should not be disturbed").
  let body: ArrayBuffer | undefined;
  if (!["GET", "HEAD"].includes(request.method)) {
    const declared = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) {
      return new Response("Request too large", {
        status: 413,
        headers: standardHeaders("text/plain; charset=utf-8"),
      });
    }
    let bytes: ArrayBuffer;
    try {
      bytes = await request.arrayBuffer();
    } catch {
      return new Response("Request body unavailable", {
        status: 400,
        headers: standardHeaders("text/plain; charset=utf-8"),
      });
    }
    if (bytes.byteLength > MAX_REQUEST_BYTES) {
      return new Response("Request too large", {
        status: 413,
        headers: standardHeaders("text/plain; charset=utf-8"),
      });
    }
    body = bytes;
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

  const suffix = dedicatedProxy
    ? url.pathname
    : url.pathname.startsWith(CHATGPT_PROXY_BASE)
      ? url.pathname.slice(CHATGPT_PROXY_BASE.length)
      : "";

  let targetOrigin = CHATGPT_UPSTREAM_ORIGIN;
  let targetPath = mapChatGPTClientApiPath(suffix || CHATGPT_LANDING_PATH);
  let isSecondaryHost = false;

  const routedHost = targetPath.match(/^\/__host\/([^/]+)(\/.*)?$/);
  if (routedHost) {
    const host = routedHost[1].toLowerCase();
    if (!isAllowedChatGPTRoutedHost(host)) {
      return forbidden("This ChatGPT asset host is not allowed.");
    }
    targetOrigin = `https://${host}`;
    targetPath = routedHost[2] || "/";
    isSecondaryHost = true;
  }

  const target = buildChatGPTUpstreamUrl(
    request.url,
    targetPath,
    targetOrigin,
  );

  if (
    targetOrigin === CHATGPT_UPSTREAM_ORIGIN &&
    isChatGptDocumentRequest(request) &&
    isBlockedChatGptDocumentPath(target.pathname)
  ) {
    return forbidden("This ChatGPT account, settings, or billing page is restricted.");
  }

  const publicOrigin = new URL(request.url).origin;
  const assetCacheable =
    request.method === "GET" &&
    ((isSecondaryHost && !isChatGPTUserContentHost(target.host)) ||
      isImmutableChatGPTAssetPath(targetOrigin, target.pathname));
  const assetKey = `${publicOrigin}${proxyBase}|${target.toString()}`;
  if (assetCacheable) {
    const hit = getCachedAsset(assetKey);
    if (hit) {
      const h = standardHeaders(hit.contentType);
      h.set("Cache-Control", "private, max-age=31536000, immutable");
      return new Response(hit.body, { status: 200, headers: h });
    }
  }

  let cookieHeader = "";
  try {
    const encrypted = await loadEncryptedChatGPTSession();
    const plaintext = decryptChatGptSession(encrypted);
    cookieHeader = buildChatGPTCookieHeader(
      plaintext,
      target.toString(),
      !isSecondaryHost,
    );
  } catch {
    await recordChatGPTProxyDiagnostic(
      String(proxySession.id),
      "session_decrypt_failed",
    );
    return unavailable();
  }
  if (!isSecondaryHost && !cookieHeader) {
    await recordChatGPTProxyDiagnostic(
      String(proxySession.id),
      "session_cookie_missing",
    );
    return unavailable();
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers: upstreamHeaders(
        request,
        cookieHeader,
        targetOrigin,
        !!cookieHeader,
        proxyBase,
      ),
      body,
      redirect: "manual",
    });
  } catch {
    await recordChatGPTProxyDiagnostic(
      String(proxySession.id),
      "upstream_network_error",
    );
    return unavailable();
  }

  try {
    await persistRotatedChatGPTCookies(upstream);
  } catch {
    return unavailable();
  }

  if (!isSecondaryHost) {
    if (upstream.status === 401) {
      await recordChatGPTProxyDiagnostic(
        String(proxySession.id),
        "upstream_401",
        upstream.status,
      );
      return unavailable();
    }
    if (upstream.status === 403) {
      await recordChatGPTProxyDiagnostic(
        String(proxySession.id),
        classifyChatGPT403(upstream),
        upstream.status,
      );
      return unavailable();
    }
  }

  if (upstream.status >= 300 && upstream.status < 400) {
    const location = upstream.headers.get("location") ?? "/";
    const rewritten = rewriteChatGPTLocation(
      location,
      targetOrigin,
      proxyBase,
    );
    if (!rewritten) {
      await recordChatGPTProxyDiagnostic(
        String(proxySession.id),
        "upstream_external_redirect",
        upstream.status,
      );
      return unavailable();
    }
    await recordChatGPTProxyDiagnostic(
      String(proxySession.id),
      "upstream_redirect",
      upstream.status,
    );
    const h = standardHeaders();
    h.set("Location", rewritten);
    return new Response(null, { status: upstream.status, headers: h });
  }

  // Success diagnostics are throttled and never block the response.
  if (shouldRecordOkDiagnostic(String(proxySession.id))) {
    void recordChatGPTProxyDiagnostic(
      String(proxySession.id),
      "upstream_ok",
      upstream.status,
    );
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

  // ChatGPT responses can be streamed. Never buffer event streams;
  // forward the upstream ReadableStream directly so tokens reach the writer
  // incrementally. Binary/non-rewriteable bodies are streamed for the same reason.
  if (contentType.includes("text/event-stream")) {
    headers.set("Cache-Control", "no-store");
    return new Response(upstream.body, {
      status: upstream.status,
      headers,
    });
  }

  const isRewriteableText =
    contentType.includes("text/html") ||
    contentType.includes("text/css") ||
    contentType.includes("javascript") ||
    contentType.includes("application/json") ||
    contentType.includes("text/plain");

  const storeAsset = assetCacheable && upstream.status === 200;
  if (storeAsset) headers.set("Cache-Control", "private, max-age=31536000, immutable");

  if (isRewriteableText) {
    const text = await upstream.text();
    const rewritten = rewriteChatGPTBody(text, contentType, proxyBase, publicOrigin);
    if (storeAsset) {
      putCachedAsset(assetKey, { body: rewritten, contentType, bytes: rewritten.length * 2 });
    }
    return new Response(rewritten, {
      status: upstream.status,
      headers,
    });
  }

  if (storeAsset) {
    const bytes = await upstream.arrayBuffer();
    putCachedAsset(assetKey, { body: bytes, contentType, bytes: bytes.byteLength });
    return new Response(bytes, { status: upstream.status, headers });
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers,
  });
}

