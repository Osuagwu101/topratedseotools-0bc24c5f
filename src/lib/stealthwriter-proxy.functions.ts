/* Phase 3 — authenticated customer entrypoint for StealthWriter proxy launch. */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createStealthWriterProxyLaunch } from "@/lib/stealthwriter-proxy.server";

export const startStealthWriterProxyLaunch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const launch = await createStealthWriterProxyLaunch(context.userId);
    return {
      ok: true,
      launch_url: launch.launchUrl,
      proxy_origin: launch.proxyPublicOrigin,
      expires_at: launch.handoffExpiresAt,
      provider: "stealthwriter_proxy" as const,
    };
  });
