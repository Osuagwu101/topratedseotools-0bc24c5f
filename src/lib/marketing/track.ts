/**
 * Browser tracking helpers. Every call is consent-gated: if marketing consent
 * is off, the call is a no-op. Safe to invoke from any component.
 */
import { readConsent } from "./consent";
import { readAttribution, getVisitorId, peekVisitorId } from "./attribution";
import type { GtmEventName } from "./config";

type Dict = Record<string, unknown>;

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
    dataLayer?: unknown[];
    __pendingFbqEvents?: Array<{ name: string; params: Dict; opts: { eventID?: string; custom?: boolean } }>;
  }
}

function marketingAllowed(): boolean {
  if (typeof window === "undefined") return false;
  return readConsent().marketing === true;
}

/** GTM data-layer push. */
export function pushDataLayer(event: GtmEventName | "consent_update", payload: Dict = {}) {
  if (typeof window === "undefined") return;
  if (event !== "consent_update" && !marketingAllowed()) return;
  window.dataLayer = window.dataLayer ?? [];
  window.dataLayer.push({ event, ...payload });
}

/** Meta Pixel event with optional event_id (dedupe key shared with server). */
export function fbqTrack(
  name: string,
  params: Dict = {},
  opts: { eventID?: string; custom?: boolean } = {},
) {
  if (typeof window === "undefined" || !marketingAllowed()) return;
  if (typeof window.fbq !== "function") {
    window.__pendingFbqEvents = window.__pendingFbqEvents ?? [];
    window.__pendingFbqEvents.push({ name, params, opts });
    return;
  }
  const fn = opts.custom ? "trackCustom" : "track";
  if (opts.eventID) {
    window.fbq(fn, name, params, { eventID: opts.eventID });
  } else {
    window.fbq(fn, name, params);
  }
}

export function flushPendingFbqEvents() {
  if (typeof window === "undefined" || typeof window.fbq !== "function") return;
  const pending = window.__pendingFbqEvents ?? [];
  window.__pendingFbqEvents = [];
  for (const event of pending) fbqTrack(event.name, event.params, event.opts);
}

// ---------- High-level customer events ----------

export function trackPageView() {
  if (!marketingAllowed()) return;
  fbqTrack("PageView");
  pushDataLayer("page_view", { page_path: window.location.pathname });
}

export function trackViewItem(item: {
  slug: string;
  name: string;
  category?: string;
  amount?: number | null;
  currency?: string;
}) {
  pushDataLayer("view_item", {
    item_id: item.slug,
    item_name: item.name,
    item_category: item.category ?? null,
    value: item.amount ?? undefined,
    currency: item.currency ?? "NGN",
  });
  fbqTrack("ViewContent", {
    content_ids: [item.slug],
    content_name: item.name,
    content_type: "product",
    value: item.amount ?? undefined,
    currency: item.currency ?? "NGN",
  });
}

export function trackSearch(query: string) {
  pushDataLayer("search", { search_term: query });
  fbqTrack("Search", { search_string: query });
}

export function trackSelectItem(item: {
  slug: string;
  name: string;
  access_type?: string;
  billing_period?: string;
}) {
  pushDataLayer("select_item", { item_id: item.slug, item_name: item.name, ...item });
  fbqTrack("ViewContent", {
    content_ids: [item.slug],
    content_name: item.name,
    access_type: item.access_type,
    billing_period: item.billing_period,
  });
}

export function trackBeginCheckout(o: {
  order_id: string;
  slug: string;
  name: string;
  amount: number;
  access_type: string;
  billing_period: string;
  payment_type: string;
  event_id: string;
}) {
  pushDataLayer("begin_checkout", {
    transaction_id: o.order_id,
    currency: "NGN",
    value: o.amount,
    items: [
      {
        item_id: o.slug,
        item_name: o.name,
        access_type: o.access_type,
        billing_period: o.billing_period,
        payment_type: o.payment_type,
      },
    ],
  });
  fbqTrack(
    "InitiateCheckout",
    {
      content_ids: [o.slug],
      content_name: o.name,
      value: o.amount,
      currency: "NGN",
      access_type: o.access_type,
      billing_period: o.billing_period,
      payment_type: o.payment_type,
    },
    { eventID: o.event_id },
  );
}

export function trackPurchase(o: {
  order_id: string;
  slug?: string | null;
  name?: string | null;
  amount: number;
  currency?: string | null;
  event_id?: string;
  reference?: string | null;
}) {
  const currency = o.currency ?? "NGN";
  pushDataLayer("purchase", {
    transaction_id: o.order_id,
    value: o.amount,
    currency,
    paystack_reference: o.reference ?? undefined,
    items: o.slug
      ? [
          {
            item_id: o.slug,
            item_name: o.name ?? o.slug,
          },
        ]
      : undefined,
  });
  fbqTrack(
    "Purchase",
    {
      content_ids: o.slug ? [o.slug] : undefined,
      content_name: o.name ?? o.slug ?? undefined,
      content_type: "product",
      value: o.amount,
      currency,
      order_id: o.order_id,
    },
    o.event_id ? { eventID: o.event_id } : {},
  );
}

export function trackLead(source: string) {
  pushDataLayer("generate_lead", { source });
  fbqTrack("Lead", { source });
}

export function trackContact(channel: string) {
  pushDataLayer("generate_lead", { source: `contact_${channel}` });
  fbqTrack("Contact", { channel });
}

export function trackSignUp(method: string) {
  pushDataLayer("sign_up", { method });
  fbqTrack("CompleteRegistration", { method });
}

// Payment method + Paystack open are internal (no Meta standard events).
export function trackPaymentMethodSelected(mode: string) {
  pushDataLayer("select_item", { item_category: "payment_method", item_id: mode });
}

export function trackPaystackOpened(order_id: string) {
  pushDataLayer("select_item", { item_category: "paystack_opened", item_id: order_id });
}

/** Convenience — snapshot for server calls (visitor_id + attribution). */
export function marketingContext() {
  const consented = marketingAllowed();
  return {
    visitor_id: consented ? getVisitorId() : peekVisitorId(),
    attribution: readAttribution(),
    href: typeof window !== "undefined" ? window.location.href : null,
    user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
  };
}
