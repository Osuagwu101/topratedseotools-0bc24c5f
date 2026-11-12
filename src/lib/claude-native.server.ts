/* Super Admin-only native browser pilot. No writer or paid access enables it. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash, randomBytes } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { decryptClaudeSession, type ClaudeSessionState } from "@/lib/claude-session.server";
import { CLAUDE_NATIVE_APP_ORIGIN, CLAUDE_NATIVE_EXTENSION_ID } from "@/lib/claude-native-config";
const db = supabaseAdmin as any;
const TABLE = "claude_native_admin_handoffs";
const extensionOrigin = `chrome-extension://${CLAUDE_NATIVE_EXTENSION_ID}`;
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
async function superAdmin(userId: string) {
  const { data, error } = await db.rpc("is_super_admin", { _user_id: userId });
  if (error || data !== true)
    throw new Error("Only a Super Admin can run the native Claude pilot.");
}
async function vault() {
  const { data, error } = await db
    .from("tool_authorized_sessions")
    .select("status,updated_at,encrypted_payload")
    .eq("tool_slug", "claude")
    .maybeSingle();
  if (error || data?.status !== "stored" || !data.encrypted_payload || !data.updated_at)
    throw new Error("Save an authorised Claude session first.");
  const state: ClaudeSessionState = JSON.parse(decryptClaudeSession(data.encrypted_payload));
  const keys = state.cookies.filter(
    (c) =>
      c.name === "sessionKey" &&
      c.domain.toLowerCase().replace(/^\./, "") === "claude.ai" &&
      c.path === "/" &&
      (!c.expires || c.expires < 0 || c.expires * 1000 > Date.now()),
  );
  if (keys.length !== 1)
    throw new Error("Save one current Claude sessionKey cookie for the root path first.");
  return { row: data, key: keys[0] };
}
export async function issueClaudeNativeAdminHandoff(userId: string) {
  await superAdmin(userId);
  const { row } = await vault();
  const { count, error: countError } = await db
    .from(TABLE)
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", new Date(Date.now() - 300000).toISOString());
  if (countError) throw new Error("Could not prepare the Claude pilot.");
  if ((count ?? 0) >= 5)
    throw new Error("Please wait a few minutes before another Claude pilot launch.");
  const ticket = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 60000).toISOString();
  const { error } = await db
    .from(TABLE)
    .insert({
      token_hash: hash(ticket),
      user_id: userId,
      vault_updated_at: row.updated_at,
      status: "issued",
      expires_at: expiresAt,
    });
  if (error) throw new Error("Could not prepare the Claude pilot.");
  return { ticket, expires_at: expiresAt };
}
function reply(status: number, body: unknown, cors = false) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      ...(cors
        ? {
            "Access-Control-Allow-Origin": extensionOrigin,
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
            Vary: "Origin",
          }
        : {}),
    },
  });
}
export async function handleClaudeNativeRedeem(request: Request) {
  if (
    new URL(request.url).origin !== CLAUDE_NATIVE_APP_ORIGIN ||
    request.headers.get("origin") !== extensionOrigin
  )
    return reply(403, { ok: false, error: "Extension origin required" });
  if (request.method === "OPTIONS") return reply(204, null, true);
  if (request.method !== "POST") return reply(405, { ok: false, error: "POST required" }, true);
  if (!(request.headers.get("content-type") ?? "").startsWith("application/json"))
    return reply(415, { ok: false, error: "JSON required" }, true);
  if (Number(request.headers.get("content-length") ?? 0) > 256)
    return reply(413, { ok: false, error: "Request too large" }, true);
  try {
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength > 256) return reply(413, { ok: false, error: "Request too large" }, true);
    const input = JSON.parse(new TextDecoder().decode(bytes));
    if (!input || typeof input.ticket !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(input.ticket))
      return reply(400, { ok: false, error: "Invalid pilot ticket" }, true);
    const { data: row, error } = await db
      .from(TABLE)
      .select("id,user_id,status,expires_at,vault_updated_at")
      .eq("token_hash", hash(input.ticket))
      .maybeSingle();
    if (error || !row || row.status !== "issued" || Date.parse(row.expires_at) <= Date.now())
      return reply(403, { ok: false, error: "Pilot link expired. Launch again from Admin." }, true);
    await superAdmin(row.user_id);
    const current = await vault();
    if (Date.parse(current.row.updated_at) !== Date.parse(row.vault_updated_at))
      return reply(409, { ok: false, error: "Session changed. Launch again from Admin." }, true);
    const now = new Date().toISOString();
    const { data: used, error: useError } = await db
      .from(TABLE)
      .update({ status: "used", used_at: now })
      .eq("id", row.id)
      .eq("status", "issued")
      .gt("expires_at", now)
      .select("id")
      .maybeSingle();
    if (useError || !used)
      return reply(403, { ok: false, error: "Pilot ticket already used or expired" }, true);
    // Only the privileged extension receives this cookie. Never return it from
    // the issue function, log it, place it in a URL, or enable this for writers.
    const c = current.key;
    return reply(
      200,
      {
        ok: true,
        url: "https://claude.ai/new",
        cookie: {
          name: "sessionKey",
          value: c.value,
          domain: ".claude.ai",
          path: "/",
          secure: true,
          httpOnly: true,
          ...(c.expires && c.expires > 0 ? { expirationDate: c.expires } : {}),
        },
      },
      true,
    );
  } catch {
    return reply(
      403,
      { ok: false, error: "Claude pilot unavailable. Check Admin access and the stored session." },
      true,
    );
  }
}
