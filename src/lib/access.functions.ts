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
export type LaunchMode = "new_tab" | "same_tab" | "popup";

export interface ToolSetting {
  tool_slug: string;
  enabled: boolean;
  access_level: ToolAccessLevel;
  one_click_auth_enabled: boolean;
  official_login_url: string | null;
  auth_provider: string | null;
  launch_mode: LaunchMode;
  display_manual_credentials: boolean;
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
  paid_at: string | null;
  paystack_reference: string | null;
  duration_days: number | null;
  grace_days: number | null;
  warning_days: number | null;
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

/** Public — every tool's settings. Cached and read by every tool card. Credentials are NEVER included here. */
export const listToolSettings = createServerFn({ method: "GET" }).handler(
  async () => {
    const supabase = publicClient();
    const { data, error } = await supabase
      .from("tool_settings")
      .select(
        "tool_slug, enabled, access_level, one_click_auth_enabled, official_login_url, auth_provider, launch_mode, display_manual_credentials",
      );
    if (error) throw new Error(error.message);
    return { settings: (data ?? []) as unknown as ToolSetting[] };
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
    const creds: Record<string, { email: string | null; password: string | null; login_url: string | null; login_notes: string | null }> = {};
    if (slugs.length > 0) {
      // tool_credentials is admin-only via RLS; use the service-role client to
      // fetch just the rows the caller has already been shown to have paid for.
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: rows } = await supabaseAdmin
        .from("tool_credentials")
        .select("tool_slug, login_email, login_password, login_url, login_notes")
        .in("tool_slug", slugs);
      for (const s of rows ?? []) {
        creds[s.tool_slug as string] = {
          email: (s.login_email as string | null) ?? null,
          password: (s.login_password as string | null) ?? null,
          login_url: (s.login_url as string | null) ?? null,
          login_notes: (s.login_notes as string | null) ?? null,
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

/** Admin — upsert a single tool's settings (enable + access level only). */
const upsertSettingInput = z.object({
  tool_slug: z.string().min(1).max(120),
  enabled: z.boolean().optional(),
  access_level: z.enum(["public", "logged_in", "purchased"]).optional(),
  one_click_auth_enabled: z.boolean().optional(),
  official_login_url: z
    .string()
    .trim()
    .max(500)
    .url({ message: "Enter a valid URL (https://…)" })
    .nullable()
    .optional(),
  auth_provider: z.string().trim().max(80).nullable().optional(),
  launch_mode: z.enum(["new_tab", "same_tab", "popup"]).optional(),
  display_manual_credentials: z.boolean().optional(),
});
export const adminUpsertToolSetting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => upsertSettingInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    // Validate: when enabling one-click, an official login URL is required
    // (either provided in this patch, or already stored).
    if (data.one_click_auth_enabled === true) {
      let url = data.official_login_url;
      if (url === undefined) {
        const { data: existing } = await context.supabase
          .from("tool_settings")
          .select("official_login_url")
          .eq("tool_slug", data.tool_slug)
          .maybeSingle();
        url = (existing?.official_login_url as string | null) ?? null;
      }
      if (!url) {
        throw new Error(
          "Add an Official Login URL before enabling One-Click Login.",
        );
      }
    }
    const patch: Record<string, unknown> = { tool_slug: data.tool_slug };
    for (const k of [
      "enabled",
      "access_level",
      "one_click_auth_enabled",
      "official_login_url",
      "auth_provider",
      "launch_mode",
      "display_manual_credentials",
    ] as const) {
      if (data[k] !== undefined) patch[k] = data[k];
    }
    const { error } = await context.supabase
      .from("tool_settings")
      .upsert(patch, { onConflict: "tool_slug" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- CREDENTIAL VAULT (admin only, one row per tool) ----------

export interface ToolCredential {
  tool_slug: string;
  login_email: string | null;
  login_password: string | null;
  login_url: string | null;
  login_notes: string | null;
  updated_at: string;
}

/** Admin — list every stored login credential. */
export const adminListToolCredentials = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { data, error } = await context.supabase
      .from("tool_credentials")
      .select("*");
    if (error) throw new Error(error.message);
    return { credentials: (data ?? []) as ToolCredential[] };
  });

const upsertCredentialInput = z.object({
  tool_slug: z.string().min(1).max(120),
  login_email: z.string().max(200).nullable().optional(),
  login_password: z.string().max(500).nullable().optional(),
  login_url: z.string().max(500).nullable().optional(),
  login_notes: z.string().max(2000).nullable().optional(),
});
export const adminUpsertToolCredential = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => upsertCredentialInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const patch = {
      tool_slug: data.tool_slug,
      login_email: data.login_email ?? null,
      login_password: data.login_password ?? null,
      login_url: data.login_url ?? null,
      login_notes: data.login_notes ?? null,
    };
    const { error } = await context.supabase
      .from("tool_credentials")
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
