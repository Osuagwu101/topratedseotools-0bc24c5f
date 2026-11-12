/* Pure policy for the Claude proxy. Unknown API routes fail closed. */
import type { ClaudeSessionState } from "./claude-session.server";
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
export type ClaudeRoute = {
  kind: "page" | "asset" | "bootstrap" | "list" | "create" | "conversation";
  org?: string;
  conversation?: string;
};
export function claudeRoutePolicy(method: string, pathname: string): ClaudeRoute | null {
  let p: string;
  try {
    p = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (/[\\\x00-\x1f]/.test(p) || /\/\//.test(p)) return null;
  const m = method.toUpperCase();
  if (m === "GET" && ["/", "/new", "/recents"].includes(p)) return { kind: "page" };
  const page = p.match(new RegExp(`^/chat/(${UUID})$`, "i"));
  if (m === "GET" && page) return { kind: "page", conversation: page[1].toLowerCase() };
  if (
    ["GET", "HEAD"].includes(m) &&
    (/^\/_next\/static\/[A-Za-z0-9_./%+-]+$/.test(p) ||
      /^\/(?:favicon\.ico|manifest\.json)$/.test(p))
  )
    return { kind: "asset" };
  if (m === "GET" && ["/api/organizations", "/api/account"].includes(p))
    return { kind: "bootstrap" };
  const org = p.match(new RegExp(`^/api/organizations/(${UUID})(/.*)?$`, "i"));
  if (!org) return null;
  const suffix = org[2] ?? "";
  if (m === "GET" && ["", "/models", "/model_configs", "/rate_limit"].includes(suffix))
    return { kind: "bootstrap", org: org[1].toLowerCase() };
  if (suffix === "/chat_conversations") {
    if (m === "GET") return { kind: "list", org: org[1].toLowerCase() };
    if (m === "POST") return { kind: "create", org: org[1].toLowerCase() };
  }
  const chat = suffix.match(new RegExp(`^/chat_conversations/(${UUID})(/.*)?$`, "i"));
  if (!chat) return null;
  const action = chat[2] ?? "";
  if (
    (m === "GET" && action === "") ||
    (m === "POST" && ["/completion", "/retry_completion", "/stop", "/title"].includes(action)) ||
    (m === "PUT" && action === "")
  ) {
    return { kind: "conversation", org: org[1].toLowerCase(), conversation: chat[1].toLowerCase() };
  }
  return null;
}
export function claudeCookieHeader(state: ClaudeSessionState, pathname = "/") {
  return state.cookies
    .filter((c) => {
      const d = c.domain.toLowerCase().replace(/^\./, "");
      const path = c.path || "/";
      return (
        d === "claude.ai" &&
        (!c.expires || c.expires < 0 || c.expires * 1000 > Date.now()) &&
        (pathname === path ||
          (pathname.startsWith(path) && (path.endsWith("/") || pathname[path.length] === "/")))
      );
    })
    .sort((a, b) => b.path.length - a.path.length)
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}
export function rewriteClaudeBody(text: string, origin: string) {
  return text
    .replace(/https:\/\/(?:www\.)?claude\.ai(?=[/"'\s?#]|$)/gi, origin)
    .replace(
      /https:\\\/\\\/(?:www\.)?claude\.ai(?=\\\/|["'\s?#]|$)/gi,
      origin.replaceAll("/", "\\/"),
    );
}
export function claudeBootstrapScript() {
  return `<script>(function(){var F=window.fetch;function map(u){var t=new URL(String(u),location.href);if(t.origin==="https://claude.ai")return location.origin+t.pathname+t.search+t.hash;return u}window.fetch=function(i,n){if(typeof i==="string"||i instanceof URL)i=map(i);else if(i&&i.url){var u=map(i.url);if(u!==i.url)i=new Request(u,i)}return F.call(this,i,n)};var X=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){arguments[1]=map(u);return X.apply(this,arguments)}})();</script>`;
}
export function claudeResponseContainsSecret(text: string, state: ClaudeSessionState) {
  return state.cookies.some(
    (c) =>
      c.value.length >= 8 && (text.includes(c.value) || text.includes(encodeURIComponent(c.value))),
  );
}
export function filterClaudeConversationList(payload: unknown, ids: Set<string>): unknown {
  if (!Array.isArray(payload)) throw new Error("Unrecognised Claude conversation list shape");
  return payload.filter(
    (row) =>
      row &&
      typeof row === "object" &&
      typeof row.uuid === "string" &&
      ids.has(row.uuid.toLowerCase()),
  );
}
