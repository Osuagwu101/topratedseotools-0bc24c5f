/**
 * Account pool & capacity management — server functions.
 *
 * Provides Admin CRUD over `tool_accounts` (multiple login accounts per
 * tool per access type, each with a configurable capacity), plus the
 * assignment engine used by the Paystack webhook and offline flow,
 * plus reassignment, release, and health-check helpers.
 *
 * Concurrency safety: assignment is delegated to
 * `assign_tool_account_for_order(order_id)` which uses
 * `FOR UPDATE SKIP LOCKED` on the chosen account and re-checks the
 * active count under the lock.
 */
import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ---------- shared types ----------
export type AccountAccessType = "shared" | "private";
export type AccountStatus =
  | "working"
  | "login_failed"
  | "password_changed"
  | "suspended"
  | "expired"
  | "tool_unavailable"
  | "maintenance"
  | "other";

export interface ToolAccount {
  id: string;
  tool_slug: string;
  access_type: AccountAccessType;
  label: string;
  login_email: string | null;
  login_password: string | null;
  login_url: string | null;
  login_notes: string | null;
  one_click_login_url: string | null;
  max_capacity: number;
  expires_at: string | null;
  status: AccountStatus;
  enabled: boolean;
  needs_capacity_review: boolean;
  last_health_check_at: string | null;
  last_health_check_by: string | null;
  last_health_check_note: string | null;
  created_at: string;
  updated_at: string;
}

export interface ToolAccountWithUsage extends ToolAccount {
  active_count: number;
  available: number;
  fill_pct: number;
}

type AppSupabase = SupabaseClient<Database>;
type ToolAccountRow = Database["public"]["Tables"]["tool_accounts"]["Row"];
type ToolAccountPatch = Database["public"]["Tables"]["tool_accounts"]["Update"];
type ToolAccountSummaryRow = Pick<
  ToolAccountRow,
  | "id"
  | "tool_slug"
  | "access_type"
  | "label"
  | "login_email"
  | "login_password"
  | "login_url"
  | "login_notes"
  | "one_click_login_url"
  | "max_capacity"
  | "expires_at"
  | "status"
  | "enabled"
  | "needs_capacity_review"
  | "last_health_check_at"
  | "last_health_check_by"
  | "last_health_check_note"
  | "created_at"
  | "updated_at"
>;

async function assertAdmin(ctx: { supabase: AppSupabase; userId: string }) {
  const { data, error } = await ctx.supabase.rpc("has_role", {
    _user_id: ctx.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden");
}

/**
 * Internal helper — called from webhook + offline flow after an order
 * becomes approved. Idempotent per order.
 */
export async function tryAutoAssignAccount(admin: AppSupabase, orderId: string): Promise<string | null> {
  const { data, error } = await admin.rpc("assign_tool_account_for_order", {
    _order_id: orderId,
  });
  if (error) {
    if (String(error.code) === "23505") {
      const { data: existing } = await admin.from("tool_account_assignments")
        .select("id")
        .eq("order_id", orderId)
        .eq("status", "active")
        .maybeSingle();
      return (existing?.id as string | undefined) ?? null;
    }
    console.warn("[account-pool] assign failed", error);
    return null;
  }
  return (data as string | null) ?? null;
}

// ---------- helpers ----------
async function countsByAccount(admin: AppSupabase, accountIds: string[]) {
  const counts: Record<string, number> = {};
  if (!accountIds.length) return counts;
  const { data } = await admin.from("tool_account_assignments")
    .select("account_id")
    .in("account_id", accountIds)
    .eq("status", "active");
  for (const row of data ?? []) {
    const id = row.account_id;
    counts[id] = (counts[id] ?? 0) + 1;
  }
  return counts;
}

function normalizeAccessType(value: string): AccountAccessType {
  return value === "private" ? "private" : "shared";
}

function normalizeAccountStatus(value: string): AccountStatus {
  switch (value) {
    case "working":
    case "login_failed":
    case "password_changed":
    case "suspended":
    case "expired":
    case "tool_unavailable":
    case "maintenance":
      return value;
    default:
      return "other";
  }
}

function decorate(
  rows: ToolAccountSummaryRow[],
  counts: Record<string, number>,
): ToolAccountWithUsage[] {
  return rows.map((a) => {
    const active = counts[a.id] ?? 0;
    return {
      ...a,
      access_type: normalizeAccessType(a.access_type),
      status: normalizeAccountStatus(a.status),
      active_count: active,
      available: Math.max(0, a.max_capacity - active),
      fill_pct: a.max_capacity > 0 ? Math.round((active / a.max_capacity) * 100) : 0,
    };
  });
}

// ---------- ADMIN: list accounts for a tool ----------
export const adminListAccountsForTool = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ tool_slug: z.string().min(1).max(120) }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: accounts, error } = await supabaseAdmin.from("tool_accounts")
      .select("*")
      .eq("tool_slug", data.tool_slug)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    const rows = accounts ?? [];
    const counts = await countsByAccount(
      supabaseAdmin,
      rows.map((r) => r.id as string),
    );
    return { accounts: decorate(rows, counts) };
  });

// ---------- ADMIN: list ALL accounts (Access Health) ----------
export const adminListAllAccounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: accounts, error } = await supabaseAdmin.from("tool_accounts")
      .select("*")
      .order("tool_slug", { ascending: true });
    if (error) throw new Error(error.message);
    const rows = accounts ?? [];
    const counts = await countsByAccount(
      supabaseAdmin,
      rows.map((r) => r.id as string),
    );
    return { accounts: decorate(rows, counts) };
  });

// ---------- ADMIN: list assignments on an account ----------
export const adminListAccountAssignments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ account_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows } = await supabaseAdmin.from("tool_account_assignments")
      .select("id, user_id, order_id, status, assigned_at, released_at, released_reason")
      .eq("account_id", data.account_id)
      .order("assigned_at", { ascending: false })
      .limit(200);
    const list = rows ?? [];
    const userIds = Array.from(new Set(list.map((r) => r.user_id as string)));
    const profiles: Record<string, { email: string | null; full_name: string | null }> = {};
    if (userIds.length) {
      const { data: profs } = await supabaseAdmin
        .from("profiles")
        .select("id, email, full_name")
        .in("id", userIds);
      for (const p of profs ?? []) {
        profiles[p.id] = {
          email: p.email ?? null,
          full_name: p.full_name ?? null,
        };
      }
    }
    return {
      assignments: list.map((r) => ({
        ...r,
        profile: profiles[r.user_id as string] ?? { email: null, full_name: null },
      })),
    };
  });

// ---------- ADMIN: upsert / delete account ----------
const upsertInput = z.object({
  id: z.string().uuid().optional(),
  tool_slug: z.string().min(1).max(120),
  access_type: z.enum(["shared", "private"]),
  label: z.string().trim().max(120).optional(),
  login_email: z.string().max(200).nullable().optional(),
  login_password: z.string().max(500).nullable().optional(),
  login_url: z.string().max(500).nullable().optional(),
  login_notes: z.string().max(2000).nullable().optional(),
  one_click_login_url: z.string().max(500).nullable().optional(),
  max_capacity: z.number().int().min(1).max(1000).optional(),
  expires_at: z.string().nullable().optional(),
  status: z
    .enum([
      "working",
      "login_failed",
      "password_changed",
      "suspended",
      "expired",
      "tool_unavailable",
      "maintenance",
      "other",
    ])
    .optional(),
  enabled: z.boolean().optional(),
  needs_capacity_review: z.boolean().optional(),
});

export const adminUpsertAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => upsertInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (data.id && data.max_capacity !== undefined) {
      const { count } = await supabaseAdmin.from("tool_account_assignments")
        .select("id", { count: "exact", head: true })
        .eq("account_id", data.id)
        .eq("status", "active");
      if ((count ?? 0) > data.max_capacity) {
        throw new Error(
          `Cannot set capacity below the ${count} active customers already assigned. Reassign or release them first.`,
        );
      }
    }

    // Enforce Private = 1
    if (data.access_type === "private" && (data.max_capacity ?? 1) !== 1) {
      data.max_capacity = 1;
    }

    const patch: ToolAccountPatch = {
      tool_slug: data.tool_slug,
      access_type: data.access_type,
    };
    for (const k of [
      "label",
      "login_email",
      "login_password",
      "login_url",
      "login_notes",
      "one_click_login_url",
      "max_capacity",
      "expires_at",
      "status",
      "enabled",
      "needs_capacity_review",
    ] as const) {
      if (data[k] !== undefined) patch[k] = data[k];
    }

    if (data.id) {
      const { data: updated, error } = await supabaseAdmin.from("tool_accounts")
        .update(patch)
        .eq("id", data.id)
        .select()
        .maybeSingle();
      if (error) throw new Error(error.message);
      await supabaseAdmin.from("tool_account_audit").insert({
        account_id: data.id,
        action: "account_updated",
        actor: context.userId,
      });
      const { logAdminActivity } = await import("@/lib/admin-audit.server");
      await logAdminActivity(context, {
        action: "account_updated",
        area: "credentials",
        target_type: "tool_account",
        target_id: data.id,
        reference: `${data.tool_slug} · ${data.access_type}`,
      });
      return { ok: true, account: updated };
    }
    patch.created_by = context.userId;
    const { data: inserted, error } = await supabaseAdmin.from("tool_accounts")
      .insert(patch)
      .select()
      .single();
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("tool_account_audit").insert({
      account_id: inserted.id,
      action: "account_created",
      actor: context.userId,
    });
    const { logAdminActivity } = await import("@/lib/admin-audit.server");
    await logAdminActivity(context, {
      action: "account_created",
      area: "credentials",
      target_type: "tool_account",
      target_id: inserted.id,
      reference: `${data.tool_slug} · ${data.access_type}`,
    });
    return { ok: true, account: inserted };
  });

export const adminDeleteAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { count } = await supabaseAdmin.from("tool_account_assignments")
      .select("id", { count: "exact", head: true })
      .eq("account_id", data.id)
      .eq("status", "active");
    if ((count ?? 0) > 0) {
      throw new Error(
        `Cannot delete: ${count} active customers are still assigned. Reassign them first, or disable the account instead.`,
      );
    }
    const { error } = await supabaseAdmin.from("tool_accounts").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("tool_account_audit").insert({
      action: "account_deleted",
      actor: context.userId,
      notes: `Deleted account ${data.id}`,
    });
    const { logAdminActivity } = await import("@/lib/admin-audit.server");
    await logAdminActivity(context, {
      action: "account_deleted",
      area: "credentials",
      target_type: "tool_account",
      target_id: data.id,
    });
    return { ok: true };
  });

// ---------- ADMIN: reassign a customer ----------
export const adminReassignCustomer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        order_id: z.string().uuid(),
        new_account_id: z.string().uuid(),
        reason: z.string().trim().max(500).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: order } = await supabaseAdmin
      .from("tool_orders")
      .select("id, user_id, tool_slug, access_type, status, expires_at")
      .eq("id", data.order_id)
      .maybeSingle();
    if (!order) throw new Error("Order not found");

    const { data: target } = await supabaseAdmin.from("tool_accounts")
      .select("*")
      .eq("id", data.new_account_id)
      .maybeSingle();
    if (!target) throw new Error("Target account not found");
    if (target.tool_slug !== order.tool_slug)
      throw new Error("Target account belongs to a different tool.");
    if (target.access_type !== (order.access_type ?? "shared"))
      throw new Error("Target account has a different access type.");
    if (!target.enabled) throw new Error("Target account is disabled.");

    const { count } = await supabaseAdmin.from("tool_account_assignments")
      .select("id", { count: "exact", head: true })
      .eq("account_id", data.new_account_id)
      .eq("status", "active");
    if ((count ?? 0) >= target.max_capacity) throw new Error("Target account has no available spaces.");

    const { data: current } = await supabaseAdmin.from("tool_account_assignments")
      .select("id, account_id")
      .eq("order_id", data.order_id)
      .eq("status", "active")
      .maybeSingle();
    const oldAccountId = current?.account_id ?? null;

    if (current) {
      await supabaseAdmin.from("tool_account_assignments")
        .update({
          status: "reassigned",
          released_at: new Date().toISOString(),
          released_reason: data.reason ?? "admin_reassign",
        })
        .eq("id", current.id);
    }

    const { data: inserted, error: insErr } = await supabaseAdmin.from("tool_account_assignments")
      .insert({
        account_id: data.new_account_id,
        user_id: order.user_id,
        order_id: order.id,
        tool_slug: order.tool_slug,
        access_type: order.access_type ?? "shared",
        status: "active",
        assigned_by: context.userId,
      })
      .select("id")
      .single();
    if (insErr) throw new Error(insErr.message);

    await supabaseAdmin.from("tool_account_audit").insert({
      account_id: data.new_account_id,
      from_account_id: oldAccountId,
      to_account_id: data.new_account_id,
      user_id: order.user_id,
      order_id: order.id,
      action: "reassigned",
      actor: context.userId,
      notes: data.reason ?? null,
    });
    const { logAdminActivity } = await import("@/lib/admin-audit.server");
    await logAdminActivity(context, {
      action: "customer_reassigned",
      area: "credentials",
      target_type: "tool_order",
      target_id: order.id,
      reason: data.reason,
      reference: `${order.tool_slug} → account ${data.new_account_id}`,
    });

    return { ok: true, assignment_id: inserted.id };
  });

// ---------- ADMIN: record a health check ----------
export const adminRecordHealthCheck = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        account_id: z.string().uuid(),
        result: z.enum([
          "working",
          "login_failed",
          "password_changed",
          "suspended",
          "expired",
          "tool_unavailable",
          "other",
        ]),
        note: z.string().trim().max(1000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const nowIso = new Date().toISOString();
    const { error } = await supabaseAdmin.from("tool_accounts")
      .update({
        status: data.result,
        last_health_check_at: nowIso,
        last_health_check_by: context.userId,
        last_health_check_note: data.note ?? null,
      })
      .eq("id", data.account_id);
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("tool_account_audit").insert({
      account_id: data.account_id,
      action: `health_check_${data.result}`,
      actor: context.userId,
      notes: data.note ?? null,
    });
    const { logAdminActivity } = await import("@/lib/admin-audit.server");
    await logAdminActivity(context, {
      action: `health_check_${data.result}`,
      area: "credentials",
      target_type: "tool_account",
      target_id: data.account_id,
      reason: data.note,
    });
    return { ok: true };
  });

// ---------- USER: my active assignments ----------
export interface MyAssignedAccount {
  account_id: string;
  tool_slug: string;
  access_type: AccountAccessType;
  login_email: string | null;
  login_password: string | null;
  login_url: string | null;
  login_notes: string | null;
  one_click_login_url: string | null;
}

/**
 * Returns the caller's active assignments. Customer only sees their own
 * account details — no other customers, capacity, labels, or notes.
 */
export const getMyAssignedAccounts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: assigns } = await supabaseAdmin.from("tool_account_assignments")
      .select("account_id, tool_slug, access_type")
      .eq("user_id", context.userId)
      .eq("status", "active");
    const list = assigns ?? [];
    const ids = list.map((a) => a.account_id);
    if (!ids.length) return { assignments: [] as MyAssignedAccount[] };
    const { data: accounts } = await supabaseAdmin.from("tool_accounts")
      .select(
        "id, tool_slug, access_type, login_email, login_password, login_url, login_notes, one_click_login_url",
      )
      .in("id", ids);
    const byId = new Map((accounts ?? []).map((account) => [account.id, account] as const));
    const out: MyAssignedAccount[] = list
      .map((a) => {
        const acc = byId.get(a.account_id);
        if (!acc) return null;
        return {
          account_id: a.account_id,
          tool_slug: a.tool_slug,
          access_type: normalizeAccessType(a.access_type),
          login_email: acc.login_email ?? null,
          login_password: acc.login_password ?? null,
          login_url: acc.login_url ?? null,
          login_notes: acc.login_notes ?? null,
          one_click_login_url: acc.one_click_login_url ?? null,
        };
      })
      .filter((x): x is MyAssignedAccount => x !== null);
    return { assignments: out };
  });
