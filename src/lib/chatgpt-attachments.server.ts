import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { encryptChatGptSession, decryptChatGptSession } from "./chatgpt-session.server";
import {
  attachmentRefs,
  boundedBytes,
  signedAssetUrl,
  MAX_ATTACHMENT_BYTES,
  type AttachmentRef,
} from "./chatgpt-attachment-model";
import { HistoryContextError, type HistorySnapshot } from "./chatgpt-history-model";
const db = () => supabaseAdmin as any;
const BUCKET = "chatgpt-private-attachments";
const hash = (v: string | Uint8Array) => createHash("sha256").update(v).digest("hex");
const check = (r: any) => {
  if (r.error) throw Error("Private attachment storage is temporarily unavailable.");
  return r.data;
};
export const attachmentStorageEnabled = () => process.env.CHATGPT_ATTACHMENT_HISTORY === "1";
function descriptor(row: any, userId: string, threadId: string) {
  const e = JSON.parse(decryptChatGptSession(row.encrypted_descriptor));
  if (
    e.kind !== "chatgpt-attachment-v1" ||
    e.userId !== userId ||
    e.threadId !== threadId ||
    e.id !== row.id
  )
    throw Error("Invalid attachment ownership.");
  return e.ref as AttachmentRef;
}
export async function attachmentRows(userId: string, threadId: string) {
  const rows: any[] = [];
  for (let offset = 0; ; offset += 100) {
    const page = check(
      await db()
        .from("chatgpt_history_attachments")
        .select("*")
        .eq("user_id", userId)
        .eq("thread_id", threadId)
        .order("id")
        .range(offset, offset + 99),
    );
    rows.push(...page);
    if (page.length < 100) break;
  }
  return rows.map((row) => ({ ...row, ref: descriptor(row, userId, threadId) }));
}
export async function registerWriterFile(userId: string, identity: string, fileId: string) {
  if (!/^file-[A-Za-z0-9_-]{1,200}$/.test(fileId)) throw Error("Invalid provider file ID.");
  check(
    await db()
      .from("chatgpt_file_owners")
      .upsert(
        { provider_identity: identity, file_id: fileId, user_id: userId },
        { onConflict: "provider_identity,file_id", ignoreDuplicates: true },
      ),
  );
  if (!(await ownsWriterFile(userId, identity, fileId))) throw Error("File ownership conflict.");
}
export async function ownsWriterFile(userId: string, identity: string, fileId: string) {
  const row = check(
    await db()
      .from("chatgpt_file_owners")
      .select("user_id")
      .eq("provider_identity", identity)
      .eq("file_id", fileId)
      .maybeSingle(),
  );
  return row?.user_id === userId;
}
async function resolveBytes(ref: AttachmentRef, conversationId: string, headers: Headers) {
  const path =
    ref.kind === "download"
      ? "/backend-api/conversation/" +
        conversationId +
        "/interpreter/download?" +
        new URLSearchParams({ message_id: ref.messageId, sandbox_path: ref.path! })
      : "/backend-api/files/" + encodeURIComponent(ref.fileId!) + "/download";
  const h = new Headers(headers);
  h.set("Accept", "application/json");
  h.delete("content-type");
  h.delete("content-length");
  let response = await fetch("https://chatgpt.com" + path, {
    headers: h,
    redirect: "manual",
    signal: AbortSignal.timeout(30000),
  });
  if (response.status === 404 && ref.fileId)
    response = await fetch(
      "https://chatgpt.com/backend-api/files/download/" + encodeURIComponent(ref.fileId),
      { headers: h, redirect: "manual", signal: AbortSignal.timeout(30000) },
    );
  if (!response.ok) throw Error("Provider attachment unavailable (HTTP " + response.status + ").");
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const info = await response.json(),
      url = signedAssetUrl(info.download_url ?? info.url);
    response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(60000) }); // No cookies, bearer or client headers.
    if (!response.ok)
      throw Error("Provider attachment unavailable (HTTP " + response.status + ").");
  }
  const bytes = await boundedBytes(response);
  if (!bytes.length) throw Error("Provider returned an empty attachment.");
  const declared = (response.headers.get("content-type") ?? ref.mime).split(";")[0];
  const rawMime = declared === "application/octet-stream" ? ref.mime : declared;
  const mime = /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(rawMime) ? rawMime : "application/octet-stream";
  return { bytes, mime };
}
/** A successful snapshot owns its generated files; user files must originate from this writer's upload. */
export async function captureAttachments(
  userId: string,
  threadId: string,
  identity: string,
  conversationId: string,
  snapshot: HistorySnapshot,
  headers: Headers,
  legacy = false,
) {
  if (!attachmentStorageEnabled()) return;
  const refs = attachmentRefs(snapshot);
  let failed = 0;
  for (const ref of refs) {
    const id = hash(
      userId + "|" + threadId + "|" + identity + "|" + conversationId + "|" + ref.key,
    );
    const prior = check(
      await db()
        .from("chatgpt_history_attachments")
        .select("*")
        .eq("id", id)
        .eq("user_id", userId)
        .maybeSingle(),
    );
    if (prior?.status === "ready") continue;
    const row = {
      id,
      user_id: userId,
      thread_id: threadId,
      provider_identity: identity,
      source_key: hash(conversationId + "|" + ref.key),
      status: "pending",
      encrypted_descriptor: encryptChatGptSession(
        JSON.stringify({ kind: "chatgpt-attachment-v1", id, userId, threadId, ref }),
      ),
    };
    check(
      await db()
        .from("chatgpt_history_attachments")
        .upsert(row, { onConflict: "id", ignoreDuplicates: true }),
    );
    try {
      if (ref.kind === "unsupported") throw Error("Unsupported attachment type.");
      if (ref.fileId) {
        const owner = check(
          await db()
            .from("chatgpt_file_owners")
            .select("user_id")
            .eq("provider_identity", identity)
            .eq("file_id", ref.fileId)
            .maybeSingle(),
        );
        if (owner && owner.user_id !== userId) throw Error("Attachment ownership mismatch.");
        if (!owner && ref.role === "user" && !legacy)
          throw Error("Unverified attachment ownership.");
        if (!owner) await registerWriterFile(userId, identity, ref.fileId);
      }
      const { bytes, mime } = await resolveBytes(ref, conversationId, headers);
      ref.mime = mime;
      const digest = hash(bytes),
        storageKey = userId + "/" + threadId + "/" + id + ".json";
      const encrypted = encryptChatGptSession(
        JSON.stringify({
          kind: "chatgpt-attachment-bytes-v1",
          id,
          userId,
          threadId,
          sha256: digest,
          data: Buffer.from(bytes).toString("base64"),
        }),
      );
      check(
        await db()
          .storage.from(BUCKET)
          .upload(storageKey, Buffer.from(encrypted), {
            contentType: "application/json",
            upsert: true,
          }),
      );
      check(
        await db()
          .from("chatgpt_history_attachments")
          .update({
            status: "ready",
            storage_key: storageKey,
            byte_size: bytes.length,
            sha256: digest,
            encrypted_descriptor: encryptChatGptSession(
              JSON.stringify({ kind: "chatgpt-attachment-v1", id, userId, threadId, ref }),
            ),
            updated_at: new Date().toISOString(),
          })
          .eq("id", id)
          .eq("user_id", userId),
      );
    } catch (e) {
      // Expired/missing/oversized/unsupported sources are explicit gaps, never silent successes.
      const permanent = /HTTP (404|410)|25 MB|Unsupported attachment type|ownership/.test(
        String(e),
      );
      check(
        await db()
          .from("chatgpt_history_attachments")
          .update({
            status: permanent ? "unavailable" : "pending",
            updated_at: new Date().toISOString(),
          })
          .eq("id", id)
          .eq("user_id", userId)
          .neq("status", "ready"),
      );
      if (!permanent) failed++;
    }
  }
  if (failed)
    throw Error(
      "Some attachments could not be backed up. Retry before replacing the official account.",
    );
}
export async function readAttachment(userId: string, threadId: string, id: string) {
  if (!/^[0-9a-f]{64}$/.test(id)) return null;
  const row = check(
    await db()
      .from("chatgpt_history_attachments")
      .select("*")
      .eq("id", id)
      .eq("user_id", userId)
      .eq("thread_id", threadId)
      .maybeSingle(),
  );
  if (!row || row.status !== "ready") return null;
  const ref = descriptor(row, userId, threadId),
    expected = userId + "/" + threadId + "/" + id + ".json";
  if (row.storage_key !== expected) throw Error("Invalid attachment location.");
  const blob = check(await db().storage.from(BUCKET).download(expected));
  const e = JSON.parse(decryptChatGptSession(await blob.text()));
  if (
    e.kind !== "chatgpt-attachment-bytes-v1" ||
    e.id !== id ||
    e.userId !== userId ||
    e.threadId !== threadId
  )
    throw Error("Invalid attachment ownership.");
  const bytes = Buffer.from(e.data, "base64");
  if (
    bytes.length > MAX_ATTACHMENT_BYTES ||
    bytes.length !== row.byte_size ||
    hash(bytes) !== row.sha256 ||
    e.sha256 !== row.sha256
  )
    throw Error("Invalid attachment checksum.");
  return { ref, bytes };
}
export async function uploadAttachment(
  userId: string,
  identity: string,
  ref: AttachmentRef,
  bytes: Uint8Array,
  headers: Headers,
) {
  const h = new Headers(headers);
  h.set("Content-Type", "application/json");
  h.delete("content-length");
  h.set("Accept", "application/json");
  const created = await fetch("https://chatgpt.com/backend-api/files", {
    method: "POST",
    headers: h,
    body: JSON.stringify({
      file_name: ref.name,
      file_size: bytes.length,
      use_case: "multimodal",
      timezone_offset_min: -60,
    }),
    redirect: "manual",
    signal: AbortSignal.timeout(30000),
  });
  if (!created.ok)
    throw new HistoryContextError(
      "ChatGPT could not accept a saved attachment. Download it from Saved chats and attach it manually.",
    );
  const info = await created.json();
  if (!/^file-[A-Za-z0-9_-]{1,200}$/.test(info.file_id))
    throw new HistoryContextError("ChatGPT returned an unsupported upload response.");
  const upload = await fetch(signedAssetUrl(info.upload_url), {
    method: "PUT",
    headers: { "Content-Type": ref.mime, "x-ms-blob-type": "BlockBlob" },
    body: bytes as BodyInit,
    redirect: "error",
    signal: AbortSignal.timeout(60000),
  });
  if (!upload.ok)
    throw new HistoryContextError("Could not restore a saved attachment. Retry from Saved chats.");
  const complete = await fetch(
    "https://chatgpt.com/backend-api/files/" + info.file_id + "/uploaded",
    {
      method: "POST",
      headers: h,
      body: "{}",
      redirect: "manual",
      signal: AbortSignal.timeout(30000),
    },
  );
  if (!complete.ok)
    throw new HistoryContextError(
      "ChatGPT could not finish restoring an attachment. Retry from Saved chats.",
    );
  await registerWriterFile(userId, identity, info.file_id);
  return { id: info.file_id, name: ref.name, size: bytes.length, mime_type: ref.mime };
}
/** Restore each required saved asset to the new official login, then reference only NEW file IDs. */
export async function restoreAttachments(
  userId: string,
  threadId: string,
  snapshot: HistorySnapshot,
  identity: string,
  headers: Headers,
) {
  const required = attachmentRefs(snapshot);
  if (!required.length) return [];
  const rows = await attachmentRows(userId, threadId),
    chosen: any[] = [];
  for (const ref of required) {
    const row = rows.find((r) => r.ref.key === ref.key && r.status === "ready");
    if (!row)
      throw new HistoryContextError(
        "A file or image in this chat was not backed up. Open Saved chats to download available attachments and reattach the missing item.",
      );
    chosen.push(row);
  }
  if (
    chosen.length > 10 ||
    chosen.reduce((n, r) => n + Number(r.byte_size), 0) > MAX_ATTACHMENT_BYTES
  )
    throw new HistoryContextError(
      "This chat has too many attachments to restore together. Download the files you need from Saved chats and attach them manually.",
    );
  const restored = [];
  for (const row of chosen) {
    const saved = await readAttachment(userId, threadId, row.id);
    if (!saved) throw new HistoryContextError("Saved attachment is unavailable.");
    const file = await uploadAttachment(userId, identity, saved.ref, saved.bytes, headers);
    restored.push({ file, ref: saved.ref });
  }
  return restored;
}

// A reply's final token must not wait for several binary downloads. Account replacement
// uses the synchronous path; it cannot proceed while a transient backup failure remains.
const captures = new Map<string, Promise<void>>();
export function scheduleAttachmentCapture(
  userId: string,
  threadId: string,
  identity: string,
  conversationId: string,
  snapshot: HistorySnapshot,
  headers: Headers,
) {
  if (!attachmentStorageEnabled()) return;
  const key = userId + "|" + threadId + "|" + identity + "|" + conversationId;
  const previous = captures.get(key) ?? Promise.resolve();
  const task = previous
    .catch(() => {})
    .then(() => captureAttachments(userId, threadId, identity, conversationId, snapshot, headers));
  captures.set(key, task);
  void task
    .catch(() => console.error("[chatgpt-history] attachment backup pending"))
    .finally(() => {
      if (captures.get(key) === task) captures.delete(key);
    });
}
export async function drainAttachmentCaptures() {
  await Promise.all([...captures.values()].map((p) => p.catch(() => {})));
}

/** Expired logins may be replaced only when all known attachment gaps are explicit. */
export async function attachmentsAccountedFor(
  userId: string,
  threadId: string,
  snapshot: HistorySnapshot,
) {
  if (!attachmentStorageEnabled()) return true;
  const rows = await attachmentRows(userId, threadId);
  return attachmentRefs(snapshot).every((ref) =>
    rows.some((r) => r.ref.key === ref.key && ["ready", "unavailable"].includes(r.status)),
  );
}
