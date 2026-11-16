/* Adapted from StealthWriter upstreamHeaders/rewriteBody/response forwarding. */
import { QUILLBOT_UPSTREAM_ORIGIN, QUILLBOT_TEST_PROXY_BASE, QUILLBOT_ALLOWED_SECONDARY_HOSTS, resolveQuillBotUpstreamPath, rewriteQuillBotUpstreamLocation } from "./quillbot-provider.server.ts";
import { normaliseQuillBotSession } from "./quillbot-session.server.ts";
export type QuillBotState = { cookie: string; useridtoken: string };
export function quillBotApplicationCookieHeader(raw: string) {
  // Browser verification cookies are not application authentication state.
  // Never replay them to work around an upstream verification challenge.
  return raw.split(";").filter(part => !/^(?:cf_clearance|__cf_bm|cf_chl_[^=]*)$/i.test(part.slice(0, part.indexOf("=")).trim())).join(";");
}
export function rotateQuillBotApplicationCookies(headers: Headers, current: QuillBotState, target: URL): QuillBotState {
  if (target.origin !== QUILLBOT_UPSTREAM_ORIGIN) return current;
  const tracked = new Map<string, string>();
  for (const part of quillBotApplicationCookieHeader(current.cookie).split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0) tracked.set(part.slice(0, eq).trim(), part.slice(eq + 1));
  }
  const updates = new Map<string, string>();
  for (const line of headers.getSetCookie()) {
    const parts = line.split(";");
    const pair = parts.shift()!;
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim(), value = pair.slice(eq + 1);
    if (!tracked.has(name) || /[\r\n\0]/.test(value)) continue;
    const domain = parts.find(p => /^\s*domain=/i.test(p))?.split("=")[1]?.trim().replace(/^\./, "").toLowerCase();
    if (domain && domain !== target.hostname) continue;
    const age = parts.find(p => /^\s*max-age=/i.test(p))?.split("=")[1]?.trim();
    const expires = parts.find(p => /^\s*expires=/i.test(p))?.slice(parts.find(p => /^\s*expires=/i.test(p))!.indexOf("=") + 1);
    const deleted = value === "" || (age !== undefined ? Number(age) <= 0 : !!expires && Date.parse(expires) <= Date.now());
    updates.set(name, deleted ? "" : value);
  }
  if (!updates.size) return current;
  const cookie = current.cookie.split(";").flatMap(part => {
    const eq = part.indexOf("="), name = part.slice(0, eq).trim();
    if (!updates.has(name)) return [part];
    const value = updates.get(name)!;
    return value === "" ? [] : [part.slice(0, eq + 1) + value];
  }).join(";");
  if (!quillBotApplicationCookieHeader(cookie).trim()) throw new Error("QuillBot application session expired.");
  return { ...current, cookie };
}
export function buildQuillBotUpstreamHeaders(request: Request, session: QuillBotState, target: URL) {
  const h = new Headers();
  for (const name of ["platform-type", "qb-product", "qb-dialect", "webapp-version", "accept", "accept-language", "content-type", "if-none-match", "if-modified-since", "range", "rsc", "next-router-state-tree", "next-router-prefetch", "next-url", "purpose", "x-nextjs-data", "sec-ch-ua", "sec-ch-ua-mobile", "sec-ch-ua-platform", "sec-fetch-dest", "sec-fetch-mode", "sec-fetch-site", "sec-fetch-user", "upgrade-insecure-requests", "user-agent"]) {
    const value = request.headers.get(name); if (value) h.set(name, value);
  }
  if (!h.has("accept-language")) h.set("accept-language", "en-US,en;q=0.9");
  h.set("accept-encoding", "identity");
  // Observed QuillBot media API is invoked by the canonical QuillBot web app.
  h.set("origin", QUILLBOT_UPSTREAM_ORIGIN);
  let ref = QUILLBOT_UPSTREAM_ORIGIN + "/paraphrasing-tool";
  try {
    const incoming = new URL(request.headers.get("referer") || request.url);
    const suffix = incoming.pathname.startsWith(QUILLBOT_TEST_PROXY_BASE + "/") ? incoming.pathname.slice(QUILLBOT_TEST_PROXY_BASE.length) : "/";
    const logical = resolveQuillBotUpstreamPath(suffix);
    if (logical?.origin === QUILLBOT_UPSTREAM_ORIGIN) ref = logical.origin + logical.pathname + incoming.search;
  } catch {}
  h.set("referer", ref);
  const isMain = target.origin === QUILLBOT_UPSTREAM_ORIGIN;
  const isMediaApi = target.origin === "https://media.quillbot.com" && target.pathname.startsWith("/api/");
  if (isMain || isMediaApi) h.set("cookie", quillBotApplicationCookieHeader(session.cookie));
  if (isMediaApi) h.set("useridtoken", session.useridtoken);
  return h;
}
export function rewriteQuillBotBody(text: string, contentType: string, base = QUILLBOT_TEST_PROXY_BASE) {
  let out = text.replaceAll(QUILLBOT_UPSTREAM_ORIGIN, base).replaceAll("https:\\/\\/quillbot.com", base.replaceAll("/", "\\/"));
  for (const host of QUILLBOT_ALLOWED_SECONDARY_HOSTS) {
    const mapped = base + "/__host/" + host;
    out = out.replaceAll("https://" + host, mapped).replaceAll("https:\\/\\/" + host, mapped.replaceAll("/", "\\/"));
  }
  out = out.replace(/(?<![\w:/])\/\/quillbot\.com(?=[/\s"'?#]|$)/g, base);
  for (const host of QUILLBOT_ALLOWED_SECONDARY_HOSTS) {
    out = out.replaceAll("//" + host + "/", base + "/__host/" + host + "/");
  }
  if (contentType.includes("text/html")) {
    out = out.replace(/(<(?:script|img|link|a|form|source|video|audio)[^>]+(?:src|href|action|poster)=["'])\/(?!\/|__qbtest(?:\/|["']))/gi, "$1" + base + "/");
    out = out.replace(/<head([^>]*)>/i, `<head$1><base href="${base}/"><script src="${base}/__trst/bootstrap.js"></script>`);
  }
  if (contentType.includes("text/css")) out = out.replace(/url\((['"]?)\/(?!\/|__qbtest\/)/g, "url($1" + base + "/");
  return out;
}
export function redactQuillBotAuth(text: string, state: QuillBotState) {
  // Native JS may reflect authentication state. Return opaque placeholders;
  // all actual provider authentication is supplied by the server on requests.
  const values = [state.useridtoken, state.cookie];
  for (const cookie of state.cookie.split(";")) {
    const eq = cookie.indexOf("="); if (eq > 0) { const v = cookie.slice(eq + 1).trim(); if (v.length >= 12) values.push(v); }
  }
  let out = text;
  for (const value of [...new Set(values)].sort((a, b) => b.length - a.length)) {
    if (!value) continue;
    for (const encoded of new Set([value, encodeURIComponent(value), JSON.stringify(value).slice(1, -1)])) out = out.replaceAll(encoded, "trst-server-auth");
  }
  return out;
}
export function redactQuillBotJSONCredentials(text: string) {
  try {
    return JSON.stringify(JSON.parse(text), (key, value) => {
      if (/^(?:access_?token|refresh_?token|id_?token|useridtoken|user_?token|authorization|password|cookie|session_?token|token)$/i.test(key) && typeof value === "string") return "trst-server-auth";
      if (/^cookies$/i.test(key) && Array.isArray(value)) return [];
      return value;
    });
  } catch { return text; }
}
export function extractQuillBotAuthRotation(path: string, response: string, current: QuillBotState): { changed: boolean; plaintext: string } {
  // Narrowly permit the observed token API's explicit Useridtoken field.
  // No unknown cookie, preference, accessToken or tracking fields are stored.
  let token: unknown;
  if (path === "/api/auth/token") {
    try { token = JSON.parse(response).useridtoken; } catch {}
  }
  const valid = typeof token === "string" && token.length > 0 && token.length <= 32000 && !/[\r\n\0]/.test(token);
  const next = valid ? { ...current, useridtoken: token as string } : current;
  return { changed: valid && token !== current.useridtoken, plaintext: normaliseQuillBotSession(JSON.stringify(next)) };
}
export const quillBotResponseHeaders = (type = "text/plain; charset=utf-8") => new Headers({ "content-type": type, "cache-control": "no-store", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff", "x-robots-tag": "noindex, nofollow, noarchive" });
export async function proxyQuillBotRequest(request: Request, state: QuillBotState, fetchUpstream: typeof fetch = fetch, rotate?: (plaintext: string) => Promise<void>) {
  const url = new URL(request.url);
  const suffix = url.pathname.slice(QUILLBOT_TEST_PROXY_BASE.length) || "/paraphrasing-tool";
  const target = resolveQuillBotUpstreamPath(suffix === "/" ? "/paraphrasing-tool" : suffix);
  if (!target) return new Response("QuillBot account action or host is disabled.", { status: 403, headers: quillBotResponseHeaders() });
  target.search = url.search;
  if (!["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"].includes(request.method)) return new Response("Method not allowed", { status: 405, headers: quillBotResponseHeaders() });
  if (!["GET", "HEAD"].includes(request.method)) {
    const origin = request.headers.get("origin");
    if (origin && origin !== url.origin) return new Response("Cross-site request blocked.", { status: 403, headers: quillBotResponseHeaders() });
  }
  let body: ArrayBuffer | undefined;
  if (!["GET", "HEAD"].includes(request.method)) {
    if (Number(request.headers.get("content-length") || 0) > 5 * 1024 * 1024) return new Response("Request too large", { status: 413, headers: quillBotResponseHeaders() });
    body = await request.arrayBuffer();
    if (body.byteLength > 5 * 1024 * 1024) return new Response("Request too large", { status: 413, headers: quillBotResponseHeaders() });
  }
  const upstream = await fetchUpstream(target, { method: request.method, headers: buildQuillBotUpstreamHeaders(request, state, target), body, redirect: "manual", signal: AbortSignal.timeout(30000) });
  // An edge challenge is not application HTML or an application-session update.
  if (upstream.headers.get("cf-mitigated") === "challenge") {
    const headers = quillBotResponseHeaders();
    headers.set("cf-mitigated", "challenge");
    headers.set("x-trst-upstream-status", String(upstream.status));
    const ray = upstream.headers.get("cf-ray");
    if (ray && /^[a-zA-Z0-9-]{1,100}$/.test(ray)) headers.set("cf-ray", ray);
    return new Response(request.method === "HEAD" ? null : "QuillBot upstream browser verification blocked this request. The native dashboard has not loaded.", { status: upstream.status, headers });
  }
  const cookieState = rotateQuillBotApplicationCookies(upstream.headers, state, target);
  const persistCookies = async () => { if (cookieState.cookie !== state.cookie && rotate) await rotate(normaliseQuillBotSession(JSON.stringify(cookieState))); };
  if (upstream.status >= 300 && upstream.status < 400 && upstream.headers.has("location")) {
    await persistCookies();
    const mapped = rewriteQuillBotUpstreamLocation(upstream.headers.get("location")!, target.href);
    if (!mapped) return new Response("Unmapped QuillBot redirect", { status: 502, headers: quillBotResponseHeaders() });
    const h = quillBotResponseHeaders(); h.set("location", mapped); return new Response(null, { status: upstream.status, headers: h });
  }
  const type = upstream.headers.get("content-type") || "application/octet-stream";
  const h = quillBotResponseHeaders(type);
  for (const name of ["content-disposition", "etag", "last-modified", "accept-ranges", "content-range"]) { const value = upstream.headers.get(name); if (value) h.set(name, value); }
  if (upstream.status === 401 || upstream.status === 403) h.set("x-trst-upstream-status", String(upstream.status));
  if ([204, 205, 304].includes(upstream.status) || request.method === "HEAD") { await persistCookies(); return new Response(null, { status: upstream.status, headers: h }); }
  if (/text\/|javascript|json|xml|svg/.test(type)) {
    const text = await upstream.text();
    const rotation = extractQuillBotAuthRotation(target.pathname, text, cookieState);
    const nextState = rotation.changed && upstream.ok && target.origin === "https://media.quillbot.com" ? JSON.parse(rotation.plaintext) : cookieState;
    if (rotate && (nextState.cookie !== state.cookie || nextState.useridtoken !== state.useridtoken)) await rotate(normaliseQuillBotSession(JSON.stringify(nextState)));
    const safeText = type.includes("json") ? redactQuillBotJSONCredentials(text) : text;
    return new Response(rewriteQuillBotBody(redactQuillBotAuth(redactQuillBotAuth(redactQuillBotAuth(safeText, state), cookieState), nextState), type), { status: upstream.status, headers: h });
  }
  await persistCookies();
  return new Response(await upstream.arrayBuffer(), { status: upstream.status, headers: h });
}
