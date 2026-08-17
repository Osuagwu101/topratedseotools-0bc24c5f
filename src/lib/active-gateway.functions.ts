/**
 * Which gateway will process checkout — read-only, customer-safe.
 *
 * Returns only the active gateway's slug, display name, recurring capability
 * and chargeable currencies. No keys, config or credential state is exposed.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DEFAULT_GATEWAY, GATEWAY_METADATA } from "@/lib/gateways/metadata";
import type { GatewaySlug } from "@/lib/gateways/types";

export interface ActiveGatewayInfo {
  slug: GatewaySlug;
  displayName: string;
  supportsRecurring: boolean;
  chargeCurrencies: string[];
}

export const getActiveGatewayInfo = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<ActiveGatewayInfo> => {
    let slug: GatewaySlug = DEFAULT_GATEWAY;
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data } = await supabaseAdmin
        .from("payment_providers")
        .select("slug")
        .eq("is_active", true)
        .eq("enabled", true)
        .maybeSingle();
      const s = String((data as { slug?: string } | null)?.slug ?? "");
      if (s in GATEWAY_METADATA) slug = s as GatewaySlug;
    } catch {
      /* default gateway */
    }
    const meta = GATEWAY_METADATA[slug];
    return {
      slug,
      displayName: meta.displayName,
      supportsRecurring: meta.supportsRecurring,
      chargeCurrencies: meta.chargeCurrencies,
    };
  });
