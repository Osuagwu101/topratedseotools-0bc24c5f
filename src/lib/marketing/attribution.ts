/**
 * Client-side attribution capture. Runs on every customer-facing page hit.
 * First-touch is set once and NEVER overwritten. Last-touch is refreshed
 * whenever new campaign data is detected on a later visit.
 */
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

export function readAttribution(): StoredAttribution {
  const visitor_id = getVisitorId();
  if (typeof window === "undefined") {
    return { visitor_id, first_touch: null, last_touch: null };
  }
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { visitor_id, first_touch: null, last_touch: null };
    const parsed = JSON.parse(raw) as StoredAttribution;
    return { ...parsed, visitor_id };
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

/** Call on route change. Persists first-touch once, overwrites last-touch. */
export function captureAttributionFromUrl(): StoredAttribution {
  const stored = readAttribution();
  const snap = parseAttribution();
  if (!snap) return stored;
  const next: StoredAttribution = {
    visitor_id: stored.visitor_id,
    first_touch: stored.first_touch ?? snap,
    last_touch: snap,
  };
  if (typeof window !== "undefined") {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  }
  return next;
}
