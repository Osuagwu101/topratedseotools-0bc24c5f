/* Phase 3 — authenticated internal-writer entrypoint for ChatGPT proxy launch. */
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  createChatGPTProxyLaunch,
  readChatGptAppDeviceFingerprint,
} from "@/lib/chatgpt-proxy.server";

export const startChatGPTProxyLaunch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const request = getRequest();
    const deviceFingerprint = request
      ? readChatGptAppDeviceFingerprint(request)
      : null;
    const launch = await createChatGPTProxyLaunch(
      context.userId,
      deviceFingerprint,
    );
    return {
      ok: true,
      launch_url: launch.launchUrl,
      expires_at: launch.handoffExpiresAt,
      proxy_origin: launch.proxyPublicOrigin,
      provider: "chatgpt_proxy" as const,
    };
  });
