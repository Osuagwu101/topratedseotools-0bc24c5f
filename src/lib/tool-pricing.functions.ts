import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type AccessType = "shared" | "private";

export interface ToolPricingOption {
  id: string;
  tool_slug: string;
  label: string | null;
  amount: number | null;
  unit: string | null;
  currency: string;
  contact_admin: boolean;
  sort_order: number;
  duration_days: number | null;
  grace_days: number;
  warning_days: number;
  access_type: AccessType;
  billing_period: "monthly" | "quarterly" | "yearly" | null;
  enabled: boolean;
  note: string | null;
  badge: string | null;
  paystack_plan_code: string | null;
}




function publicClient() {
  const key = process.env.SUPABASE_PUBLISHABLE_KEY!;
  const url = process.env.SUPABASE_URL!;
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
    global: {
      fetch: (input, init) => {
        const h = new Headers(init?.headers);
        if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) {
          h.delete("Authorization");
        }
        h.set("apikey", key);
        return fetch(input, { ...init, headers: h });
      },
    },
  });
}

/** Public — returns all pricing rows for all tools. */
export const listToolPricing = createServerFn({ method: "GET" }).handler(async () => {
  const supabase = publicClient();
  const { data, error } = await supabase
    .from("tool_pricing")
    .select("*")
    .order("tool_slug", { ascending: true })
    .order("sort_order", { ascending: true });
  if (error) throw new Error(error.message);
  return { options: (data ?? []) as ToolPricingOption[] };
});

async function assertAdmin(context: { supabase: any; userId: string }) {
  const { data, error } = await context.supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", context.userId)
    .eq("role", "admin")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden");
}

const upsertInput = z.object({
  id: z.string().uuid().optional(),
  tool_slug: z.string().min(1),
  label: z.string().max(80).nullable().optional(),
  amount: z.number().nonnegative().nullable().optional(),
  unit: z.string().max(40).nullable().optional(),
  currency: z.string().max(8).optional(),
  contact_admin: z.boolean().optional(),
  sort_order: z.number().int().optional(),
  duration_days: z.number().int().min(0).max(3650).nullable().optional(),
  grace_days: z.number().int().min(0).max(60).optional(),
  warning_days: z.number().int().min(0).max(60).optional(),
  access_type: z.enum(["shared", "private"]).optional(),
  billing_period: z.enum(["monthly", "quarterly", "yearly"]).nullable().optional(),
  enabled: z.boolean().optional(),
  note: z.string().max(500).nullable().optional(),
  badge: z.string().max(80).nullable().optional(),
  paystack_plan_code: z.string().max(120).nullable().optional(),
});

export const upsertToolPricing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => upsertInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    // Derive billing_period from unit if the admin didn't set it explicitly,
    // and default duration_days by period so downstream checkout has a value.
    const unitLc = (data.unit ?? "").toLowerCase().trim();
    const derivedPeriod: "monthly" | "quarterly" | "yearly" | null =
      data.billing_period ??
      (unitLc === "month" || unitLc === "monthly" || unitLc === "mo"
        ? "monthly"
        : unitLc === "quarter" || unitLc === "quarterly" || unitLc === "3month" || unitLc === "3months" || unitLc === "3mo"
          ? "quarterly"
          : unitLc === "year" || unitLc === "yearly" || unitLc === "annual" || unitLc === "yr"
            ? "yearly"
            : null);
    const durationDefault: number | null =
      derivedPeriod === "monthly"
        ? 28
        : derivedPeriod === "quarterly"
          ? 90
          : derivedPeriod === "yearly"
            ? 365
            : null;
    const row = {
      tool_slug: data.tool_slug,
      label: data.label ?? null,
      amount: data.contact_admin ? null : data.amount ?? null,
      unit: data.contact_admin ? null : data.unit ?? null,
      currency: data.currency ?? "₦",
      contact_admin: data.contact_admin ?? false,
      sort_order: data.sort_order ?? 0,
      duration_days: data.contact_admin
        ? null
        : data.duration_days ?? durationDefault,
      grace_days: data.grace_days ?? 0,
      warning_days: data.warning_days ?? 0,
      access_type: data.access_type ?? "shared",
      billing_period: data.contact_admin ? null : derivedPeriod,
      enabled: data.enabled ?? true,
      note: data.note ?? null,
      badge: data.badge ?? null,
      paystack_plan_code: data.paystack_plan_code ?? null,
    };


    if (data.id) {
      const { error } = await context.supabase
        .from("tool_pricing")
        .update(row)
        .eq("id", data.id);
      if (error) throw new Error(error.message);
      return { ok: true, id: data.id };
    }
    const { data: inserted, error } = await context.supabase
      .from("tool_pricing")
      .insert(row)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { ok: true, id: inserted.id };
  });


export const deleteToolPricing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { error } = await context.supabase
      .from("tool_pricing")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Public price label used across tool cards, pricing page rows, order page,
 * and admin preview. Contact-admin rows render a neutral hand-off string
 * (never ₦0 / "Free" / "Contact admin as if it were a price").
 *
 * The heavy lifting lives in `src/lib/currency.ts`; this stays for
 * back-compat with existing imports.
 */
import { formatPlanPriceCompact } from "@/lib/currency";
export function formatPrice(opt: ToolPricingOption): string {
  return formatPlanPriceCompact(opt);
}
