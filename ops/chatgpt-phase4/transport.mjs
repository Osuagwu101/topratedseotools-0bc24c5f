export const GATEWAY_ORIGIN = "https://chatgpt.topratedseotools.com";
export const UPSTREAM_ORIGIN = "https://chatgpt.com";
export const MAX_REQUEST_BYTES = 25 * 1024 * 1024;

const ASSET_HOSTS = new Set([
  "cdn.oaistatic.com",
  "persistent.oaistatic.com",
]);
const ALLOWED_METHODS = new Set(["GET","HEAD","POST","PUT","PATCH","DELETE","OPTIONS"]);
const BLOCKED_DOCUMENT_PREFIXES = [
  "/auth",
  "/login",
  "/account",
  "/settings",
  "/billing",
  "/subscription",
  "/admin",
];

export class Phase4PolicyError extends Error {
  constructor(code, status = 403) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

const fail = (code, status) => { throw new Phase4PolicyError(code, status); };

export function allowedAssetHosts() {
  return [...ASSET_HOSTS];
}

export function isDocumentRequest(request) {
  const dest = (request.headers.get("sec-fetch-dest") || "").toLowerCase();
  const accept = (request.headers.get("accept") || "").toLowerCase();
  return dest === "document" || accept.includes("text/html");
}

export function isBlockedDocumentPath(pathname) {
  const path = pathname.toLowerCase();
  return BLOCKED_DOCUMENT_PREFIXES.some(
    prefix => path === prefix || path.startsWith(prefix + "/"),
  );
}

export function classifyGatewayRequest(request) {
  const url = new URL(request.url);
  if (url.origin !== GATEWAY_ORIGIN) fail("invalid_gateway_origin");
  if (!ALLOWED_METHODS.has(request.method)) fail("method_not_allowed", 405);

  const upgrade = (request.headers.get("upgrade") || "").toLowerCase();
  if (upgrade && upgrade !== "websocket") fail("unsupported_upgrade", 426);

  let targetOrigin = UPSTREAM_ORIGIN;
  let targetPath = url.pathname || "/";
  let secondaryHost = false;

  const hostRoute = targetPath.match(/^\/__host\/([^/]+)(\/.*)?$/);
  if (hostRoute) {
    const host = hostRoute[1].toLowerCase();
    if (!/^[a-z0-9.-]+$/.test(host) || !ASSET_HOSTS.has(host)) {
      fail("asset_host_blocked");
    }
    targetOrigin = "https://" + host;
    targetPath = hostRoute[2] || "/";
    secondaryHost = true;
  }

  const target = new URL(targetOrigin);
  target.pathname = targetPath;
  target.search = url.search;
  target.searchParams.delete("ticket");

  if (
    targetOrigin === UPSTREAM_ORIGIN &&
    isDocumentRequest(request) &&
    isBlockedDocumentPath(target.pathname)
  ) {
    fail("restricted_document_route");
  }

  return {
    kind: upgrade === "websocket" ? "websocket" : "http",
    target,
    targetOrigin,
    secondaryHost,
  };
}

export function sanitizeUpstreamHeaders(request, targetOrigin) {
  const out = new Headers();
  const allowed = [
    "accept","accept-language","content-type","if-none-match","if-modified-since",
    "range","rsc","next-router-state-tree","next-router-prefetch","next-url",
    "purpose","x-nextjs-data","sec-ch-ua","sec-ch-ua-mobile","sec-ch-ua-platform",
    "sec-fetch-dest","sec-fetch-mode","sec-fetch-site","sec-fetch-user",
    "upgrade-insecure-requests","user-agent",
  ];
  for (const name of allowed) {
    const value = request.headers.get(name);
    if (value) out.set(name, value);
  }
  if (!out.has("accept-language")) out.set("accept-language", "en-US,en;q=0.9");
  out.set("accept-encoding", "identity");
  out.set("origin", targetOrigin);
  out.set("referer", targetOrigin + "/");
  return out;
}

export function sanitizeUpstreamResponseHeaders(headers) {
  const out = new Headers();
  for (const name of [
    "content-type","content-disposition","etag","last-modified",
    "accept-ranges","content-range","vary",
  ]) {
    const value = headers.get(name);
    if (value) out.set(name, value);
  }
  out.set("cache-control", "no-store, max-age=0");
  out.set("referrer-policy", "no-referrer");
  out.set("x-content-type-options", "nosniff");
  out.set("x-robots-tag", "noindex, nofollow, noarchive");
  return out;
}

export function rewriteLocation(location, baseOrigin = UPSTREAM_ORIGIN) {
  let absolute;
  try { absolute = new URL(location, baseOrigin); }
  catch { fail("external_redirect_blocked"); }

  if (absolute.protocol !== "https:") fail("external_redirect_blocked");
  if (absolute.origin === UPSTREAM_ORIGIN) {
    return absolute.pathname + absolute.search + absolute.hash;
  }
  if (ASSET_HOSTS.has(absolute.hostname)) {
    return "/__host/" + absolute.hostname + absolute.pathname + absolute.search + absolute.hash;
  }
  fail("external_redirect_blocked");
}

export function rewriteTextBody(text, contentType) {
  let out = text
    .replaceAll(UPSTREAM_ORIGIN, "")
    .replaceAll("https:\\/\\/chatgpt.com", "");

  for (const host of ASSET_HOSTS) {
    out = out
      .replaceAll("https://" + host, "/__host/" + host)
      .replaceAll("https:\\/\\/" + host, "\\/__host\\/" + host);
  }

  if (contentType.includes("text/html")) {
    out = out.replace(
      /(<(?:script|img|link|a|form|source|video|audio)[^>]+(?:src|href|action|poster)=["'])\/(?!\/)/gi,
      "$1/",
    );
  }
  return out;
}

export function bodyMode(contentType = "") {
  const type = contentType.toLowerCase();
  if (type.includes("text/event-stream")) return "stream";
  if (type.includes("application/x-ndjson")) return "stream";
  if (
    type.includes("text/html") ||
    type.includes("text/css") ||
    type.includes("javascript") ||
    type.includes("application/json") ||
    type.includes("text/plain")
  ) return "rewrite";
  return "stream";
}

export function assertRequestSize(request) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) {
    fail("request_too_large", 413);
  }
}

export function phase4SafeError(error) {
  if (error instanceof Phase4PolicyError) return error;
  return new Phase4PolicyError("local_transport_failure", 503);
}
