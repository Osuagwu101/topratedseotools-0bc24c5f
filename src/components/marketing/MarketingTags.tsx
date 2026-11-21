/**
 * Loads Meta Pixel + Google Tag Manager scripts once, on customer-facing pages,
 * only after the visitor accepts the Marketing consent category. Never renders
 * on admin routes.
 */
import { useEffect, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { readConsent, onConsentChange } from "@/lib/marketing/consent";
import { getPublicMarketingConfig, type PublicMarketingConfig } from "@/lib/marketing/public-config.functions";
import { flushPendingFbqEvents, flushPendingGoogleAdsEvents } from "@/lib/marketing/track";

function loadPixel(pixelId: string) {
  const w = window as unknown as {
    fbq?: (...args: unknown[]) => void;
    _fbq?: unknown;
    __pixelLoaded?: boolean;
  };
  if (w.__pixelLoaded) return;
  w.__pixelLoaded = true;
  /* eslint-disable */
  // Meta's snippet, minimally trimmed.
  (function (f: any, b: Document, e: string, v: string) {
    let n: any, t: any, s: any;
    if (f.fbq) return;
    n = f.fbq = function () {
      n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
    };
    if (!f._fbq) f._fbq = n;
    n.push = n;
    n.loaded = !0;
    n.version = "2.0";
    n.queue = [];
    t = b.createElement(e);
    t.async = !0;
    t.src = v;
    s = b.getElementsByTagName(e)[0];
    s.parentNode.insertBefore(t, s);
  })(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");
  /* eslint-enable */
  w.fbq?.("init", pixelId);
  flushPendingFbqEvents();
}

function loadGtm(id: string) {
  const w = window as unknown as { __gtmLoaded?: boolean; dataLayer?: unknown[] };
  if (w.__gtmLoaded) return;
  w.__gtmLoaded = true;
  w.dataLayer = w.dataLayer ?? [];
  w.dataLayer.push({ "gtm.start": new Date().getTime(), event: "gtm.js" });
  const s = document.createElement("script");
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(id)}`;
  document.head.appendChild(s);
}

function loadGoogleAds(id: string, label: string) {
  const w = window as unknown as {
    __googleAdsLoaded?: boolean;
    __googleAds?: { id: string; label: string };
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  };
  if (w.__googleAdsLoaded) return;
  w.__googleAdsLoaded = true;
  w.dataLayer = w.dataLayer ?? [];
  // gtag must push the `arguments` object itself, not an array.
  w.gtag =
    w.gtag ??
    function () {
      // eslint-disable-next-line prefer-rest-params
      (w.dataLayer as unknown[]).push(arguments);
    };
  const s = document.createElement("script");
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  document.head.appendChild(s);
  w.gtag("js", new Date());
  w.gtag("config", id);
  w.__googleAds = { id, label };
  flushPendingGoogleAdsEvents();
}

export function MarketingTags() {
  const path = useRouterState({ select: (r) => r.location.pathname });
  const [config, setConfig] = useState<PublicMarketingConfig | null>(null);
  const [consent, setConsent] = useState(() => readConsent());
  const isAdminPage = path.startsWith("/admin");

  useEffect(() => {
    let cancelled = false;
    const loadConfig = () => {
      getPublicMarketingConfig().then((next) => {
        if (!cancelled) setConfig(next);
      }).catch(() => {
        if (!cancelled) setConfig({
          pixelId: null,
          gtmId: null,
          pixelEnabled: false,
          gtmEnabled: false,
          googleAdsId: null,
          googleAdsLabel: null,
          googleAdsEnabled: false,
          paused: false,
        });
      });
    };
    loadConfig();
    const off = onConsentChange(setConsent);
    window.addEventListener("marketing-config-updated", loadConfig);
    return () => {
      cancelled = true;
      off();
      window.removeEventListener("marketing-config-updated", loadConfig);
    };
  }, []);

  useEffect(() => {
    if (isAdminPage || !config || config.paused || !consent.marketing) return;
    if (config.pixelEnabled && config.pixelId) loadPixel(config.pixelId);
    if (config.gtmEnabled && config.gtmId) loadGtm(config.gtmId);
    if (config.googleAdsEnabled && config.googleAdsId && config.googleAdsLabel) {
      loadGoogleAds(config.googleAdsId, config.googleAdsLabel);
    }
  }, [config, consent.marketing, isAdminPage]);

  return null;
}
