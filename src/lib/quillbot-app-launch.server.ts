/*
 * Main-app entrypoint for the QuillBot one-click launch.
 *
 * This wires the already-reviewed launch service (quillbot-launch.server.ts)
 * and Supabase repository (quillbot-repository.server.ts) — the same code
 * the dedicated QuillBot host uses — into the real tool_settings gate instead
 * of the isolated verification flag (QUILLBOT_TEST_ENABLED). It only issues
 * a signed launch ticket; the ticket is redeemed at the dedicated QuillBot
 * host (quillbotProxyPublicOrigin), exactly like Grammarly and Claude.
 *
 * It does not need the dedicated host's authenticated browser: creating a
 * ticket only reads tool_settings / tool_orders / tool_access_grants /
 * quillbot_user_controls / quillbot_provider_accounts, all pure DB reads.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createQuillBotLaunchService } from "@/lib/quillbot-launch.server";
import { quillBotRepository } from "@/lib/quillbot-repository.server";

const TOOL_SLUG = "quillbot";

export function quillBotProxyPublicOrigin() {
  const raw = String(process.env.QUILLBOT_PROXY_PUBLIC_ORIGIN ?? "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

let cachedEnabled: { value: boolean; until: number } | null = null;

async function mainAppEnabled() {
  if (cachedEnabled && cachedEnabled.until > Date.now()) return cachedEnabled.value;
  const { data, error } = await (supabaseAdmin as any)
    .from("tool_settings")
    .select("enabled, one_click_auth_enabled")
    .eq("tool_slug", TOOL_SLUG)
    .maybeSingle();
  const value = !error && !!data && data.enabled !== false && data.one_click_auth_enabled === true;
  cachedEnabled = { value, until: Date.now() + 1000 };
  return value;
}

export async function createQuillBotProxyLaunch(userId: string) {
  const origin = quillBotProxyPublicOrigin();
  if (!origin) throw new Error("QuillBot is not configured on this server yet.");
  const repo = quillBotRepository(supabaseAdmin as any);
  repo.enabled = mainAppEnabled;
  const launch = createQuillBotLaunchService(repo);
  const { token, expiresAt } = await launch.create(userId);
  await (supabaseAdmin as any).from("tool_usage").insert({ tool_slug: TOOL_SLUG, user_id: userId });
  return {
    launchUrl: `${origin}/__trst/enter?ticket=${encodeURIComponent(token)}`,
    proxyPublicOrigin: origin,
    handoffExpiresAt: expiresAt,
  };
}
