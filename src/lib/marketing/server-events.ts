/**
 * Server-side event bus for marketing conversions. Called from Paystack
 * webhook / verify / fulfilment cron. Handles:
 *   - deduplication (unique index on (platform, event_id) WHERE status='sent')
 *   - safe skip when integrations disabled or marketing consent is off
 *   - audit trail in `marketing_events`
 *   - dispatch to Meta CAPI
 */
import { sendCapiEvents, hashEmail, type CapiEvent } from "./meta-capi";
import { buildEventId } from "./config";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

type ProviderRow = {
  enabled: boolean;
  connected: boolean;
  public_id: string | null;
  test_event_code: string | null;
};

async function loadProvider(admin: Admin, provider: string): Promise<ProviderRow | null> {
  const { data } = await admin
    .from("marketing_integrations")
    .select("enabled, connected, public_id, test_event_code")
    .eq("provider", provider)
    .maybeSingle();
  return (data as ProviderRow | null) ?? null;
}

async function marketingPaused(admin: Admin): Promise<boolean> {
  const { data } = await admin
    .from("site_settings")
    .select("marketing_pause")
    .eq("id", true)
    .maybeSingle();
  return !!(data as { marketing_pause?: boolean } | null)?.marketing_pause;
}

/**
 * Explicit-opt-in consent check. Marketing events are only allowed when a
 * consent_choices row exists (keyed by user_id or visitor_id) with
 * marketing = true. No row / no explicit true → skip.
 */
async function consentAllowsMarketing(
  admin: Admin,
  userId: string | null,
  visitorId: string | null,
): Promise<boolean> {
  if (userId) {
    const { data } = await admin
      .from("consent_choices")
      .select("marketing")
      .eq("user_id", userId)
      .maybeSingle();
    if (data && (data as { marketing?: boolean }).marketing === true) return true;
  }
  if (visitorId) {
    const { data } = await admin
      .from("consent_choices")
      .select("marketing")
      .eq("visitor_id", visitorId)
      .maybeSingle();
    if (data && (data as { marketing?: boolean }).marketing === true) return true;
  }
  return false;
}

/**
 * Record + dispatch a server-side conversion event.
 * Duplicate (platform, event_id) inserts fail the unique index and short-circuit
 * to `deduplicated`.
 */
export async function trackServerConversion(
  admin: Admin,
  input: {
    kind:
      | "purchase"
      | "subscription_start"
      | "renewal_success"
      | "renewal_failed"
      | "renewal_disabled"
      | "private_fulfilment"
      | "refund";
    event_id: string;
    order_id?: string | null;
    user_id?: string | null;
    tool_slug?: string | null;
    amount?: number | null;
    currency?: string | null;
    email?: string | null;
    visitor_id?: string | null;
    custom?: Record<string, unknown>;
    meta_event_name?: string; // override default map
  },
): Promise<{ status: "sent" | "failed" | "skipped" | "deduplicated"; error?: string }> {
  if (await marketingPaused(admin)) {
    await logEvent(admin, input, "internal", "skipped", "marketing paused");
    return { status: "skipped", error: "paused" };
  }
  // Fall back to the visitor_id captured on the order (webhook path has no user session).
  let visitorId = input.visitor_id ?? null;
  if (!visitorId && input.order_id) {
    const { data: ord } = await admin
      .from("tool_orders")
      .select("attribution")
      .eq("id", input.order_id)
      .maybeSingle();
    const attr = (ord as { attribution?: { visitor_id?: string } } | null)?.attribution;
    if (attr?.visitor_id) visitorId = attr.visitor_id;
  }
  if (!(await consentAllowsMarketing(admin, input.user_id ?? null, visitorId))) {
    await logEvent(admin, input, "internal", "skipped", "consent not granted");
    return { status: "skipped", error: "consent" };
  }

  // Deduplicate — attempt to reserve (meta, event_id) with status='sent'.
  // If another dispatch already reserved it, the unique index rejects.
  const meta = await loadProvider(admin, "meta_pixel");
  const capi = await loadProvider(admin, "meta_capi");

  if (!meta?.enabled && !capi?.enabled) {
    await logEvent(admin, input, "internal", "skipped", "meta disabled");
    return { status: "skipped", error: "disabled" };
  }

  const alreadySent = await admin
    .from("marketing_events")
    .select("id")
    .eq("platform", "meta")
    .eq("event_id", input.event_id)
    .eq("status", "sent")
    .maybeSingle();
  if (alreadySent.data) {
    await logEvent(admin, input, "meta", "deduplicated", "duplicate event_id");
    return { status: "deduplicated" };
  }

  if (!capi?.enabled || !capi.public_id) {
    // Pixel-only: nothing to send server-side. Log and let the browser fire it.
    await logEvent(admin, input, "meta", "skipped", "capi disabled");
    return { status: "skipped", error: "capi_disabled" };
  }

  const event: CapiEvent = {
    event_name: input.meta_event_name ?? mapEventName(input.kind),
    event_time: Math.floor(Date.now() / 1000),
    event_id: input.event_id,
    action_source: "website",
    user_data: {
      em: input.email ? [hashEmail(input.email)!] : undefined,
    },
    custom_data: {
      currency: input.currency ?? "NGN",
      value: input.amount ?? undefined,
      content_ids: input.tool_slug ? [input.tool_slug] : undefined,
      content_type: "product",
      order_id: input.order_id ?? undefined,
      ...input.custom,
    },
  };

  const result = await sendCapiEvents({
    pixelId: capi.public_id,
    events: [event],
    testEventCode: capi.test_event_code,
  });

  if (result.ok) {
    await logEvent(admin, input, "meta", "sent");
    await admin
      .from("marketing_integrations")
      .update({
        connected: true,
        last_event_at: new Date().toISOString(),
        last_event_name: event.event_name,
        last_error_at: null,
        last_error_message: null,
      })
      .eq("provider", "meta_capi");
    return { status: "sent" };
  }

  await logEvent(admin, input, "meta", "failed", result.error);
  await admin
    .from("marketing_integrations")
    .update({
      last_error_at: new Date().toISOString(),
      last_error_message: result.error.slice(0, 400),
    })
    .eq("provider", "meta_capi");
  return { status: "failed", error: result.error };
}

function mapEventName(kind: string): string {
  switch (kind) {
    case "purchase":
    case "renewal_success":
    case "private_fulfilment":
      return "Purchase";
    case "subscription_start":
      return "Subscribe";
    case "renewal_failed":
      return "SubscriptionRenewalFailed";
    case "renewal_disabled":
      return "SubscriptionCancel";
    case "refund":
      return "Refund";
    default:
      return "Purchase";
  }
}

async function logEvent(
  admin: Admin,
  input: {
    kind: string;
    event_id: string;
    order_id?: string | null;
    user_id?: string | null;
    tool_slug?: string | null;
    amount?: number | null;
    currency?: string | null;
    custom?: Record<string, unknown>;
  },
  platform: "meta" | "gtm" | "internal",
  status: "sent" | "failed" | "skipped" | "deduplicated" | "pending",
  error?: string,
) {
  try {
    await admin.from("marketing_events").insert({
      event_name: input.kind,
      platform,
      event_id: input.event_id,
      source: "server",
      status,
      order_id: input.order_id ?? null,
      user_id: input.user_id ?? null,
      tool_slug: input.tool_slug ?? null,
      amount: input.amount ?? null,
      currency: input.currency ?? null,
      payload: input.custom ?? {},
      error_message: error?.slice(0, 400) ?? null,
    });
  } catch (err) {
    console.warn("[marketing] failed to log event", err);
  }
}

export { buildEventId };
