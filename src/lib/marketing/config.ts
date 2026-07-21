/**
 * Marketing integration ID validators + shared enums.
 *
 * Portability: every marketing secret is read from process.env at handler
 * time — no Lovable-specific runtime. See MIGRATION.md.
 */
export type MarketingProvider = "meta_pixel" | "meta_capi" | "gtm";

/** Meta Pixel IDs are numeric, 8–20 digits in practice. */
export const META_PIXEL_ID_RE = /^\d{8,20}$/;
/** GTM container IDs look like `GTM-XXXXXXX` (letters + digits, 5–15 chars). */
export const GTM_CONTAINER_ID_RE = /^GTM-[A-Z0-9]{5,15}$/;

export function isValidPixelId(id: string | null | undefined): boolean {
  return typeof id === "string" && META_PIXEL_ID_RE.test(id.trim());
}

export function isValidGtmId(id: string | null | undefined): boolean {
  return typeof id === "string" && GTM_CONTAINER_ID_RE.test(id.trim());
}

/**
 * Stable browser+server event id — Meta uses this to dedupe Pixel + CAPI.
 * Deterministic for a given (kind, natural_key) pair.
 */
export function buildEventId(kind: string, key: string): string {
  return `${kind}:${key}`.replace(/[^a-zA-Z0-9:_\-]/g, "_").slice(0, 64);
}

export const MARKETING_EVENTS = {
  page_view: "PageView",
  view_item: "ViewContent",
  search: "Search",
  select_item: "ViewContent",
  begin_checkout: "InitiateCheckout",
  purchase: "Purchase",
  subscribe: "Subscribe",
  sign_up: "CompleteRegistration",
  generate_lead: "Lead",
  contact: "Contact",
} as const;

export type GtmEventName =
  | "page_view"
  | "view_item"
  | "search"
  | "select_item"
  | "sign_up"
  | "generate_lead"
  | "begin_checkout"
  | "purchase"
  | "refund"
  | "subscription_start"
  | "renewal_success"
  | "renewal_failed"
  | "renewal_disabled";
