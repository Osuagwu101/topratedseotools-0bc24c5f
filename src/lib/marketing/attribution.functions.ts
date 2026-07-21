/**
 * Attribution capture — writes go through server functions using the service
 * role to avoid needing anon INSERT/UPDATE on the marketing tables.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const snapshotSchema = z.object({
  utm_source: z.string().nullable().optional(),
  utm_medium: z.string().nullable().optional(),
  utm_campaign: z.string().nullable().optional(),
  utm_content: z.string().nullable().optional(),
  utm_term: z.string().nullable().optional(),
  fbclid: z.string().nullable().optional(),
  gclid: z.string().nullable().optional(),
  landing_page: z.string().nullable().optional(),
  referrer: z.string().nullable().optional(),
  captured_at: z.string().optional(),
});

const upsertSchema = z.object({
  visitor_id: z.string().min(3).max(80),
  first_touch: snapshotSchema.nullable().optional(),
  last_touch: snapshotSchema.nullable().optional(),
});

/**
 * Public — visitor stores attribution keyed by client-generated visitor_id.
 * No auth required. Rate-limited by natural upsert (one row per visitor).
 */
export const upsertVisitorAttribution = createServerFn({ method: "POST" })
  .inputValidator((input) => upsertSchema.parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const last = data.last_touch ?? data.first_touch ?? null;
    const first = data.first_touch ?? last;
    const now = new Date().toISOString();

    const { data: existing } = await supabaseAdmin
      .from("marketing_attribution")
      .select("id, first_touch")
      .eq("visitor_id", data.visitor_id)
      .maybeSingle();

    if (existing) {
      await supabaseAdmin
        .from("marketing_attribution")
        .update({
          last_touch: last ?? undefined,
          utm_source: last?.utm_source ?? undefined,
          utm_medium: last?.utm_medium ?? undefined,
          utm_campaign: last?.utm_campaign ?? undefined,
          utm_content: last?.utm_content ?? undefined,
          utm_term: last?.utm_term ?? undefined,
          fbclid: last?.fbclid ?? undefined,
          gclid: last?.gclid ?? undefined,
          landing_page: last?.landing_page ?? undefined,
          referrer: last?.referrer ?? undefined,
          last_seen_at: now,
        })
        .eq("id", existing.id);
    } else {
      await supabaseAdmin.from("marketing_attribution").insert({
        visitor_id: data.visitor_id,
        first_touch: first,
        last_touch: last,
        utm_source: last?.utm_source ?? null,
        utm_medium: last?.utm_medium ?? null,
        utm_campaign: last?.utm_campaign ?? null,
        utm_content: last?.utm_content ?? null,
        utm_term: last?.utm_term ?? null,
        fbclid: last?.fbclid ?? null,
        gclid: last?.gclid ?? null,
        landing_page: last?.landing_page ?? null,
        referrer: last?.referrer ?? null,
      });
    }
    return { ok: true };
  });

/** Auth — link the visitor id to the signed-in user (once they log in). */
export const linkAttributionToUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ visitor_id: z.string().min(3).max(80) }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin
      .from("marketing_attribution")
      .update({ user_id: context.userId })
      .eq("visitor_id", data.visitor_id);
    return { ok: true };
  });

/** Auth — attach snapshot to an order so admin can see the campaign. */
export const attachOrderAttribution = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        order_id: z.string().uuid(),
        visitor_id: z.string().min(3).max(80),
        snapshot: snapshotSchema.nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (context.supabase as any)
      .from("tool_orders")
      .update({
        attribution: {
          visitor_id: data.visitor_id,
          ...(data.snapshot ?? {}),
        },
      })
      .eq("id", data.order_id)
      .eq("user_id", context.userId);
    return { ok: true };
  });

/** Public — consent audit (persist client's decision to DB for compliance). */
export const recordConsentChoice = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        visitor_id: z.string().min(3).max(80),
        analytics: z.boolean(),
        marketing: z.boolean(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const now = new Date().toISOString();
    const { data: existing } = await supabaseAdmin
      .from("consent_choices")
      .select("id")
      .eq("visitor_id", data.visitor_id)
      .maybeSingle();
    if (existing) {
      await supabaseAdmin
        .from("consent_choices")
        .update({
          analytics: data.analytics,
          marketing: data.marketing,
          decided_at: now,
        })
        .eq("id", existing.id);
    } else {
      await supabaseAdmin.from("consent_choices").insert({
        visitor_id: data.visitor_id,
        analytics: data.analytics,
        marketing: data.marketing,
        decided_at: now,
      });
    }
    return { ok: true };
  });
