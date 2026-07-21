/**
 * Runs on every route change (customer-facing pages only):
 *  - captures UTM / fbclid / gclid to localStorage (temp, consent-safe)
 *  - persists visitor attribution SERVER-SIDE only after Marketing consent
 *  - fires page_view when marketing consent allows
 *  - links attribution + consent record to the user once they sign in
 *    (again, only after consent has been granted)
 */
import { useEffect } from "react";
import { useRouterState } from "@tanstack/react-router";
import { captureAttributionFromUrl, getVisitorId, readAttribution } from "@/lib/marketing/attribution";
import { trackPageView } from "@/lib/marketing/track";
import { readConsent, onConsentChange } from "@/lib/marketing/consent";
import {
  upsertVisitorAttribution,
  linkAttributionToUser,
  linkConsentToUser,
} from "@/lib/marketing/attribution.functions";
import { supabase } from "@/integrations/supabase/client";

function persistAttributionIfConsented() {
  if (!readConsent().marketing) return;
  const stored = readAttribution();
  if (!stored.first_touch && !stored.last_touch) return;
  upsertVisitorAttribution({
    data: {
      visitor_id: stored.visitor_id,
      first_touch: stored.first_touch,
      last_touch: stored.last_touch,
    },
  }).catch(() => {});
}

async function linkIfConsentedAndSignedIn() {
  if (!readConsent().marketing) return;
  const { data } = await supabase.auth.getUser();
  if (!data.user) return;
  const stored = readAttribution();
  const vid = stored.visitor_id ?? getVisitorId();
  linkAttributionToUser({ data: { visitor_id: vid } }).catch(() => {});
  linkConsentToUser({ data: { visitor_id: vid } }).catch(() => {});
}

export function MarketingProvider() {
  const path = useRouterState({ select: (r) => r.location.pathname });
  const isAdminPage = path.startsWith("/admin");

  // Route change: always capture attribution to localStorage (client-only,
  // consent-safe). Only persist server-side and fire page_view when consent
  // is granted.
  useEffect(() => {
    if (isAdminPage) return;
    captureAttributionFromUrl();
    persistAttributionIfConsented();
    const t = setTimeout(() => trackPageView(), 200);
    return () => clearTimeout(t);
  }, [path, isAdminPage]);

  // When consent changes to marketing=true, flush stored attribution + link
  // to the signed-in user. When it flips off, do nothing further; future
  // events are automatically skipped because tracking helpers re-check.
  useEffect(() => {
    return onConsentChange((c) => {
      if (!c.marketing) return;
      persistAttributionIfConsented();
      linkIfConsentedAndSignedIn();
    });
  }, []);

  // Link attribution and consent record on sign-in — only if consent granted.
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_IN") return;
      linkIfConsentedAndSignedIn();
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return null;
}
