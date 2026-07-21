/**
 * Client-side attribution capture. STRICT OPT-IN: no marketing attribution
 * (UTM, fbclid, gclid, referrer, first/last-touch) is written to any browser
 * storage until the visitor has accepted Marketing consent. Once accepted,
 * capture begins from that point forward — earlier campaign values are not
 * reconstructed.
 *
 * The visitor_id is generated only on demand (when the visitor makes a
 * consent decision, or when marketing consent is active). It is not created
 * during ordinary page loads before consent.
 */
import { readConsent } from "./consent";

export type AttributionSnapshot = {
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  fbclid: string | null;
  gclid: string | null;
  landing_page: string | null;
  referrer: string | null;
  captured_at: string;
};

export type StoredAttribution = {
  visitor_id: string;
  first_touch: AttributionSnapshot | null;
  last_touch: AttributionSnapshot | null;
};

const KEY = "mkt_attr";
const VID_KEY = "mkt_vid";

/** Peek the current visitor_id without ever creating one. */
export function peekVisitorId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(VID_KEY);
}

/**
 * Return the stable visitor_id, creating one on first use. Call this only
 * when the visitor makes a consent decision (essential compliance record)
 * or when marketing consent has been granted.
 */
export function getVisitorId(): string {
  if (typeof window === "undefined") return "server";
  let vid = window.localStorage.getItem(VID_KEY);
  if (!vid) {
    vid =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `vid_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    window.localStorage.setItem(VID_KEY, vid);
  }
  return vid;
}

/**
 * Read stored attribution. NEVER creates a visitor_id and never reads the
 * stored payload before marketing consent is granted — attribution is only
 * present once the visitor has opted in.
 */
export function readAttribution(): StoredAttribution {
  const visitor_id = peekVisitorId() ?? "";
  if (typeof window === "undefined") {
    return { visitor_id, first_touch: null, last_touch: null };
  }
  if (!readConsent().marketing) {
    return { visitor_id, first_touch: null, last_touch: null };
  }
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { visitor_id, first_touch: null, last_touch: null };
    const parsed = JSON.parse(raw) as StoredAttribution;
    return { ...parsed, visitor_id: visitor_id || parsed.visitor_id };
  } catch {
    return { visitor_id, first_touch: null, last_touch: null };
  }
}

function parseAttribution(): AttributionSnapshot | null {
  if (typeof window === "undefined") return null;
  const url = new URL(window.location.href);
  const q = url.searchParams;
  const utm_source = q.get("utm_source");
  const utm_medium = q.get("utm_medium");
  const utm_campaign = q.get("utm_campaign");
  const utm_content = q.get("utm_content");
  const utm_term = q.get("utm_term");
  const fbclid = q.get("fbclid");
  const gclid = q.get("gclid");
  const hasSignal =
    utm_source || utm_medium || utm_campaign || utm_content || utm_term || fbclid || gclid;
  if (!hasSignal) return null;
  return {
    utm_source,
    utm_medium,
    utm_campaign,
    utm_content,
    utm_term,
    fbclid,
    gclid,
    landing_page: url.pathname,
    referrer: document.referrer || null,
    captured_at: new Date().toISOString(),
  };
}

/**
 * Call on route change. NO-OP unless marketing consent has been granted.
 * When consent is active, persists first-touch once and refreshes last-touch.
 */
export function captureAttributionFromUrl(): StoredAttribution {
  const empty: StoredAttribution = {
    visitor_id: peekVisitorId() ?? "",
    first_touch: null,
    last_touch: null,
  };
  if (typeof window === "undefined") return empty;
  if (!readConsent().marketing) return empty;
  const stored = readAttribution();
  const snap = parseAttribution();
  if (!snap) return stored;
  const visitor_id = stored.visitor_id || getVisitorId();
  const next: StoredAttribution = {
    visitor_id,
    first_touch: stored.first_touch ?? snap,
    last_touch: snap,
  };
  window.localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

/** Wipe any stored attribution payload from the device. */
export function clearStoredAttribution(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(KEY);
}
