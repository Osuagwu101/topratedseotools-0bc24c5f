// Disposable fixtures only. Never rotates an official login or modifies a customer.
import { strict as assert } from "node:assert";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { chmodSync } from "node:fs";
import { supabaseAdmin } from "../../src/integrations/supabase/client.server";
import { decryptChatGptSession } from "../../src/lib/chatgpt-session.server";
import { chatGptAccountSession } from "../../src/lib/chatgpt-account-auth.server";
import {
  createChatGPTProxyLaunch,
  handleChatGPTProxyRequest,
  buildChatGPTCookieHeader,
} from "../../src/lib/chatgpt-proxy.server";
import { saveSnapshot, historyHash, savedThread } from "../../src/lib/chatgpt-history.server";
import {
  downloadProviderFile,
  uploadAttachment,
  captureAttachments,
  attachmentRows,
  readAttachment,
  restoreAttachments,
} from "../../src/lib/chatgpt-attachments.server";
import { signedAssetUrl, type AttachmentRef } from "../../src/lib/chatgpt-attachment-model";
const db = supabaseAdmin as any,
  origin = "https://chatgpt.topratedseotools.com";
const fixtureFile = "/home/ubuntu/chatgpt-attachment-qa-fixtures.json";
const check = (r: any) => {
  assert(!r.error, "QA database operation failed");
  return r.data;
};
if (process.argv.includes("--cleanup")) {
  const fixtures = await Bun.file(fixtureFile).json();
  const ids = fixtures.map((f: any) => f.user);
  check(await db.from("chatgpt_proxy_sessions").update({ status: "revoked" }).in("user_id", ids));
  check(
    await db
      .from("tool_access_grants")
      .update({ status: "revoked", notes: "Completed ChatGPT attachment continuity QA fixture." })
      .in("user_id", ids),
  );
  console.log("Attachment QA grants and sessions revoked.");
  process.exit(0);
}
if (process.argv.includes("--launch")) {
  const fixtures = await Bun.file(fixtureFile).json(),
    f = fixtures[Number(process.argv.at(-1)) || 0];
  console.log(
    JSON.stringify({
      url: (await createChatGPTProxyLaunch(f.user)).launchUrl,
      thread: f.id,
      colour: f.colour,
    }),
  );
  process.exit(0);
}
function png(red: boolean) {
  const crc = (b: Buffer) => {
    let v = 0xffffffff;
    for (const x of b) {
      v ^= x;
      for (let j = 0; j < 8; j++) v = (v >>> 1) ^ (v & 1 ? 0xedb88320 : 0);
    }
    return (v ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const t = Buffer.from(type),
      n = Buffer.alloc(4),
      c = Buffer.alloc(4);
    n.writeUInt32BE(data.length);
    c.writeUInt32BE(crc(Buffer.concat([t, data])));
    return Buffer.concat([n, t, data, c]);
  };
  const h = Buffer.alloc(13);
  h.writeUInt32BE(80);
  h.writeUInt32BE(80, 4);
  h[8] = 8;
  h[9] = 2;
  const rows = Buffer.alloc(80 * (80 * 3 + 1));
  for (let y = 0; y < 80; y++)
    for (let x = 0; x < 80; x++) rows[y * 241 + 1 + x * 3 + (red ? 0 : 2)] = 255;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", h),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const account = check(
  await db.from("tool_accounts").select("id").eq("tool_slug", "chatgpt").limit(1).single(),
);
const stored = check(
  await db
    .from("chatgpt_provider_accounts")
    .select("encrypted_payload")
    .eq("account_key", "account_1")
    .single(),
);
const h = new Headers({
  Cookie: buildChatGPTCookieHeader(
    decryptChatGptSession(stored.encrypted_payload),
    "https://chatgpt.com/api/auth/session",
  ),
  Origin: "https://chatgpt.com",
  Referer: "https://chatgpt.com/",
  "User-Agent": "Mozilla/5.0",
});
const provider = await chatGptAccountSession("account_1", stored.encrypted_payload, h);
assert(provider.identity);
h.set("Authorization", "Bearer " + provider.token);
const fixtures: any[] = [];
try {
  for (let i = 0; i < 2; i++) {
    const created = await db.auth.admin.createUser({
      email: "chatgpt-attachment-qa-" + Date.now() + "-" + i + "@topratedseotools.com",
      password: randomBytes(32).toString("base64url"),
      email_confirm: true,
      user_metadata: { is_qa_fixture: true, purpose: "ChatGPT attachment continuity" },
    });
    assert(!created.error && created.data.user);
    const user = created.data.user.id,
      id = randomUUID(),
      root = randomUUID(),
      msg = randomUUID(),
      reply = randomUUID(),
      marker = "FILE" + randomBytes(5).toString("hex").toUpperCase();
    const grant = check(
      await db
        .from("tool_access_grants")
        .insert({
          user_id: user,
          tool_slug: "chatgpt",
          account_id: account.id,
          status: "active",
          expires_at: new Date(Date.now() + 3600000).toISOString(),
          notes: "Disposable ChatGPT attachment QA fixture; no customer balance changed.",
        })
        .select("id")
        .single(),
    );
    const f = { user, id, marker, grant: grant.id, colour: i === 0 ? "red" : "blue" };
    fixtures.push(f);
    await Bun.write(fixtureFile, JSON.stringify(fixtures));
    chmodSync(fixtureFile, 0o600);
    const text = Buffer.from("The private verification word in this file is " + marker + ".\n"),
      image = png(i === 0);
    const docRef: AttachmentRef = {
      kind: "file",
      key: "doc",
      messageId: msg,
      role: "user",
      name: "verification.txt",
      mime: "text/plain",
    };
    const imageRef: AttachmentRef = {
      kind: "image",
      key: "image",
      messageId: msg,
      role: "user",
      name: "colour.png",
      mime: "image/png",
      width: 80,
      height: 80,
    };
    const doc = await uploadAttachment(user, provider.identity, docRef, text, h),
      img = await uploadAttachment(user, provider.identity, imageRef, image, h);
    check(
      await db
        .from("chatgpt_conversation_owners")
        .insert({ conversation_id: id, user_id: user, provider_account_key: "account_1" }),
    );
    const snapshot = {
      id,
      conversation_id: id,
      title: "Attachment continuity QA " + (i + 1),
      create_time: Date.now() / 1000,
      update_time: Date.now() / 1000,
      current_node: reply,
      mapping: {
        [root]: { id: root, parent: null, children: [msg], message: null },
        [msg]: {
          id: msg,
          parent: root,
          children: [reply],
          message: {
            id: msg,
            author: { role: "user" },
            content: {
              content_type: "multimodal_text",
              parts: [
                {
                  content_type: "image_asset_pointer",
                  asset_pointer: "file-service://" + img.id,
                  width: 80,
                  height: 80,
                },
                "Keep these two attachments available for my next question.",
              ],
            },
            metadata: { attachments: [doc, img] },
          },
        },
        [reply]: {
          id: reply,
          parent: msg,
          children: [],
          message: {
            id: reply,
            author: { role: "assistant" },
            content: {
              content_type: "text",
              parts: ["Ask your next question about the saved attachments."],
            },
          },
        },
      },
    };
    // A prior identity tests the saved-thread handoff. Production logins are never changed.
    await saveSnapshot(
      user,
      "account_1",
      historyHash("attachment-qa-prior-account-" + i),
      id,
      snapshot,
    );
    await captureAttachments(user, id, provider.identity, id, snapshot, h);
    const rows = await attachmentRows(user, id);
    assert.equal(rows.length, 2);
    assert(rows.every((r) => r.status === "ready"));
    for (const row of rows) {
      const bytes = await readAttachment(user, id, row.id);
      assert(bytes);
      assert.equal(
        createHash("sha256").update(bytes.bytes).digest("hex"),
        createHash("sha256")
          .update(row.ref.kind === "image" ? image : text)
          .digest("hex"),
      );
    }
    const restored = await restoreAttachments(user, id, snapshot, provider.identity, h);
    assert.equal(restored.length, 2);
    assert(restored.every((r) => r.file.id !== doc.id && r.file.id !== img.id));
    for (const r of restored) {
      const meta = await fetch("https://chatgpt.com/backend-api/files/" + r.file.id + "/download", {
        headers: h,
      }).then((r) => r.json());
      const downloaded = await downloadProviderFile(meta.download_url, h, r.file.id);
      assert(downloaded.ok);
      const bytes = new Uint8Array(await downloaded.arrayBuffer());
      assert.equal(
        createHash("sha256").update(bytes).digest("hex"),
        createHash("sha256")
          .update(r.ref.kind === "image" ? image : text)
          .digest("hex"),
      );
    }
    console.log(
      "Writer " +
        (i + 1) +
        ": real document/image upload, encrypted private roundtrip and new-file-ID restoration passed.",
    );
  }
  for (let i = 0; i < 2; i++) {
    const f = fixtures[i],
      other = fixtures[1 - i],
      fp = randomBytes(16).toString("hex"),
      launch = await createChatGPTProxyLaunch(f.user, fp);
    const landed = await handleChatGPTProxyRequest(new Request(launch.launchUrl));
    assert.equal(landed.status, 302);
    const cookies = landed.headers
      .getSetCookie()
      .map((v) => v.split(";")[0])
      .join("; ");
    const call = (path: string) =>
      handleChatGPTProxyRequest(
        new Request(origin + path, { headers: { Cookie: cookies, Accept: "text/html" } }),
      );
    const row = (await attachmentRows(f.user, f.id)).find((r) => r.ref.kind === "file")!;
    const path = "/__trst/history/" + f.id + "/attachments/" + row.id;
    assert((await (await call(path)).text()).includes(f.marker));
    const otherRow = (await attachmentRows(other.user, other.id))[0];
    assert.equal(
      (await call("/__trst/history/" + other.id + "/attachments/" + otherRow.id)).status,
      404,
    );
    check(
      await db
        .from("tool_access_grants")
        .update({ expires_at: new Date(Date.now() - 1000).toISOString() })
        .eq("id", f.grant),
    );
    assert.equal((await call(path)).status, 401);
    check(
      await db
        .from("tool_access_grants")
        .update({ expires_at: new Date(Date.now() + 3600000).toISOString() })
        .eq("id", f.grant),
    );
    check(
      await db.from("chatgpt_proxy_sessions").update({ status: "revoked" }).eq("user_id", f.user),
    );
    assert(await savedThread(f.user, f.id));
  }
  console.log(
    "Two-writer private downloads, foreign denial, expiry denial and retained attachment data passed. Native QA fixtures retained until --cleanup.",
  );
} catch (error) {
  console.error("Attachment acceptance failed; fixture IDs retained for safe cleanup.");
  throw error;
}
