/* Pure routing and ownership rules for Grammarly's newer Coda editor. */
export const CODA_HOST = "coda.grammarly.com";
export const codaOwnerKey = (id: string) => `coda:${id}`;
const ID = /^[A-Za-z0-9_-]{5,64}$/;

export function codaDocumentId(pathname: string): string | null {
  const api = pathname.match(/^\/internalAppApi\/documents\/([A-Za-z0-9_-]+)(?:\/|$)/);
  if (api && ID.test(api[1])) return api[1];
  const page = pathname.match(/^\/d\/[^/]*_d([A-Za-z0-9_-]+)(?:\/|$)/);
  return page && ID.test(page[1]) ? page[1] : null;
}

export function isCodaRootPath(path: string) {
  return /^\/(?:newdoc(?:\/|$)|d(?:\/|$)|internalAppApi(?:\/|$)|document_server(?:\/|$)|logger_server(?:\/|$))/.test(path);
}

export function codaSocketParams(url: URL): Record<string, any> | null {
  if (!/^\/document_server\/?$/.test(url.pathname)) return null;
  try {
    const raw = url.searchParams.get("params") || "";
    if (raw.length > 8192) return null;
    const value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    return value && ID.test(value.documentId) ? value : null;
  } catch { return null; }
}

export function codaReferencedDocuments(value: unknown, ids = new Set<string>(), depth = 0): Set<string> {
  if (depth > 40) throw new Error("Request is too deeply nested");
  if (!value || typeof value !== "object") return ids;
  for (const [key, item] of Object.entries(value)) {
    if (/^(?:docId|documentId|sourceDocId|targetDocId|containerDocId)$/i.test(key) && typeof item === "string" && ID.test(item)) ids.add(item);
    else if (/^(?:docIds|documentIds)$/i.test(key) && Array.isArray(item)) {
      for (const id of item) if (typeof id === "string" && ID.test(id)) ids.add(id);
    } else if (item && typeof item === "object") codaReferencedDocuments(item, ids, depth + 1);
  }
  return ids;
}

export type CodaAccess = { kind: "new" | "document" | "list" | "bootstrap" | "blocked"; id?: string };
export function codaAccess(method: string, url: URL): CodaAccess {
  const p = url.pathname;
  if (/%2f|%5c|%2e/i.test(p) || p.includes("\\")) return { kind: "blocked" };
  const read = method === "GET" || method === "HEAD";
  const socket = codaSocketParams(url);
  if (socket && (read || method === "POST")) return { kind: "document", id: socket.documentId };
  // Creation is always a blank document in the account's default workspace.
  if (/^\/newdoc(?:\/[^/]+)?\/?$/.test(p) && (read || method === "POST")) {
    const allowed = new Set(["source", "utm_source", "utm_medium", "utm_campaign"]);
    if ([...url.searchParams.keys()].some(k => !allowed.has(k))) return { kind: "blocked" };
    return { kind: "new" };
  }
  const id = codaDocumentId(p);
  if (id) {
    // Never expose sharing, publishing, connected accounts, cross-document sync,
    // automations, or workspace/account administration through a writer session.
    if (/(?:^|\/)(?:sharing|publish|externalConnections|packs|automations|crossdoc|copyPastePages|syncPages|syncPagePermissions|setCrossDocSyncFilter|setSyncFieldSettings|dbtConnections|outgoingDbtConnections|incomingDbtConnections|brain|templates)(?:\/|$)/i.test(p) || (!read && /\/(?:userAccess|users|attributes|revive|hide)$/.test(p))) return { kind: "blocked" };
    return { kind: "document", id };
  }
  if (read && /^\/internalAppApi\/doclist\/(?:recent|search2|trashed)$/.test(p)) return { kind: "list" };
  if (read && p === "/internalAppApi/account/userAccountInfo") return { kind: "bootstrap" };
  return { kind: "blocked" };
}

export function filterCodaDocuments(payload: any, owned: { has(id: string): boolean }) {
  if (!payload || !Array.isArray(payload.items)) throw new Error("Unexpected Coda document list");
  return { ...payload, items: payload.items.filter((d: any) => typeof d?.docId === "string" && owned.has(codaOwnerKey(d.docId))) };
}

/** Coda form creation uses a different CSRF cookie from the classic editor. */
export function codaFormBody(body: ArrayBuffer | undefined, contentType: string, csrf: string | undefined) {
  if (!body || !contentType.includes("application/x-www-form-urlencoded")) return body;
  const form = new URLSearchParams(new TextDecoder().decode(body));
  if (form.has("csrfToken") && csrf) form.set("csrfToken", csrf);
  return new TextEncoder().encode(form.toString()).buffer;
}
