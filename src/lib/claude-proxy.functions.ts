/* Authenticated entrypoint for the Claude one-click proxy launch. */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createClaudeProxyLaunch } from "@/lib/claude-proxy.server";

export const startClaudeProxyLaunch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const launch = await createClaudeProxyLaunch(context.userId);
    return {
      ok: true,
      launch_url: launch.launchUrl,
      expires_at: launch.handoffExpiresAt,
      proxy_origin: launch.proxyPublicOrigin,
      provider: "claude_proxy" as const,
    };
  });
