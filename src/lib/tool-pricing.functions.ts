import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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
});

export const upsertToolPricing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => upsertInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const row = {
      tool_slug: data.tool_slug,
      label: data.label ?? null,
      amount: data.contact_admin ? null : data.amount ?? null,
      unit: data.contact_admin ? null : data.unit ?? null,
      currency: data.currency ?? "₦",
      contact_admin: data.contact_admin ?? false,
      sort_order: data.sort_order ?? 0,
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

export function formatPrice(opt: ToolPricingOption): string {
  if (opt.contact_admin) return "Contact admin";
  if (opt.amount == null) return "Contact admin";
  const amt = Number(opt.amount).toLocaleString("en-US", {
    maximumFractionDigits: 0,
  });
  const unit = opt.unit ? ` / ${opt.unit}` : "";
  return `${opt.currency}${amt}${unit}`;
}
