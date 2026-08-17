/**
 * Which gateway will process checkout — read-only, customer-safe.
 *
 * Returns only non-sensitive checkout metadata. `chargeCurrencies` is retained
 * for the existing UI contract, but represents customer-selectable display
 * currencies; the actual gateway settlement currencies remain private to the
 * payment pipeline and are handled by `resolveChargePlan`.
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

const DEFAULT_DISPLAY_CURRENCIES = ["NGN", "GHS", "KES", "ZAR", "USD"];

export const getActiveGatewayInfo = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<ActiveGatewayInfo> => {
    let slug: GatewaySlug = DEFAULT_GATEWAY;
    let displayCurrencies = DEFAULT_DISPLAY_CURRENCIES;
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const [{ data: provider }, { data: currencySettings }] = await Promise.all([
        supabaseAdmin
          .from("payment_providers")
          .select("slug")
          .eq("is_active", true)
          .eq("enabled", true)
          .maybeSingle(),
        supabaseAdmin
          .from("currency_settings")
          .select("supported_currencies")
          .eq("id", true)
          .maybeSingle(),
      ]);
      const s = String((provider as { slug?: string } | null)?.slug ?? "");
      if (s in GATEWAY_METADATA) slug = s as GatewaySlug;
      const configured = (currencySettings as { supported_currencies?: string[] } | null)
        ?.supported_currencies;
      if (Array.isArray(configured) && configured.length > 0) {
        displayCurrencies = configured.map((c) => String(c).toUpperCase());
      }
    } catch {
      /* defaults are safe */
    }
    const meta = GATEWAY_METADATA[slug];
    return {
      slug,
      displayName: meta.displayName,
      supportsRecurring: meta.supportsRecurring,
      chargeCurrencies: displayCurrencies,
    };
  });
