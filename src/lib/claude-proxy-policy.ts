/* Pure policy for the Claude proxy. Unknown API routes fail closed. */
import type { ClaudeSessionState } from "./claude-session.server";
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
export type ClaudeRoute = {
  kind: "page" | "asset" | "bootstrap" | "list" | "create" | "conversation" | "upload" | "file" | "integration" | "artifact_list" | "consent";
  org?: string;
  conversation?: string;
  /** Provider file id for per-file routes; ownership is checked by the proxy. */
  file?: string;
  /** Upload flavour: wiggle (conversation sandbox), legacy file store, or text conversion. */
  upload?: "wiggle" | "file" | "convert";
};
/** Provider file ids are UUIDs or short opaque tokens; never paths. */
const FILE_ID = "[A-Za-z0-9_-]{8,128}";
/** Upload, preview and download routes. Every one is scoped to an owned file or conversation. */
export function claudeFileRoutePolicy(m: string, p: string): ClaudeRoute | null {
  if (m === "POST") {
    const convert = p.match(new RegExp(`^/api/(?:organizations/(${UUID})/)?convert_document$`, "i"));
    if (convert) return { kind: "upload", upload: "convert", org: convert[1]?.toLowerCase() };
    const legacy = p.match(new RegExp(`^/api/(?:organizations/)?(${UUID})/upload$`, "i"));
    if (legacy) return { kind: "upload", upload: "file", org: legacy[1].toLowerCase() };
    const wiggle = p.match(new RegExp(`^/api/organizations/(${UUID})/conversations/(${UUID})/wiggle/upload-file$`, "i"));
    if (wiggle) return { kind: "upload", upload: "wiggle", org: wiggle[1].toLowerCase(), conversation: wiggle[2].toLowerCase() };
    return null;
  }
  if (!["GET", "HEAD"].includes(m)) return null;
  // Claude-created files: the artifact id is the conversation id (observed 23 Nov 2026).
  const artifact = p.match(new RegExp(`^/api/organizations/(${UUID})/artifacts/(${UUID})(?:/[A-Za-z0-9_.:-]{1,200}){0,4}$`, "i"));
  if (artifact) return { kind: "file", org: artifact[1].toLowerCase(), conversation: artifact[2].toLowerCase() };
  const stored = p.match(new RegExp(`^/api/(?:organizations/)?(${UUID})/files/(${FILE_ID})/(preview|thumbnail|document_pdf|contents)(?:/[A-Za-z0-9_.-]{1,200})?$`, "i"));
  if (stored) return { kind: "file", org: stored[1].toLowerCase(), file: stored[2].toLowerCase() };
  const sandbox = p.match(new RegExp(`^/api/organizations/(${UUID})/conversations/(${UUID})/wiggle/(?:list-files|download-file|file-metadata|download-files)$`, "i"));
  if (sandbox) return { kind: "file", org: sandbox[1].toLowerCase(), conversation: sandbox[2].toLowerCase() };
  return null;
}
/** Connectors, plugins and skills are open to writers, except blocked providers. */
export const CLAUDE_BLOCKED_CONNECTORS = /github|supabase/i;
const INTEGRATION_SEGMENT =
  "(?:mcp|mcp_servers|remote_servers|connectors?|integrations?|plugins?|plugin_marketplaces?|marketplaces?|skills?|directory|sync|extensions?)";
export function claudeIntegrationRoutePolicy(m: string, p: string): ClaudeRoute | null {
  if (!["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"].includes(m)) return null;
  if (CLAUDE_BLOCKED_CONNECTORS.test(p)) return null;
  if (m === "GET" && new RegExp(`^/(?:plugins|customize|directory|connectors|skills)(?:/[A-Za-z0-9_.~-]{1,200}){0,4}$`).test(p))
    return { kind: "page" };
  const org = p.match(new RegExp(`^/api/organizations/(${UUID})/${INTEGRATION_SEGMENT}(?:/[A-Za-z0-9_.:@~-]{1,300}){0,6}$`, "i"));
  if (org) return { kind: "integration", org: org[1].toLowerCase() };
  if (new RegExp(`^/api/${INTEGRATION_SEGMENT}(?:/[A-Za-z0-9_.:@~-]{1,300}){0,6}$`, "i").test(p)) return { kind: "integration" };
  return null;
}
export function claudeRoutePolicy(method: string, pathname: string): ClaudeRoute | null {
  let p: string;
  try {
    p = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (/[\\\x00-\x1f]/.test(p) || /\/\//.test(p)) return null;
  if (p.split("/").some((part) => part === "." || part === "..")) return null;
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
  const fileRoute = claudeFileRoutePolicy(m, p);
  if (fileRoute) return fileRoute;
  // Artifact viewer frame: type catalogue and the per-org artifact list (filtered to the writer's chats).
  if (m === "GET" && p === "/api/frame/types") return { kind: "bootstrap" };
  if (m === "GET" && p === "/api/frame/artifacts") return { kind: "artifact_list" };
  // Dictation and voice first check the account's privacy consent.
  if (["GET", "POST"].includes(m) && /^\/v1\/privacy-consents(?:\/[a-z0-9_-]{1,80}){0,2}$/i.test(p)) return { kind: "consent" };
  const integrationRoute = claudeIntegrationRoutePolicy(m, p);
  if (integrationRoute) return integrationRoute;
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
    (m === "GET" && ["","/serving","/composer_notices"].includes(action)) ||
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
  return `<script>(function(){var F=window.fetch;function map(u){var t=new URL(String(u),location.href);if(t.origin==="https://claude.ai")return location.origin+t.pathname+t.search+t.hash;return u}window.fetch=function(i,n){if(typeof i==="string"||i instanceof URL)i=map(i);else if(i&&i.url){var u=map(i.url);if(u!==i.url)i=new Request(u,i)}return F.call(this,i,n)};var X=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){arguments[1]=map(u);return X.apply(this,arguments)};var S=window.WebSocket;if(S){var P=function(u,p){var t=new URL(String(u),location.href);if(t.host==="claude.ai"||t.host==="www.claude.ai")u=(location.protocol==="https:"?"wss://":"ws://")+location.host+t.pathname+t.search;return p===undefined?new S(u):new S(u,p)};P.prototype=S.prototype;P.CONNECTING=0;P.OPEN=1;P.CLOSING=2;P.CLOSED=3;window.WebSocket=P}})();</script>`;
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
