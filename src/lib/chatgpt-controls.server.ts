/* Phase 4 — ChatGPT device/access hardening. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export interface ChatGptUserControls {
  user_id: string;
  status: "active" | "suspended";
  device_limit: number;
  suspended_reason: string | null;
  suspended_at: string | null;
}

export const CHATGPT_DEFAULT_DEVICE_LIMIT = 2;
export const CHATGPT_DEVICE_COOKIE = "trst_cg_device";
export const CHATGPT_APP_DEVICE_COOKIE = "trst_cg_app_device";
export const CHATGPT_DEFAULT_LAUNCHES_PER_MINUTE = 8;

const BLOCKED_DOCUMENT_PREFIXES = [
  "/auth",
  "/login",
  "/logout",
  "/signout",
  "/sign-out",
  "/billing",
  "/account",
  "/accounts",
  "/subscription",
  "/subscriptions",
  "/settings",
  "/admin",
] as const;

export function isBlockedChatGptDocumentPath(pathname: string) {
  return BLOCKED_DOCUMENT_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(prefix + "/"),
  );
}

export function isChatGptDocumentRequest(request: Request) {
  const dest = String(request.headers.get("sec-fetch-dest") ?? "").toLowerCase();
  const accept = String(request.headers.get("accept") ?? "").toLowerCase();
  return dest === "document" || accept.includes("text/html");
}

export function isValidChatGptDeviceFingerprint(value: string | null | undefined) {
  return !!value && /^[a-f0-9]{32}$/.test(value);
}

export function chatGptLaunchesPerMinute() {
  const raw = Number(process.env.CHATGPT_LAUNCHES_PER_MINUTE ?? CHATGPT_DEFAULT_LAUNCHES_PER_MINUTE);
  if (!Number.isFinite(raw)) return CHATGPT_DEFAULT_LAUNCHES_PER_MINUTE;
  return Math.max(2, Math.min(30, Math.round(raw)));
}

export async function ensureChatGptUserControls(
  userId: string,
): Promise<ChatGptUserControls> {
  const { data: existing, error: readError } = await (supabaseAdmin as any)
    .from("chatgpt_user_controls")
    .select("user_id,status,device_limit,suspended_reason,suspended_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  if (existing) return existing as ChatGptUserControls;

  const { data, error } = await (supabaseAdmin as any)
    .from("chatgpt_user_controls")
    .insert({
      user_id: userId,
      status: "active",
      device_limit: CHATGPT_DEFAULT_DEVICE_LIMIT,
    })
    .select("user_id,status,device_limit,suspended_reason,suspended_at")
    .single();
  if (error) throw new Error(error.message);
  return data as ChatGptUserControls;
}

export async function suspendChatGptAccessForDeviceLimit(userId: string) {
  const now = new Date().toISOString();
  const controls = await ensureChatGptUserControls(userId);
  const { error } = await (supabaseAdmin as any)
    .from("chatgpt_user_controls")
    .upsert(
      {
        user_id: userId,
        status: "suspended",
        device_limit: controls.device_limit,
        suspended_reason: "device_limit_exceeded",
        suspended_at: now,
        updated_at: now,
      },
      { onConflict: "user_id" },
    );
  if (error) throw new Error(error.message);

  await (supabaseAdmin as any)
    .from("chatgpt_proxy_sessions")
    .update({ status: "revoked" })
    .eq("user_id", userId)
    .in("status", ["issued", "active"]);
}

export async function reactivateChatGptAccess(userId: string) {
  const now = new Date().toISOString();
  const controls = await ensureChatGptUserControls(userId);
  const { error } = await (supabaseAdmin as any)
    .from("chatgpt_user_controls")
    .update({
      status: "active",
      device_limit: controls.device_limit,
      suspended_reason: null,
      suspended_at: null,
      updated_at: now,
    })
    .eq("user_id", userId);
  if (error) throw new Error(error.message);
}

export async function registerOrTouchChatGptDevice(
  userId: string,
  fingerprint: string,
  label: string,
) {
  const controls = await ensureChatGptUserControls(userId);
  if (controls.status !== "active") {
    return { ok: false as const, suspended: true as const, controls };
  }

  const { data: existing, error: readError } = await (supabaseAdmin as any)
    .from("chatgpt_devices")
    .select("id")
    .eq("user_id", userId)
    .eq("device_fingerprint", fingerprint)
    .maybeSingle();
  if (readError) throw new Error(readError.message);

  if (existing?.id) {
    await (supabaseAdmin as any)
      .from("chatgpt_devices")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", existing.id);
    return { ok: true as const, isNew: false as const, controls };
  }

  const { count, error: countError } = await (supabaseAdmin as any)
    .from("chatgpt_devices")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if (countError) throw new Error(countError.message);

  if ((count ?? 0) >= controls.device_limit) {
    await suspendChatGptAccessForDeviceLimit(userId);
    return { ok: false as const, suspended: true as const, controls };
  }

  const { error: insertError } = await (supabaseAdmin as any)
    .from("chatgpt_devices")
    .insert({
      user_id: userId,
      device_fingerprint: fingerprint,
      label: label.slice(0, 180) || "Device",
    });
  if (insertError) throw new Error(insertError.message);

  return { ok: true as const, isNew: true as const, controls };
}

export async function assertChatGptLaunchRateLimit(userId: string) {
  const threshold = new Date(Date.now() - 60_000).toISOString();
  const { count, error } = await (supabaseAdmin as any)
    .from("chatgpt_proxy_sessions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", threshold);
  if (error) throw new Error(error.message);

  if ((count ?? 0) >= chatGptLaunchesPerMinute()) {
    throw new Error(
      "Too many ChatGPT launch attempts. Please wait a minute and try again.",
    );
  }
}
