/* eslint-disable @typescript-eslint/no-explicit-any */
/*
 * Shared ChatGPT projects granted to one writer.
 *
 * The upstream ChatGPT account can be invited as a collaborator on someone
 * else's project. Chats inside such a project were not started through the
 * proxy, so per-writer isolation hides them from everybody. An admin can
 * grant one writer a project:
 *   - the granted writer sees every chat in that project and can open and
 *     continue them;
 *   - every other writer no longer sees the project at all (sidebar, pages,
 *     API calls or chats inside it).
 * Unrecorded upstream projects are private and never visible to a writer.
 * A successfully created OneClick project is recorded as access for its creator.
 */

/** A ChatGPT project id: g-p- followed by 32 hex characters. */
const PROJECT_ID_SOURCE = "g-p-[0-9a-f]{32}";
const PROJECT_ID_EXACT = new RegExp(`^${PROJECT_ID_SOURCE}$`, "i");
const PROJECT_ID_ANY = new RegExp(PROJECT_ID_SOURCE, "gi");
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ProjectAccess = {
  /** Projects granted to the current writer. */
  granted: Set<string>;
  /** Projects granted to someone else: hidden from the current writer. */
  hidden: Set<string>;
};

export const NO_PROJECT_ACCESS: ProjectAccess = { granted: new Set(), hidden: new Set() };

export function isProjectId(value: unknown): value is string {
  return typeof value === "string" && PROJECT_ID_EXACT.test(value);
}

/** Project id from a pasted link (…/g/g-p-<hex>-name/project) or a bare id. */
export function projectIdFromInput(input: string): string | null {
  const m = String(input ?? "").match(new RegExp(PROJECT_ID_SOURCE, "i"));
  return m ? m[0].toLowerCase() : null;
}

/** Every project id mentioned in a piece of text (path, query or body). */
export function projectIdsIn(text: string | null | undefined): Set<string> {
  const out = new Set<string>();
  if (!text) return out;
  for (const m of text.matchAll(PROJECT_ID_ANY)) out.add(m[0].toLowerCase());
  return out;
}

export function buildProjectAccess(
  grants: Array<{ project_id: string; user_id: string }>,
  userId: string,
): ProjectAccess {
  const granted = new Set<string>();
  const hidden = new Set<string>();
  for (const g of grants) {
    const id = String(g.project_id).toLowerCase();
    if (String(g.user_id) === userId) granted.add(id);
    else hidden.add(id);
  }
  for (const id of granted) hidden.delete(id);
  return { granted, hidden };
}

/** True when a request (path, query or body) touches a project hidden from this writer. */
export function touchesHiddenProject(
  access: ProjectAccess,
  pathAndQuery: string,
  bodyText: string | null | undefined,
): boolean {
  let path = pathAndQuery;
  try { path = decodeURIComponent(path); } catch { /* invalid URL remains subject to normal routing */ }
  let body = bodyText;
  try { if (body) body = JSON.stringify(JSON.parse(body)); } catch { /* binary/form requests retain raw matching */ }
  for (const id of projectIdsIn(path)) if (!access.granted.has(id)) return true;
  for (const id of projectIdsIn(body)) if (!access.granted.has(id)) return true;
  return false;
}

/** Project a conversation-list API path belongs to, e.g. /backend-api/gizmos/<id>/conversations. */
export function projectOfConversationListPath(pathname: string): string | null {
  const m = pathname.match(
    new RegExp(`^/backend-api/gizmos/(${PROJECT_ID_SOURCE})/conversations/?$`, "i"),
  );
  return m ? m[1].toLowerCase() : null;
}

const isPlainObject = (v: unknown): v is Record<string, any> =>
  !!v && typeof v === "object" && !Array.isArray(v);

/**
 * Project an object refers to, looking through its own fields and nested
 * objects (never into lists, so a page holding many projects is not tagged).
 */
export function projectReferencedBy(value: unknown, depth = 0): string | null {
  if (!isPlainObject(value) || depth > 3) return null;
  for (const v of Object.values(value)) if (isProjectId(v)) return v.toLowerCase();
  for (const v of Object.values(value)) {
    const nested = projectReferencedBy(v, depth + 1);
    if (nested) return nested;
  }
  return null;
}

function conversationIdOf(v: unknown): string | null {
  if (!isPlainObject(v)) return null;
  const id = v.id ?? v.conversation_id;
  return typeof id === "string" &&
    UUID_RE.test(id) &&
    "title" in v &&
    ("create_time" in v || "update_time" in v)
    ? id.toLowerCase()
    : null;
}

/**
 * Apply project grants to a JSON payload before the usual per-writer filter:
 *   - drops list entries that belong to a project hidden from this writer;
 *   - returns the chats that belong to projects granted to this writer, so
 *     the caller can treat them as visible and remember them.
 * `pathProject` is the project a project-chat list endpoint belongs to.
 */
export function applyProjectAccess(
  payload: any,
  access: ProjectAccess,
  pathProject: string | null = null,
): { payload: any; grantedConversations: Map<string, string> } {
  const grantedConversations = new Map<string, string>();

  const visit = (node: any, context: string | null, depth: number): any => {
    if (depth > 14 || node === null || typeof node !== "object") return node;
    if (Array.isArray(node)) {
      const kept: any[] = [];
      for (const el of node) {
        const project = projectReferencedBy(el) ?? (conversationIdOf(el) ? context : null);
        if (project && !access.granted.has(project)) continue;
        kept.push(visit(el, project ?? context, depth + 1));
      }
      return kept;
    }
    const own = projectReferencedBy(node);
    if (own && !access.granted.has(own)) return null;
    const ctx = own ?? context;
    const convo = conversationIdOf(node);
    if (convo && ctx && access.granted.has(ctx)) grantedConversations.set(convo, ctx);
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(node)) out[k] = visit(v, ctx, depth + 1);
    return out;
  };

  return { payload: visit(payload, pathProject, 0), grantedConversations };
}

/** Only a successful provider creation response can establish creator access. */
export function createdProjectId(method: string, pathname: string, payload: unknown): string | null {
  if (method !== "POST" || !/^\/backend-api\/gizmos(?:\/snorlax)?\/?$/.test(pathname)) return null;
  if (!isPlainObject(payload)) return null;
  const candidate = payload.gizmo?.gizmo?.id ?? payload.gizmo?.id ?? payload.project?.id ?? payload.id;
  return isProjectId(candidate) ? candidate.toLowerCase() : null;
}
