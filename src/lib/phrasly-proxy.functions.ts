/* Phase 3 — authenticated internal-writer entrypoint for Phrasly proxy launch. */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createPhraslyProxyLaunch } from "@/lib/phrasly-proxy.server";

export const startPhraslyProxyLaunch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const launch = await createPhraslyProxyLaunch(context.userId);
    return {
      ok: true,
      launch_url: launch.launchUrl,
      expires_at: launch.handoffExpiresAt,
      provider: "phrasly_proxy" as const,
    };
  });
