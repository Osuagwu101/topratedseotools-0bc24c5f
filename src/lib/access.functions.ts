/**
 * Access control + tool orders — server functions.
 *
 * This is the platform's centralized permission layer:
 *  - Tool settings (enabled / access_level) come from the DB and overlay
 *    the static catalog in `tools-data.ts`.
 *  - Users request access to a tool by creating a `tool_orders` row.
 *    Admins approve/reject. Approved orders (with future expires_at) grant
 *    access. `getMyAccess` returns the live set.
 *  - Everything is designed so future features (Paystack webhook, coupons,
 *    referral rewards, wallet credits) can plug in without a rewrite:
 *      * a webhook simply flips a pending order to `approved`
 *      * coupons can decorate the `price_amount` on order creation
 *      * wallet debits become an additional row on the order
 */
import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type ToolAccessLevel = "public" | "logged_in" | "purchased";
export type ToolOrderStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "cancelled"
  | "expired";

export interface ToolSetting {
  tool_slug: string;
  enabled: boolean;
  access_level: ToolAccessLevel;
  login_email?: string | null;
  login_password?: string | null;
  login_url?: string | null;
  login_notes?: string | null;
}


export interface ToolOrder {
  id: string;
  user_id: string;
  tool_slug: string;
  pricing_option_id: string | null;
  price_amount: number | null;
  price_label: string | null;
  currency: string;
  status: ToolOrderStatus;
  notes: string | null;
  admin_notes: string | null;
  expires_at: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
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

// ---------- PUBLIC ----------

/** Public — every tool's settings. Cached and read by every tool card. */
export const listToolSettings = createServerFn({ method: "GET" }).handler(
  async () => {
    const supabase = publicClient();
    const { data, error } = await supabase.from("tool_settings").select("*");
    if (error) throw new Error(error.message);
    return { settings: (data ?? []) as ToolSetting[] };
  },
);

// ---------- USER ----------

/** Auth — returns the current user's active (approved, unexpired) tool slugs, with credentials. */
export const getMyAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const nowIso = new Date().toISOString();
    const { data, error } = await context.supabase
      .from("tool_orders")
      .select("id, tool_slug, expires_at, approved_at, paid_at, duration_days, grace_days, warning_days")
      .eq("user_id", context.userId)
      .eq("status", "approved")
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`);
    if (error) throw new Error(error.message);

    const slugs = Array.from(new Set((data ?? []).map((r) => r.tool_slug as string)));
    let creds: Record<string, { email: string | null; password: string | null; login_url: string | null; login_notes: string | null }> = {};
    if (slugs.length > 0) {
      const { data: settings } = await context.supabase
        .from("tool_settings")
        .select("tool_slug, login_email, login_password, login_url, login_notes")
        .in("tool_slug", slugs);
      for (const s of settings ?? []) {
        creds[s.tool_slug as string] = {
          email: s.login_email as string | null,
          password: s.login_password as string | null,
          login_url: s.login_url as string | null,
          login_notes: s.login_notes as string | null,
        };
      }
    }

    return {
      access: (data ?? []).map((r) => ({
        order_id: r.id as string,
        tool_slug: r.tool_slug as string,
        expires_at: r.expires_at as string | null,
        approved_at: r.approved_at as string | null,
        paid_at: r.paid_at as string | null,
        duration_days: (r.duration_days as number) ?? null,
        grace_days: (r.grace_days as number) ?? 0,
        warning_days: (r.warning_days as number) ?? 0,
        credentials: creds[r.tool_slug as string] ?? null,
      })),
    };
  });


/** Auth — the current user's orders (all statuses). */
export const listMyOrders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("tool_orders")
      .select("*")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { orders: (data ?? []) as ToolOrder[] };
  });

const createOrderInput = z.object({
  tool_slug: z.string().min(1).max(120),
  pricing_option_id: z.string().uuid().nullable().optional(),
  notes: z.string().max(1000).nullable().optional(),
});

/** Auth — user requests access to a tool. */
export const createOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => createOrderInput.parse(input))
  .handler(async ({ data, context }) => {
    // Snapshot pricing at time of order so future price edits don't rewrite history.
    let price_amount: number | null = null;
    let price_label: string | null = null;
    let currency = "₦";
    if (data.pricing_option_id) {
      const { data: opt } = await context.supabase
        .from("tool_pricing")
        .select("amount, label, currency, contact_admin, tool_slug")
        .eq("id", data.pricing_option_id)
        .maybeSingle();
      if (opt && opt.tool_slug === data.tool_slug) {
        price_amount = opt.contact_admin ? null : (opt.amount as number | null);
        price_label = opt.label as string | null;
        currency = (opt.currency as string) ?? "₦";
      }
    }

    // Reject duplicate pending orders on the same tool.
    const { data: existing } = await context.supabase
      .from("tool_orders")
      .select("id")
      .eq("user_id", context.userId)
      .eq("tool_slug", data.tool_slug)
      .eq("status", "pending")
      .maybeSingle();
    if (existing) {
      return { ok: true, orderId: existing.id as string, duplicate: true };
    }

    const { data: inserted, error } = await context.supabase
      .from("tool_orders")
      .insert({
        user_id: context.userId,
        tool_slug: data.tool_slug,
        pricing_option_id: data.pricing_option_id ?? null,
        price_amount,
        price_label,
        currency,
        notes: data.notes ?? null,
        status: "pending",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { ok: true, orderId: inserted.id as string, duplicate: false };
  });

/** Auth — user cancels their own pending order. */
export const cancelMyOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("tool_orders")
      .update({ status: "cancelled" })
      .eq("id", data.id)
      .eq("user_id", context.userId)
      .eq("status", "pending");
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- ADMIN ----------

/** Admin — upsert a single tool's settings. */
const upsertSettingInput = z.object({
  tool_slug: z.string().min(1).max(120),
  enabled: z.boolean().optional(),
  access_level: z.enum(["public", "logged_in", "purchased"]).optional(),
});
export const adminUpsertToolSetting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => upsertSettingInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const patch = {
      tool_slug: data.tool_slug,
      ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
      ...(data.access_level !== undefined ? { access_level: data.access_level } : {}),
    };
    const { error } = await context.supabase
      .from("tool_settings")
      .upsert(patch, { onConflict: "tool_slug" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Admin — list every order (paged simply, most-recent first). */
export const adminListOrders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { data, error } = await context.supabase
      .from("tool_orders")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return { orders: (data ?? []) as ToolOrder[] };
  });

const updateOrderInput = z.object({
  id: z.string().uuid(),
  status: z
    .enum(["pending", "approved", "rejected", "cancelled", "expired"])
    .optional(),
  expires_at: z.string().nullable().optional(),
  admin_notes: z.string().max(2000).nullable().optional(),
});
/** Admin — approve/reject/adjust an order. */
export const adminUpdateOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => updateOrderInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const patch: {
      status?: ToolOrderStatus;
      approved_at?: string;
      expires_at?: string | null;
      admin_notes?: string | null;
    } = {};
    if (data.status !== undefined) {
      patch.status = data.status;
      if (data.status === "approved") patch.approved_at = new Date().toISOString();
    }
    if (data.expires_at !== undefined) patch.expires_at = data.expires_at;
    if (data.admin_notes !== undefined) patch.admin_notes = data.admin_notes;
    const { error } = await context.supabase
      .from("tool_orders")
      .update(patch)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
