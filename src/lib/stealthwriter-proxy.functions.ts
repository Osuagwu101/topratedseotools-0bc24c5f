/* Phase 3 — authenticated customer entrypoint for StealthWriter proxy launch. */
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  createStealthWriterProxyLaunch,
  readStealthWriterAppDeviceFingerprint,
} from "@/lib/stealthwriter-proxy.server";

export const startStealthWriterProxyLaunch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const request = getRequest();
    const deviceFingerprint = request
      ? readStealthWriterAppDeviceFingerprint(request)
      : null;
    const launch = await createStealthWriterProxyLaunch(
      context.userId,
      deviceFingerprint,
    );
    return {
      ok: true,
      launch_url: launch.launchUrl,
      proxy_origin: launch.proxyPublicOrigin,
      expires_at: launch.handoffExpiresAt,
      provider: "stealthwriter_proxy" as const,
    };
  });
