import type { GrammarlySessionState } from "./grammarly-session.server";

/** Accept first-party server cookies, keyed by name, domain and path. */
export function mergeGrammarlyCookies(state: GrammarlySessionState, rawCookies: string[], sourceHost: string) {
  const next = structuredClone(state);
  for (const raw of rawCookies) {
    const parts = raw.split(";");
    const eq = parts[0].indexOf("=");
    if (eq < 1) continue;
    const name = parts[0].slice(0, eq).trim();
    const value = parts[0].slice(eq + 1);
    const attrs = new Map(parts.slice(1).map(p => {
      const i = p.indexOf("=");
      return [p.slice(0, i < 0 ? undefined : i).trim().toLowerCase(), i < 0 ? "" : p.slice(i + 1).trim()] as const;
    }));
    const domain = (attrs.get("domain") || sourceHost).toLowerCase();
    const hostDomain = domain.replace(/^\./, "");
    if (!(hostDomain === "grammarly.com" || hostDomain.endsWith(".grammarly.com")) || !(sourceHost === hostDomain || sourceHost.endsWith("." + hostDomain))) continue;
    const path = attrs.get("path") || "/";
    const index = next.cookies.findIndex(c => c.name === name && c.domain.replace(/^\./, "").toLowerCase() === hostDomain && c.path === path);
    const expires = attrs.has("expires") ? Date.parse(attrs.get("expires")!) / 1000 : undefined;
    const maxAge = attrs.has("max-age") ? Number(attrs.get("max-age")) : undefined;
    const deleted = !value || (maxAge !== undefined ? maxAge <= 0 : expires !== undefined && expires <= Date.now() / 1000);
    if (deleted) { if (index >= 0) next.cookies.splice(index, 1); continue; }
    const cookie = { name, value, domain, path, secure: attrs.has("secure"), httpOnly: attrs.has("httponly"),
      ...(Number.isFinite(maxAge) ? { expires: Date.now() / 1000 + maxAge! } : Number.isFinite(expires) ? { expires } : {}),
      ...(attrs.has("samesite") ? { sameSite: attrs.get("samesite") } : {}) };
    if (index < 0) next.cookies.push(cookie); else next.cookies[index] = cookie;
  }
  return next;
}
