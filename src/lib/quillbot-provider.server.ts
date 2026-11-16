/** Fixed-host mapping; StealthWriter reference with QuillBot-specific origins. */
export const QUILLBOT_UPSTREAM_ORIGIN = "https://quillbot.com";
export const QUILLBOT_LANDING_PATH = "/paraphrasing-tool";
export const QUILLBOT_TEST_PROXY_BASE = "/__qbtest";
export const QUILLBOT_ALLOWED_SECONDARY_HOSTS = ["media.quillbot.com", "libs.quillbot.com", "assets.quillbot.com"] as const;
const BLOCKED_ACCOUNT_PATHS = ["/logout","/signout","/sign-out","/billing","/account","/accounts","/subscription","/subscriptions","/settings","/premium","/upgrade","/api/auth/logout","/api/auth/signout","/api/auth/login","/api/auth/signup","/api/account","/api/billing","/api/subscription"];
export function isBlockedQuillBotPath(path: string) {
  try { path = decodeURIComponent(path); } catch { return true; }
  if (path.includes("\\") || path.includes("\0") || /%[0-9a-f]{2}/i.test(path)) return true;
  return BLOCKED_ACCOUNT_PATHS.some(prefix => path === prefix || path.startsWith(prefix + "/"));
}
export function resolveQuillBotUpstreamPath(path: string): URL | null {
  if (!path.startsWith("/")) return null;
  let candidate: URL;
  try { candidate = new URL(path, QUILLBOT_UPSTREAM_ORIGIN); } catch { return null; }
  if (candidate.origin !== QUILLBOT_UPSTREAM_ORIGIN) return null;
  const first = candidate.pathname.match(/^\/__host\/([^/]+)(\/.*)?$/);
  if (!first) {
    if (candidate.pathname === "/__host" || candidate.pathname.startsWith("/__host/") || isBlockedQuillBotPath(candidate.pathname)) return null;
    return candidate;
  }
  if (!QUILLBOT_ALLOWED_SECONDARY_HOSTS.includes(first[1] as typeof QUILLBOT_ALLOWED_SECONDARY_HOSTS[number])) return null;
  const upstream = new URL(first[2] || "/", "https://" + first[1]); upstream.search = candidate.search;
  if (upstream.origin !== "https://" + first[1] || isBlockedQuillBotPath(upstream.pathname)) return null;
  return upstream;
}
export function rewriteQuillBotUpstreamLocation(location: string, targetOrigin = QUILLBOT_UPSTREAM_ORIGIN, base = QUILLBOT_TEST_PROXY_BASE): string | null {
  let url: URL; try { url = new URL(location, targetOrigin); } catch { return null; }
  if (url.username || url.password || isBlockedQuillBotPath(url.pathname)) return null;
  if (url.origin === QUILLBOT_UPSTREAM_ORIGIN) return base + url.pathname + url.search + url.hash;
  if (url.protocol === "https:" && url.origin === "https://" + url.hostname && QUILLBOT_ALLOWED_SECONDARY_HOSTS.includes(url.hostname as typeof QUILLBOT_ALLOWED_SECONDARY_HOSTS[number])) return base + "/__host/" + url.hostname + url.pathname + url.search + url.hash;
  return null;
}
