/**
 * Meta Conversions API — server-side event sender.
 *
 * The access token is read from `process.env.META_CAPI_ACCESS_TOKEN` inside
 * this function only (never at module scope, never in a client bundle).
 * Portable: to run on any host, define the same environment variable there.
 */
import { createHash } from "crypto";

export type CapiEvent = {
  event_name: string;
  event_time: number; // unix seconds
  event_id: string;
  action_source: "website";
  event_source_url?: string;
  user_data: {
    em?: string[]; // hashed email
    ph?: string[]; // hashed phone
    client_ip_address?: string;
    client_user_agent?: string;
    fbc?: string;
    fbp?: string;
  };
  custom_data?: Record<string, unknown>;
};

export function hashEmail(email: string | null | undefined): string | undefined {
  if (!email) return undefined;
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

export type CapiResult = { ok: true; events_received: number } | { ok: false; error: string };

/**
 * Send events to Meta CAPI. `pixelId` and `testEventCode` come from the DB.
 * Access token comes from process.env only.
 */
export async function sendCapiEvents(input: {
  pixelId: string;
  events: CapiEvent[];
  testEventCode?: string | null;
}): Promise<CapiResult> {
  const token = process.env.META_CAPI_ACCESS_TOKEN;
  if (!token) return { ok: false, error: "META_CAPI_ACCESS_TOKEN not configured" };
  if (!input.pixelId) return { ok: false, error: "pixel id missing" };
  const url = `https://graph.facebook.com/v19.0/${encodeURIComponent(input.pixelId)}/events`;
  const body: Record<string, unknown> = { data: input.events, access_token: token };
  if (input.testEventCode) body.test_event_code = input.testEventCode;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as {
      events_received?: number;
      error?: { message?: string };
    };
    if (!res.ok || json.error) {
      return { ok: false, error: (json.error?.message ?? `HTTP ${res.status}`).slice(0, 400) };
    }
    return { ok: true, events_received: json.events_received ?? input.events.length };
  } catch (err) {
    return { ok: false, error: (err instanceof Error ? err.message : String(err)).slice(0, 400) };
  }
}
