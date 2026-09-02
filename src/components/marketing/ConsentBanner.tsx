/**
 * Cookie/tracking consent banner. Three categories: essential (always on),
 * analytics, marketing. Persists to localStorage AND writes a compliance
 * record to the database via server function. Shows again if the visitor
 * chooses "Manage" from the footer.
 */
import { useEffect, useState } from "react";
import { useRouterState } from "@tanstack/react-router";
import { readConsent, writeConsent, hasDecidedConsent } from "@/lib/marketing/consent";
import { getVisitorId } from "@/lib/marketing/attribution";
import { recordConsentChoice } from "@/lib/marketing/attribution.functions";
import { pushDataLayer } from "@/lib/marketing/track";

export function ConsentBanner() {
  const path = useRouterState({ select: (r) => r.location.pathname });
  const [open, setOpen] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [marketing, setMarketing] = useState(false);

  useEffect(() => {
    if (path.startsWith("/admin")) return;
    if (!hasDecidedConsent()) setOpen(true);
    const current = readConsent();
    setAnalytics(current.analytics);
    setMarketing(current.marketing);
    const listener = () => setOpen(true);
    window.addEventListener("open-consent-banner", listener);
    return () => window.removeEventListener("open-consent-banner", listener);
  }, [path]);

  if (path.startsWith("/admin") || !open) return null;

  async function persist(a: boolean, m: boolean) {
    writeConsent({ analytics: a, marketing: m });
    pushDataLayer("consent_update", { analytics_storage: a, ad_storage: m });
    try {
      await recordConsentChoice({
        data: { visitor_id: getVisitorId(), analytics: a, marketing: m },
      });
      // Link consent record to signed-in user so server-side event dispatch
      // can look up the caller's consent by user_id.
      if (m) {
        const { supabase } = await import("@/integrations/supabase/client");
        const { data } = await supabase.auth.getUser();
        if (data.user) {
          const { linkConsentToUser } = await import("@/lib/marketing/attribution.functions");
          linkConsentToUser({ data: { visitor_id: getVisitorId() } }).catch(() => {});
        }
      }
    } catch {
      /* offline is fine — localStorage is authoritative */
    }
    setOpen(false);
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 border-t bg-background/95 p-4 shadow-lg backdrop-blur">
      <div className="mx-auto flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-start">
        <div className="flex-1 text-sm">
          <div className="font-semibold">Your privacy matters</div>
          <p className="mt-1 text-muted-foreground">
            We use cookies for essential site functions, and (with your permission) for analytics
            and marketing measurement through Meta and Google. You can change your choice anytime
            from the footer.
          </p>
          {advanced ? (
            <div className="mt-3 space-y-2 text-xs">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked disabled className="h-4 w-4" />
                Essential (always on)
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={analytics}
                  onChange={(e) => setAnalytics(e.target.checked)}
                  className="h-4 w-4"
                />
                Analytics
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={marketing}
                  onChange={(e) => setMarketing(e.target.checked)}
                  className="h-4 w-4"
                />
                Marketing (Meta Pixel, Google Tag Manager)
              </label>
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!advanced ? (
            <button
              onClick={() => setAdvanced(true)}
              className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
            >
              Manage
            </button>
          ) : null}
          <button
            onClick={() => persist(false, false)}
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
          >
            Reject non-essential
          </button>
          <button
            onClick={() => persist(advanced ? analytics : true, advanced ? marketing : true)}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            {advanced ? "Save choices" : "Accept all"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Footer helper — call to re-open the banner. */
export function openConsentBanner() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("open-consent-banner"));
}
