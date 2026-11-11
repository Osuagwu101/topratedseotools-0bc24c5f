/* Authenticated entrypoint for the Grammarly one-click proxy launch. */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createGrammarlyProxyLaunch } from "@/lib/grammarly-proxy.server";

export const startGrammarlyProxyLaunch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const launch = await createGrammarlyProxyLaunch(context.userId);
    return {
      ok: true,
      launch_url: launch.launchUrl,
      expires_at: launch.handoffExpiresAt,
      proxy_origin: launch.proxyPublicOrigin,
      provider: "grammarly_proxy" as const,
    };
  });
