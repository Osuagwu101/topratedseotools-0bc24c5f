/**
 * Admin-facing server functions for managing marketing integrations.
 * Reads/writes go through `context.supabase` (RLS enforces admin role).
 * Sensitive tokens (META_CAPI_ACCESS_TOKEN) are never returned — we only
 * report whether the environment variable is set.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isValidPixelId, isValidGtmId } from "./config";

async function requireAdmin(context: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  userId: string;
}) {
  const { data } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", context.userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!data) throw new Error("Forbidden");
}

export const listIntegrations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context);
    const { data } = await context.supabase
      .from("marketing_integrations")
      .select(
        "provider, enabled, connected, public_id, test_event_code, last_event_at, last_event_name, last_error_at, last_error_message, updated_at",
      );
    return {
      integrations: (data ?? []) as Array<{
        provider: string;
        enabled: boolean;
        connected: boolean;
        public_id: string | null;
        test_event_code: string | null;
        last_event_at: string | null;
        last_event_name: string | null;
        last_error_at: string | null;
        last_error_message: string | null;
        updated_at: string;
      }>,
      capi_token_configured: !!process.env.META_CAPI_ACCESS_TOKEN,
      marketing_pause: await getMarketingPause(context.supabase),
    };
  });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getMarketingPause(sb: any): Promise<boolean> {
  const { data } = await sb
    .from("site_settings")
    .select("marketing_pause")
    .eq("id", true)
    .maybeSingle();
  return !!(data as { marketing_pause?: boolean } | null)?.marketing_pause;
}

export const saveMetaSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        pixel_enabled: z.boolean(),
        pixel_id: z.string().trim().nullable(),
        capi_enabled: z.boolean(),
        test_event_code: z.string().trim().max(50).nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    if (data.pixel_enabled && !isValidPixelId(data.pixel_id)) {
      throw new Error("Enter a valid Meta Pixel ID (8–20 digits).");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const pixelId = data.pixel_id?.trim() || null;
    const { data: savedPixel, error: pixelError } = await supabaseAdmin
      .from("marketing_integrations")
      .upsert({
        provider: "meta_pixel",
        enabled: data.pixel_enabled,
        public_id: pixelId,
        connected: !!pixelId,
        updated_by: context.userId,
      }, { onConflict: "provider" })
      .select("provider, enabled, public_id")
      .maybeSingle();
    if (pixelError || !savedPixel) throw new Error(pixelError?.message ?? "Pixel settings were not saved.");
    const { error: capiError } = await supabaseAdmin
      .from("marketing_integrations")
      .upsert({
        provider: "meta_capi",
        enabled: data.capi_enabled,
        public_id: pixelId,
        test_event_code: data.test_event_code || null,
        updated_by: context.userId,
      }, { onConflict: "provider" });
    if (capiError) throw new Error(capiError.message);
    return { ok: true, pixel_id: savedPixel.public_id, pixel_enabled: savedPixel.enabled };
  });

export const saveGtmSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        enabled: z.boolean(),
        container_id: z.string().trim().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    if (data.enabled && !isValidGtmId(data.container_id)) {
      throw new Error("Enter a valid GTM container ID like GTM-XXXXXXX.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const containerId = data.container_id?.trim() || null;
    const { data: saved, error } = await supabaseAdmin
      .from("marketing_integrations")
      .upsert({
        provider: "gtm",
        enabled: data.enabled,
        public_id: containerId,
        connected: !!containerId,
        updated_by: context.userId,
      }, { onConflict: "provider" })
      .select("provider, enabled, public_id")
      .maybeSingle();
    if (error || !saved) throw new Error(error?.message ?? "GTM settings were not saved.");
    return { ok: true, container_id: saved.public_id, enabled: saved.enabled };
  });

export const setMarketingPause = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ pause: z.boolean() }).parse(input))
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    await context.supabase
      .from("site_settings")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update({ marketing_pause: data.pause } as any)
      .eq("id", true);
    return { ok: true };
  });

/**
 * Confirm the browser Pixel setup without requiring optional server-side CAPI.
 */
export const testMetaConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context);
    const { data } = await context.supabase
      .from("marketing_integrations")
      .select("public_id, enabled")
      .eq("provider", "meta_pixel")
      .maybeSingle();
    const row = data as { public_id: string | null; enabled: boolean | null } | null;
    if (!row?.public_id) return { ok: false, error: "Save your Pixel ID first." };
    if (!isValidPixelId(row.public_id)) return { ok: false, error: "Enter a valid Meta Pixel ID." };
    if (!row.enabled) return { ok: false, error: "Enable Facebook Pixel first." };
    const now = new Date().toISOString();
    await context.supabase
      .from("marketing_integrations")
      .update({
        connected: true,
        last_event_at: now,
        last_event_name: "Browser Pixel ready",
        last_error_at: null,
        last_error_message: null,
      })
      .eq("provider", "meta_pixel");
    return { ok: true };
  });

/**
 * Test GTM — checks container reachability. GTM has no server API, so we
 * fetch the container script URL and confirm the ID resolves.
 */
export const testGtmConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requireAdmin(context);
    const { data } = await context.supabase
      .from("marketing_integrations")
      .select("public_id")
      .eq("provider", "gtm")
      .maybeSingle();
    const id = (data as { public_id: string | null } | null)?.public_id;
    if (!id || !isValidGtmId(id)) return { ok: false, error: "Enter a valid GTM container ID." };
    try {
      const res = await fetch(`https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(id)}`, {
        method: "GET",
      });
      const now = new Date().toISOString();
      if (res.ok) {
        await context.supabase
          .from("marketing_integrations")
          .update({
            connected: true,
            last_event_at: now,
            last_event_name: "gtm.js reachable",
            last_error_at: null,
            last_error_message: null,
          })
          .eq("provider", "gtm");
        return { ok: true };
      }
      await context.supabase
        .from("marketing_integrations")
        .update({ last_error_at: now, last_error_message: `HTTP ${res.status}` })
        .eq("provider", "gtm");
      return { ok: false, error: `Container returned HTTP ${res.status}` };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

export const listMarketingEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        limit: z.number().int().min(1).max(500).optional(),
        status: z.string().optional(),
        platform: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    let q = context.supabase
      .from("marketing_events")
      .select(
        "id, event_name, platform, event_id, source, status, order_id, user_id, tool_slug, amount, currency, error_message, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(data.limit ?? 100);
    if (data.status) q = q.eq("status", data.status);
    if (data.platform) q = q.eq("platform", data.platform);
    const { data: rows } = await q;
    return { events: rows ?? [] };
  });

export const retryFailedEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await requireAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("marketing_events")
      .select("event_name, event_id, order_id, user_id, tool_slug, amount, currency, payload")
      .eq("id", data.id)
      .maybeSingle();
    if (!row) throw new Error("Event not found");
    const { trackServerConversion } = await import("./server-events");
    const result = await trackServerConversion(supabaseAdmin, {
      kind: (row.event_name as
        | "purchase"
        | "subscription_start"
        | "renewal_success"
        | "renewal_failed"
        | "renewal_disabled"
        | "private_fulfilment"
        | "refund") ?? "purchase",
      event_id: row.event_id as string,
      order_id: row.order_id as string | null,
      user_id: row.user_id as string | null,
      tool_slug: row.tool_slug as string | null,
      amount: row.amount as number | null,
      currency: row.currency as string | null,
      custom: (row.payload as Record<string, unknown>) ?? {},
    });
    return result;
  });
