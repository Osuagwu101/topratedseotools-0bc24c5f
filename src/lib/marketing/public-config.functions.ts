import { createServerFn } from "@tanstack/react-start";

export type PublicMarketingConfig = {
  pixelId: string | null;
  gtmId: string | null;
  pixelEnabled: boolean;
  gtmEnabled: boolean;
  paused: boolean;
};

const emptyConfig: PublicMarketingConfig = {
  pixelId: null,
  gtmId: null,
  pixelEnabled: false,
  gtmEnabled: false,
  paused: false,
};

export const getPublicMarketingConfig = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const [
    { data: integrations, error: integrationsError },
    { data: settings, error: settingsError },
  ] = await Promise.all([
    supabaseAdmin
      .from("marketing_integrations")
      .select("provider, enabled, public_id")
      .in("provider", ["meta_pixel", "gtm"]),
    supabaseAdmin.from("site_settings").select("marketing_pause").eq("id", true).maybeSingle(),
  ]);

  if (integrationsError || settingsError) return emptyConfig;

  const rows = (integrations ?? []) as Array<{
    provider: string;
    enabled: boolean | null;
    public_id: string | null;
  }>;
  const meta = rows.find((i) => i.provider === "meta_pixel");
  const gtm = rows.find((i) => i.provider === "gtm");

  return {
    pixelId: meta?.public_id ?? null,
    pixelEnabled: meta?.enabled === true,
    gtmId: gtm?.public_id ?? null,
    gtmEnabled: gtm?.enabled === true,
    paused: !!(settings as { marketing_pause?: boolean } | null)?.marketing_pause,
  } satisfies PublicMarketingConfig;
});
