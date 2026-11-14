/* Request/session mechanics shared with the working StealthWriter/ChatGPT design.
 * Fixed provider origin; TopRated credentials and security-challenge state stay out.
 */
import type { ClaudeSessionState, ClaudeStoredCookie } from "./claude-session.server";
export const CLAUDE_UPSTREAM_ORIGIN = "https://claude.ai";
const forwarded = [
  "accept",
  "accept-language",
  "content-type",
  "if-none-match",
  "if-modified-since",
  "range",
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
  "user-agent",
  "anthropic-client-sha",
  "anthropic-client-version",
  "anthropic-client-platform",
];

export function claudeUpstreamHeaders(request: Request, cookieHeader: string) {
  const headers = new Headers();
  for (const name of forwarded) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (!headers.has("Accept")) headers.set("Accept", "*/*");
  if (!headers.has("Accept-Language")) headers.set("Accept-Language", "en-US,en;q=0.9");
  headers.set("Accept-Encoding", "identity");
  headers.set("Cookie", cookieHeader);
  headers.set("Origin", CLAUDE_UPSTREAM_ORIGIN);
  let referer = CLAUDE_UPSTREAM_ORIGIN + "/new";
  try {
    const source = new URL(request.headers.get("referer") ?? "");
    if (
      source.origin === new URL(request.url).origin &&
      !source.username &&
      !source.password &&
      !source.pathname.startsWith("/__trst/") &&
      !source.pathname.startsWith("/__host/") &&
      !source.pathname.startsWith("/__browser/")
    ) {
      referer = CLAUDE_UPSTREAM_ORIGIN + source.pathname + source.search;
    }
  } catch {
    /* default to the provider landing page */
  }
  headers.set("Referer", referer);
  return headers;
}

// Only existing first-party application cookie names can rotate.
const ignoredName =
  /^(?:cf_clearance|__cf_bm|_cfuvid|__cfuvid|_ga.*|_gid|_gat.*|_utm.*|intercom-.*|hubspot.*|ajs_.*|amplitude.*)$/i;
export function applyClaudeResponseCookies(
  state: ClaudeSessionState,
  response: Response,
  requestPath = "/",
  now = Date.now(),
): { changed: boolean; state: ClaudeSessionState } {
  if (
    response.headers.get("cf-mitigated")?.toLowerCase() === "challenge" ||
    response.status < 200 ||
    response.status >= 400
  )
    return { changed: false, state };
  if (response.status >= 300 && response.headers.has("location")) {
    try {
      if (
        new URL(response.headers.get("location")!, CLAUDE_UPSTREAM_ORIGIN).origin !==
        CLAUDE_UPSTREAM_ORIGIN
      )
        return { changed: false, state };
    } catch {
      return { changed: false, state };
    }
  }
  const names = new Set(state.cookies.map((c) => c.name).filter((n) => !ignoredName.test(n)));
  const h = response.headers as Headers & { getSetCookie?: () => string[] };
  const lines =
    typeof h.getSetCookie === "function"
      ? h.getSetCookie()
      : (h.get("set-cookie") ?? "").split(/,(?=\s*[^\s;,=]+\s*=)/);
  const cookies = state.cookies.map((c) => ({ ...c }));
  const defaultPath =
    requestPath.startsWith("/") && requestPath.lastIndexOf("/") > 0
      ? requestPath.slice(0, requestPath.lastIndexOf("/"))
      : "/";
  for (const line of lines) {
    const parts = line.split(";");
    const first = parts.shift() ?? "";
    const equal = first.indexOf("=");
    if (equal < 1) continue;
    const name = first.slice(0, equal).trim(),
      value = first.slice(equal + 1).trim();
    if (
      !names.has(name) ||
      ignoredName.test(name) ||
      /[;\r\n\x00]/.test(value) ||
      value.length > 128000
    )
      continue;
    const attrs = new Map<string, string>();
    for (const part of parts) {
      const i = part.indexOf("=");
      attrs.set(
        (i < 0 ? part : part.slice(0, i)).trim().toLowerCase(),
        i < 0 ? "" : part.slice(i + 1).trim(),
      );
    }
    const domain = (attrs.get("domain") ?? "claude.ai").toLowerCase().replace(/^\./, "");
    if (domain !== "claude.ai") continue;
    const path = attrs.get("path")?.startsWith("/") ? attrs.get("path")! : defaultPath;
    if (/[\r\n\x00]/.test(path)) continue;
    let expires: number | undefined;
    const maxAge = attrs.get("max-age");
    if (maxAge != null && /^-?\d+$/.test(maxAge)) expires = now / 1000 + Number(maxAge);
    else if (attrs.has("expires")) {
      const date = Date.parse(attrs.get("expires")!);
      if (Number.isFinite(date)) expires = date / 1000;
    }
    const index = cookies.findIndex(
      (c) =>
        c.name === name && c.domain.toLowerCase().replace(/^\./, "") === domain && c.path === path,
    );
    if (expires != null && expires * 1000 <= now) {
      if (index >= 0) cookies.splice(index, 1);
      continue;
    }
    if (!value) continue;
    const cookie: ClaudeStoredCookie = { name, value, domain: ".claude.ai", path };
    if (expires != null) cookie.expires = expires;
    if (attrs.has("secure")) cookie.secure = true;
    if (attrs.has("httponly")) cookie.httpOnly = true;
    if (attrs.has("samesite")) cookie.sameSite = attrs.get("samesite");
    if (index >= 0) cookies[index] = cookie;
    else cookies.push(cookie);
  }
  if (JSON.stringify(cookies) === JSON.stringify(state.cookies)) return { changed: false, state };
  return { changed: true, state: { ...state, cookies } };
}
