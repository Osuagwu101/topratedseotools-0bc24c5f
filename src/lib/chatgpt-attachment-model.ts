import { historyMessages, type HistorySnapshot } from "./chatgpt-history-model";
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export type AttachmentRef = {
  key: string;
  messageId: string;
  role: string;
  kind: "file" | "image" | "download" | "unsupported";
  fileId?: string;
  path?: string;
  name: string;
  mime: string;
  width?: number;
  height?: number;
};
const fileId = (v: unknown) =>
  typeof v === "string" && /^file-[A-Za-z0-9_-]{1,200}$/.test(v) ? v : undefined;
const name = (v: unknown, fallback: string) =>
  String(v || fallback)
    .split(/[\\/]/)
    .pop()!
    .replace(/[\x00-\x1f\x7f]/g, "")
    .slice(0, 240) || fallback;
/** Only visible messages can supply downloadable or replayable attachments. Never follow arbitrary URLs. */
export function attachmentRefs(snapshot: HistorySnapshot): AttachmentRef[] {
  const refs = new Map<string, AttachmentRef>();
  for (const m of historyMessages(snapshot)) {
    const messageId = String(m.id ?? "");
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(messageId)) continue;
    const add = (r: Omit<AttachmentRef, "key" | "messageId" | "role">) => {
      const key = messageId + ":" + (r.fileId ?? r.path ?? r.name);
      const old = refs.get(key);
      refs.set(key, {
        ...old,
        ...r,
        name: old?.name ?? r.name,
        mime: old?.mime && old.mime !== "application/octet-stream" ? old.mime : r.mime,
        kind: old?.kind === "image" ? "image" : r.kind,
        key,
        messageId,
        role: m.author.role,
      });
    };
    for (const a of m.metadata?.attachments ?? []) {
      const id = fileId(a.id ?? a.file_id);
      add({
        kind: id ? "file" : "unsupported",
        fileId: id,
        name: name(a.name, "attachment"),
        mime: String(a.mime_type ?? "application/octet-stream"),
      });
    }
    for (const p of m.content?.parts ?? []) {
      if (typeof p === "string") {
        for (const match of p.matchAll(/\[[^\]\n]*\]\(sandbox:(\/mnt\/data\/[^)\r\n]+)\)/g)) {
          let path: string;
          try {
            path = decodeURIComponent(match[1]);
          } catch {
            continue;
          }
          if (path.length > 1000 || /[\x00-\x1f]/.test(path) || path.split("/").includes(".."))
            continue;
          add({
            kind: "download",
            path,
            name: name(path, "download"),
            mime: "application/octet-stream",
          });
        }
      } else if (p && typeof p === "object") {
        const raw = p.asset_pointer ?? p.image_asset_pointer,
          id = fileId(typeof raw === "string" ? raw.replace(/^file-service:\/\//, "") : null);
        add({
          kind: id ? "image" : "unsupported",
          fileId: id,
          name: name(p.name, id ? id + ".png" : "unsupported attachment"),
          mime: "image/png",
          width: Number(p.width) || undefined,
          height: Number(p.height) || undefined,
        });
      }
    }
  }
  return [...refs.values()];
}
export function signedAssetUrl(raw: unknown): URL {
  if (typeof raw !== "string") throw Error("Missing provider attachment URL.");
  const u = new URL(raw);
  // Exact provider storage suffixes; never send the official login to these hosts.
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.port ||
    !(
      u.hostname.endsWith(".oaiusercontent.com") ||
      u.hostname.endsWith(".blob.core.windows.net") ||
      u.hostname === "files.oaiusercontent.com"
    )
  )
    throw Error("Unsupported provider attachment host.");
  return u;
}
export async function boundedBytes(
  response: Response,
  max = MAX_ATTACHMENT_BYTES,
): Promise<Uint8Array> {
  if (Number(response.headers.get("content-length")) > max)
    throw Error("Attachment exceeds the 25 MB backup limit.");
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > max) throw Error("Attachment exceeds the 25 MB backup limit.");
      chunks.push(next.value);
    }
  } catch (e) {
    await reader.cancel();
    throw e;
  }
  const out = new Uint8Array(size);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}
