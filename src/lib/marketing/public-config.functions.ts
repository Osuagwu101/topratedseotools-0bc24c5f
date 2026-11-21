import { createServerFn } from "@tanstack/react-start";

export type PublicMarketingConfig = {
  pixelId: string | null;
  gtmId: string | null;
  pixelEnabled: boolean;
  gtmEnabled: boolean;
  googleAdsId: string | null;
  googleAdsLabel: string | null;
  googleAdsEnabled: boolean;
  paused: boolean;
};

const emptyConfig: PublicMarketingConfig = {
  pixelId: null,
  gtmId: null,
  pixelEnabled: false,
  gtmEnabled: false,
  googleAdsId: null,
  googleAdsLabel: null,
  googleAdsEnabled: false,
  paused: false,
};

export const getPublicMarketingConfig = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const [{ data: integrations, error: integrationsError }, { data: settings, error: settingsError }] =
    await Promise.all([
      supabaseAdmin
        .from("marketing_integrations")
        .select("provider, enabled, public_id, config")
        .in("provider", ["meta_pixel", "gtm", "google_ads"]),
      supabaseAdmin.from("site_settings").select("marketing_pause").eq("id", true).maybeSingle(),
    ]);

  if (integrationsError || settingsError) return emptyConfig;

  const rows = (integrations ?? []) as Array<{
    provider: string;
    enabled: boolean | null;
    public_id: string | null;
    config: { purchase_label?: string | null } | null;
  }>;
  const meta = rows.find((i) => i.provider === "meta_pixel");
  const gtm = rows.find((i) => i.provider === "gtm");
  const ads = rows.find((i) => i.provider === "google_ads");

  return {
    pixelId: meta?.public_id ?? null,
    pixelEnabled: meta?.enabled === true,
    gtmId: gtm?.public_id ?? null,
    gtmEnabled: gtm?.enabled === true,
    googleAdsId: ads?.public_id ?? null,
    googleAdsLabel: ads?.config?.purchase_label ?? null,
    googleAdsEnabled: ads?.enabled === true,
    paused: !!(settings as { marketing_pause?: boolean } | null)?.marketing_pause,
  } satisfies PublicMarketingConfig;
});