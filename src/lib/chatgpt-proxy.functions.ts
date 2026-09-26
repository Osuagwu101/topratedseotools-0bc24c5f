/* Phase 3 — authenticated internal-writer entrypoint for ChatGpt proxy launch. */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createChatGptProxyLaunch } from "@/lib/chatgpt-proxy.server";

export const startChatGptProxyLaunch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const launch = await createChatGptProxyLaunch(context.userId);
    return {
      ok: true,
      launch_url: launch.launchUrl,
      expires_at: launch.handoffExpiresAt,
      proxy_origin: launch.proxyPublicOrigin,
      provider: "chatgpt_proxy" as const,
    };
  });
