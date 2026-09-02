/**
 * Runs on every route change (customer-facing pages only).
 *
 * STRICT OPT-IN: no marketing attribution is captured, stored on the device,
 * persisted to the server, linked to the visitor/user, or sent as a marketing
 * event until the visitor has accepted Marketing consent. When consent is
 * granted, capture begins going forward — earlier campaign values are not
 * reconstructed. When consent is later withdrawn, capture stops and no
 * further attribution is stored, but previously stored records are left
 * untouched.
 */
import { useEffect } from "react";
import { useRouterState } from "@tanstack/react-router";
import {
  captureAttributionFromUrl,
  peekVisitorId,
  readAttribution,
} from "@/lib/marketing/attribution";
import { trackPageView, trackViewItem } from "@/lib/marketing/track";
import { readConsent, onConsentChange } from "@/lib/marketing/consent";
import { getTool } from "@/lib/tools-data";
import {
  upsertVisitorAttribution,
  linkAttributionToUser,
  linkConsentToUser,
} from "@/lib/marketing/attribution.functions";
import { supabase } from "@/integrations/supabase/client";

function persistAttributionIfConsented() {
  if (!readConsent().marketing) return;
  const stored = readAttribution();
  if (!stored.visitor_id) return;
  if (!stored.first_touch && !stored.last_touch) return;
  upsertVisitorAttribution({
    data: {
      visitor_id: stored.visitor_id,
      first_touch: stored.first_touch,
      last_touch: stored.last_touch,
    },
  }).catch(() => {});
}

function trackCurrentRoute(path: string) {
  trackPageView();
  const match = path.match(/^\/tools\/([^/?#]+)/);
  if (!match) return;
  const tool = getTool(decodeURIComponent(match[1]));
  if (!tool) return;
  trackViewItem({ slug: tool.slug, name: tool.name, category: tool.category });
}

async function linkIfConsentedAndSignedIn() {
  if (!readConsent().marketing) return;
  const { data } = await supabase.auth.getUser();
  if (!data.user) return;
  const vid = peekVisitorId();
  if (!vid) return;
  linkAttributionToUser({ data: { visitor_id: vid } }).catch(() => {});
  linkConsentToUser({ data: { visitor_id: vid } }).catch(() => {});
}

export function MarketingProvider() {
  const path = useRouterState({ select: (r) => r.location.pathname });
  const isAdminPage = path.startsWith("/admin");

  // Route change: only capture attribution (and only fire page_view) when
  // marketing consent has been granted. Before consent, this is a full no-op:
  // nothing is written to localStorage, cookies, or the database.
  useEffect(() => {
    if (isAdminPage) return;
    if (!readConsent().marketing) return;
    captureAttributionFromUrl();
    persistAttributionIfConsented();
    const t = setTimeout(() => trackCurrentRoute(path), 400);
    return () => clearTimeout(t);
  }, [path, isAdminPage]);

  // When consent flips to marketing=true, start capture from the current URL
  // going forward. Do not reconstruct pre-consent activity. When it flips
  // off, do nothing (previously stored records are left untouched).
  useEffect(() => {
    return onConsentChange((c) => {
      if (!c.marketing) return;
      captureAttributionFromUrl();
      persistAttributionIfConsented();
      linkIfConsentedAndSignedIn();
      setTimeout(() => trackCurrentRoute(window.location.pathname), 400);
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
