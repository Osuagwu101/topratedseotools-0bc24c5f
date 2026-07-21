/**
 * Runs on every route change (customer-facing pages only):
 *  - captures UTM / fbclid / gclid into localStorage
 *  - persists visitor attribution server-side
 *  - fires page_view when marketing consent allows
 *  - links attribution to the user once they sign in
 */
import { useEffect } from "react";
import { useRouterState } from "@tanstack/react-router";
import { captureAttributionFromUrl, getVisitorId, readAttribution } from "@/lib/marketing/attribution";
import { trackPageView } from "@/lib/marketing/track";
import {
  upsertVisitorAttribution,
  linkAttributionToUser,
} from "@/lib/marketing/attribution.functions";
import { supabase } from "@/integrations/supabase/client";

export function MarketingProvider() {
  const path = useRouterState({ select: (r) => r.location.pathname });
  const isAdminPage = path.startsWith("/admin");

  // Route change: capture attribution + fire page_view.
  useEffect(() => {
    if (isAdminPage) return;
    const captured = captureAttributionFromUrl();
    if (captured.last_touch || captured.first_touch) {
      upsertVisitorAttribution({
        data: {
          visitor_id: captured.visitor_id,
          first_touch: captured.first_touch,
          last_touch: captured.last_touch,
        },
      }).catch(() => {});
    }
    // Fire page_view slightly after mount so fbq/dataLayer are ready.
    const t = setTimeout(() => trackPageView(), 200);
    return () => clearTimeout(t);
  }, [path, isAdminPage]);

  // Link attribution when the auth state changes to signed-in.
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_IN") return;
      const stored = readAttribution();
      linkAttributionToUser({ data: { visitor_id: stored.visitor_id ?? getVisitorId() } }).catch(
        () => {},
      );
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return null;
}
