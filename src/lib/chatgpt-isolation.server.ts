/*
 * Per-customer ChatGPT history on a shared ChatGPT account.
 *
 * Every writer uses the same upstream ChatGPT login, so ChatGPT itself would
 * show everyone's chats to everyone. The proxy records which TopRatedSEOTools
 * user created each conversation and:
 *   - filters history lists, search, pins and the server-rendered sidebar,
 *   - refuses to open / continue / rename conversations owned by someone else,
 *   - blocks deleting and archiving chats entirely,
 *   - hides account-wide surfaces (memories, image library, scheduled tasks).
 * Conversations created before this existed have no owner and are hidden
 * from every writer.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const UUID_RE = new RegExp(`^${UUID}$`, "i");

// ---------------------------------------------------------------- path rules

/** Conversation id addressed by an API path, e.g. /backend-api/conversation/<id>/... */
export function conversationIdFromApiPath(pathname: string): string | null {
  const m = pathname.match(
    new RegExp(`^/(?:backend-api|backend-anon)/(?:f/)?conversations?/(${UUID})(?:/|$)`, "i"),
  );
  return m ? m[1].toLowerCase() : null;
}

/** Conversation id addressed by a page URL, e.g. /c/<id> or /g/<gpt>/c/<id>. */
export function conversationIdFromDocumentPath(pathname: string): string | null {
  const m = pathname.match(new RegExp(`(?:^|/)c/(${UUID})(?:/|$)`, "i"));
  return m ? m[1].toLowerCase() : null;
}

/** Conversation id a request body refers to (follow-ups, init, regenerate). */
export function conversationIdFromBody(bodyText: string | null | undefined): string | null {
  if (!bodyText) return null;
  const m = bodyText.match(new RegExp(`"conversation_id"\\s*:\\s*"(${UUID})"`, "i"));
  return m ? m[1].toLowerCase() : null;
}

/** First conversation id announced in a streamed /f/conversation response. */
export function conversationIdFromStreamText(text: string): string | null {
  const m = text.match(new RegExp(`"conversation_id"\\s*:\\s*"(${UUID})"`, "i"));
  return m ? m[1].toLowerCase() : null;
}

export function isConversationListPath(pathname: string) {
  return /^\/backend-api\/conversations\/?$/i.test(pathname);
}

export function isConversationSearchPath(pathname: string) {
  return /^\/backend-api\/conversations\/search\/?$/i.test(pathname);
}

export function isPinsPath(pathname: string) {
  return /^\/backend-api\/pins\/?$/i.test(pathname);
}

/** Account-wide surfaces that would show other writers' activity. */
export function hiddenAccountSurface(method: string, pathname: string): unknown | null {
  if (method.toUpperCase() !== "GET") return null;
  if (/^\/backend-api\/memories\/?$/i.test(pathname)) return { memories: [], memory_max_tokens: 0, memory_num_tokens: 0 };
  if (/^\/backend-api\/my\/recent\/image_gen\/?$/i.test(pathname)) return { items: [], cursor: null };
  if (/^\/backend-api\/automations\/?$/i.test(pathname)) return { items: [], cursor: null };
  return null;
}

/**
 * Deleting or archiving chats is never allowed through the proxy (single,
 * bulk, or "delete all"). Renaming stays allowed for the owner.
 */
export function isBlockedConversationMutation(
  method: string,
  pathname: string,
  bodyText: string | null | undefined,
) {
  const m = method.toUpperCase();
  const isConversationPath = /^\/backend-api\/conversations?(?:\/|$)/i.test(pathname);
  if (!isConversationPath) return false;
  if (m === "DELETE") return true;
  if (m === "PATCH" || m === "POST" || m === "PUT") {
    // Bulk endpoints: /backend-api/conversations (PATCH = delete/archive all).
    if (/^\/backend-api\/conversations\/?$/i.test(pathname) && m !== "POST") return true;
    if (/\/(?:archive|delete|bulk_archive|bulk_delete)(?:\/|$)/i.test(pathname)) return true;
    const body = bodyText ?? "";
    if (/"is_visible"\s*:\s*false/i.test(body)) return true;
    if (/"is_archived"\s*:\s*true/i.test(body)) return true;
  }
  return false;
}

// ---------------------------------------------------------- payload filters

type Owned = { has(id: string): boolean };
const own = (owned: Owned, id: unknown) =>
  typeof id === "string" && owned.has(id.toLowerCase());

export function filterSearchPayload(payload: any, owned: Owned) {
  if (!payload || !Array.isArray(payload.items)) return payload;
  return { ...payload, items: payload.items.filter((i: any) => own(owned, i?.conversation_id ?? i?.id)) };
}

export function filterPinsPayload(payload: any, owned: Owned) {
  const keep = (p: any) => {
    const id = p?.item?.id ?? p?.item?.conversation_id ?? p?.conversation_id ?? p?.id;
    // Non-conversation pins (e.g. GPTs) carry no conversation id: keep them.
    if (typeof id === "string" && UUID_RE.test(id)) return own(owned, id);
    return true;
  };
  if (Array.isArray(payload)) return payload.filter(keep);
  if (payload && Array.isArray(payload.items)) return { ...payload, items: payload.items.filter(keep) };
  return payload;
}

function conversationIdOf(v: any): string | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const id = v.id ?? v.conversation_id;
  const looksLikeConversation =
    typeof id === "string" &&
    UUID_RE.test(id) &&
    "title" in v &&
    ("create_time" in v || "update_time" in v);
  return looksLikeConversation ? id.toLowerCase() : null;
}

/**
 * Remove foreign conversations from any list in a JSON payload (history,
 * search, pins `{item: conversation}`, project sidebars, ...).
 */
export function deepFilterConversations(payload: any, owned: Owned, depth = 0): any {
  if (depth > 12 || payload === null || typeof payload !== "object") return payload;
  if (Array.isArray(payload)) {
    return payload
      .filter((el) => {
        const id = conversationIdOf(el) ?? conversationIdOf(el?.item) ?? conversationIdOf(el?.conversation);
        return id === null || owned.has(id);
      })
      .map((el) => deepFilterConversations(el, owned, depth + 1));
  }
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(payload)) out[k] = deepFilterConversations(v, owned, depth + 1);
  return out;
}

/** Combine upstream pages into the caller's page of owned conversations. */
export function buildOwnedConversationPage(
  upstreamPages: any[],
  owned: Owned,
  offset: number,
  limit: number,
) {
  const all = upstreamPages.flatMap((p) => (Array.isArray(p?.items) ? p.items : []));
  const mine = all.filter((i: any) => own(owned, i?.id));
  const base = upstreamPages[0] && typeof upstreamPages[0] === "object" ? upstreamPages[0] : {};
  return {
    ...base,
    items: mine.slice(offset, offset + limit),
    total: mine.length,
    limit,
    offset,
    has_missing_conversations: false,
  };
}

// ------------------------------------------------- server-rendered sidebar

/*
 * chatgpt.com server-renders the sidebar history into React Router
 * "turbo-stream" chunks: `streamController.enqueue("<lines>")`. Each line is a
 * JSON array of values; objects are `{"_<keyIdx>": <valueIdx>}` and arrays hold
 * value indexes, all sharing one global index space across lines/chunks.
 * We drop foreign conversations from every list array (indexes stay valid
 * because top-level positions never move) and blank their titles/ids.
 */
const ENQUEUE_RE = /streamController\.enqueue\(("(?:[^"\\]|\\.)*")\)/g;

function encodeForScript(payload: string) {
  return JSON.stringify(payload)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function filterServerRenderedHistory(html: string, owned: Owned): string {
  type Line = { chunk: number; prefix: string; values: any[] | null; raw: string };
  const chunks: { literal: string; lines: Line[] }[] = [];
  let m: RegExpExecArray | null;
  ENQUEUE_RE.lastIndex = 0;
  while ((m = ENQUEUE_RE.exec(html))) {
    let payload: string;
    try {
      payload = JSON.parse(m[1]);
    } catch {
      continue;
    }
    const lines: Line[] = payload.split("\n").map((raw) => {
      const pm = raw.match(/^([A-Z]\d+:)?(\[.*\])$/s);
      if (!pm) return { chunk: chunks.length, prefix: "", values: null, raw };
      try {
        const values = JSON.parse(pm[2]);
        return { chunk: chunks.length, prefix: pm[1] ?? "", values: Array.isArray(values) ? values : null, raw };
      } catch {
        return { chunk: chunks.length, prefix: "", values: null, raw };
      }
    });
    chunks.push({ literal: m[1], lines });
  }
  if (!chunks.length) return html;

  // Global index space.
  const G: any[] = [];
  const where: { line: Line; local: number }[] = [];
  for (const c of chunks)
    for (const line of c.lines)
      if (line.values)
        line.values.forEach((v, local) => {
          G.push(v);
          where.push({ line, local });
        });

  const keyName = (k: string) => (k.startsWith("_") ? G[Number(k.slice(1))] : undefined);
  const isObj = (v: any) => v && typeof v === "object" && !Array.isArray(v);

  // Conversation objects: have id (uuid) + title + create_time keys.
  const foreignObjects = new Set<number>();
  const foreignStrings = new Set<number>();
  const ownedStrings = new Set<number>();
  G.forEach((v, i) => {
    if (!isObj(v)) return;
    let idIdx = -1;
    let titleIdx = -1;
    let hasCreate = false;
    for (const [k, vi] of Object.entries(v)) {
      const name = keyName(k);
      if (name === "id" || name === "conversation_id") idIdx = vi as number;
      else if (name === "title") titleIdx = vi as number;
      else if (name === "create_time" || name === "update_time") hasCreate = true;
    }
    if (idIdx < 0 || !hasCreate) return;
    const id = G[idIdx];
    if (typeof id !== "string" || !UUID_RE.test(id)) return;
    if (own(owned, id)) {
      ownedStrings.add(idIdx);
      if (titleIdx >= 0) ownedStrings.add(titleIdx);
      return;
    }
    foreignObjects.add(i);
    foreignStrings.add(idIdx);
    if (titleIdx >= 0) foreignStrings.add(titleIdx);
  });
  if (!foreignObjects.size) return html;

  // Wrappers (e.g. pins: {item: <conversation>}) of foreign conversations.
  G.forEach((v, i) => {
    if (!isObj(v) || foreignObjects.has(i)) return;
    if (Object.values(v).some((vi) => foreignObjects.has(vi as number))) foreignObjects.add(i);
  });

  // Remove foreign entries from every list.
  G.forEach((v, i) => {
    if (!Array.isArray(v)) return;
    const next = v.filter((x) => !(typeof x === "number" && foreignObjects.has(x)));
    if (next.length !== v.length) {
      const { line, local } = where[i];
      line.values![local] = next;
    }
  });
  // Blank foreign titles/ids unless an owned conversation shares the value.
  for (const s of foreignStrings) {
    if (ownedStrings.has(s)) continue;
    const { line, local } = where[s];
    line.values![local] = "";
  }

  let out = html;
  for (const c of chunks) {
    const payload = c.lines
      .map((l) => (l.values ? l.prefix + JSON.stringify(l.values) : l.raw))
      .join("\n");
    out = out.replace(c.literal, () => encodeForScript(payload));
  }
  return out;
}

// --------------------------------------------------------- ownership store

const OWNER_CACHE_MAX = 20_000;
const ownerCache = new Map<string, string>(); // conversation_id -> user_id
const userSetCache = new Map<string, { ids: Set<string>; until: number }>();
const USER_SET_TTL_MS = 30_000;

function rememberOwner(conversationId: string, userId: string) {
  if (ownerCache.size > OWNER_CACHE_MAX) ownerCache.clear();
  ownerCache.set(conversationId, userId);
  userSetCache.get(userId)?.ids.add(conversationId);
}

export async function ownerOfConversation(conversationId: string): Promise<string | null> {
  const id = conversationId.toLowerCase();
  const hit = ownerCache.get(id);
  if (hit) return hit;
  const { data } = await (supabaseAdmin as any)
    .from("chatgpt_conversation_owners")
    .select("user_id")
    .eq("conversation_id", id)
    .maybeSingle();
  if (data?.user_id) {
    rememberOwner(id, String(data.user_id));
    return String(data.user_id);
  }
  return null;
}

export async function ownedConversationIds(userId: string): Promise<Set<string>> {
  const cached = userSetCache.get(userId);
  if (cached && cached.until > Date.now()) return cached.ids;
  const { data, error } = await (supabaseAdmin as any)
    .from("chatgpt_conversation_owners")
    .select("conversation_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(5000);
  if (error) throw new Error(error.message);
  const ids = new Set<string>(((data ?? []) as any[]).map((r) => String(r.conversation_id).toLowerCase()));
  if (userSetCache.size > 5000) userSetCache.clear();
  userSetCache.set(userId, { ids, until: Date.now() + USER_SET_TTL_MS });
  return ids;
}

/** Record the creator of a new conversation. First writer wins. */
export async function claimConversation(conversationId: string, userId: string) {
  const id = conversationId.toLowerCase();
  const existing = ownerCache.get(id);
  if (existing) return existing === userId;
  rememberOwner(id, userId);
  const { error } = await (supabaseAdmin as any)
    .from("chatgpt_conversation_owners")
    .upsert({ conversation_id: id, user_id: userId }, { onConflict: "conversation_id", ignoreDuplicates: true });
  if (error) console.warn("[chatgpt-isolation] could not record conversation owner", error.message);
  const owner = await ownerOfConversation(id).catch(() => userId);
  return owner === userId;
}

/**
 * Pass a streamed /f/conversation response through untouched while watching
 * for the conversation id, then record the writer as its owner.
 */
export function teeConversationOwnership(
  body: ReadableStream<Uint8Array>,
  userId: string,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  let seen = "";
  let done = false;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        if (!done) {
          seen = (seen + decoder.decode(chunk, { stream: true })).slice(-65_536);
          const id = conversationIdFromStreamText(seen);
          if (id) {
            done = true;
            void claimConversation(id, userId);
          }
        }
        controller.enqueue(chunk);
      },
    }),
  );
}
