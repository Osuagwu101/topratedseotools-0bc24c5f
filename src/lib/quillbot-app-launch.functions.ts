/* Authenticated entrypoint for the QuillBot one-click proxy launch. */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createQuillBotProxyLaunch } from "@/lib/quillbot-app-launch.server";

export const startQuillBotProxyLaunch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const launch = await createQuillBotProxyLaunch(context.userId);
    return {
      ok: true,
      launch_url: launch.launchUrl,
      expires_at: launch.handoffExpiresAt,
      proxy_origin: launch.proxyPublicOrigin,
      provider: "quillbot_proxy" as const,
    };
  });
