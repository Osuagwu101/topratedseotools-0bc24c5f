/**
 * Phase 5 — Customer Communication Centre.
 *
 * Admin-only server functions for searching customers, viewing per-customer
 * email history, sending manual emails (announcements, resent access info,
 * resent receipts), listing expiring / renewal-failed subscriptions, and
 * simple segmentation filters.
 *
 * All actions gate on `has_role(admin)` and log to the admin activity log.
 * Manual emails go through the existing email queue so history is captured
 * in `email_messages` and the sender/reply-to come from `email_settings`.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { logAdminActivity } from "@/lib/admin-audit.server";

async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase.rpc("has_role", {
    _user_id: ctx.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

// -------------------------------------------------------------------------
// Search customers (light — for the picker in the Communication Centre)
// -------------------------------------------------------------------------

export const adminSearchCustomersLite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        query: z.string().trim().max(200).optional(),
        limit: z.number().int().min(1).max(50).optional(),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const admin = await assertAdmin(context);
    const limit = data.limit ?? 20;
    let q = admin
      .from("profiles")
      .select("id, email, full_name, created_at")
      .order("created_at", { ascending: false })
      .limit(limit);
    const s = (data.query ?? "").trim();
    if (s.length >= 1) {
      const esc = s.replace(/[%_,]/g, (m) => `\\${m}`);
      q = q.or(`email.ilike.%${esc}%,full_name.ilike.%${esc}%`);
    }
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return {
      customers: ((rows as any[]) ?? []).map((r) => ({
        userId: r.id as string,
        email: r.email as string | null,
        fullName: r.full_name as string | null,
        registeredAt: r.created_at as string,
      })),
    };
  });

// -------------------------------------------------------------------------
// Per-customer communication (email) history
// -------------------------------------------------------------------------

export const adminGetCustomerCommunicationHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ userId: z.string().uuid(), limit: z.number().int().min(1).max(200).optional() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const admin = await assertAdmin(context);
    const { data: rows } = await admin
      .from("email_messages")
      .select("id, template_key, subject, recipient, status, scheduled_for, sent_at, created_at, last_error, event_key")
      .eq("related_user_id", data.userId)
      .order("created_at", { ascending: false })
      .limit(data.limit ?? 100);
    return {
      messages: ((rows as any[]) ?? []).map((r) => ({
        id: r.id as string,
        templateKey: r.template_key as string,
        subject: r.subject as string | null,
        recipient: r.recipient as string,
        status: r.status as string,
        scheduledFor: r.scheduled_for as string | null,
        sentAt: r.sent_at as string | null,
        createdAt: r.created_at as string,
        lastError: r.last_error as string | null,
        eventKey: r.event_key as string,
      })),
    };
  });

// -------------------------------------------------------------------------
// Send a manual email to one customer
//
// Two modes:
//  - templateKey provided → uses that stored template (payload passed through)
//  - custom announcement  → templateKey = "admin_manual" with { subject, body_html }
// -------------------------------------------------------------------------

const manualEmailInput = z.object({
  userId: z.string().uuid(),
  templateKey: z.string().min(1).max(100),
  subject: z.string().trim().min(1).max(300).optional(),
  bodyHtml: z.string().trim().min(1).max(50000).optional(),
  extraPayload: z.record(z.string(), z.union([z.string(), z.number(), z.null()])).optional(),
});

export const adminSendManualEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => manualEmailInput.parse(input))
  .handler(async ({ data, context }) => {
    const admin = await assertAdmin(context);
    const { data: profile, error } = await admin
      .from("profiles")
      .select("email, full_name")
      .eq("id", data.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const p = profile as { email: string | null; full_name: string | null } | null;
    if (!p?.email) throw new Error("This customer has no email on file.");

    const payload: Record<string, string | number | null | undefined> = {
      name: p.full_name ?? "there",
      ...(data.extraPayload ?? {}),
    };
    if (data.templateKey === "admin_manual") {
      if (!data.subject || !data.bodyHtml) {
        throw new Error("Subject and message are required for a custom announcement.");
      }
      payload.subject = data.subject;
      payload.body_html = data.bodyHtml;
    }

    const eventKey = `admin_manual:${data.userId}:${Date.now()}`;
    const { queueEmail } = await import("@/lib/email/queue");
    const res = await queueEmail(admin, {
      eventKey,
      templateKey: data.templateKey,
      recipient: p.email,
      relatedUserId: data.userId,
      payload,
    });

    await logAdminActivity(
      { userId: context.userId },
      {
        action: "customer.email.manual_send",
        area: "communications",
        target_type: "profile",
        target_id: data.userId,
        success: res.queued,
        reference: `template=${data.templateKey}; ${res.queued ? `id=${res.id}` : `skipped=${res.skipped}`}`,
      },
    );

    return { ok: res.queued, id: res.id, skipped: res.skipped };
  });

// -------------------------------------------------------------------------
// Resend a specific past email (by original message id) — puts the same
// template + payload back on the queue with a new event key.
// -------------------------------------------------------------------------

export const adminResendPastEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ messageId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const admin = await assertAdmin(context);
    const { data: row } = await admin
      .from("email_messages")
      .select("template_key, recipient, payload, related_user_id, related_order_id")
      .eq("id", data.messageId)
      .maybeSingle();
    if (!row) throw new Error("Message not found.");
    const src = row as any;
    const { queueEmail } = await import("@/lib/email/queue");
    const res = await queueEmail(admin, {
      eventKey: `admin_resend:${data.messageId}:${Date.now()}`,
      templateKey: src.template_key,
      recipient: src.recipient,
      relatedUserId: src.related_user_id ?? null,
      relatedOrderId: src.related_order_id ?? null,
      payload: src.payload ?? {},
    });
    await logAdminActivity(
      { userId: context.userId },
      {
        action: "customer.email.resend",
        area: "communications",
        target_type: "email_message",
        target_id: data.messageId,
        success: res.queued,
        reference: `template=${src.template_key}`,
      },
    );
    return { ok: res.queued, id: res.id, skipped: res.skipped };
  });

// -------------------------------------------------------------------------
// Expiry / renewal management
// -------------------------------------------------------------------------

export const adminListExpiringSubscriptions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        withinDays: z.number().int().min(1).max(90).optional(),
        renewalFailed: z.boolean().optional(),
      })
      .parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const admin = await assertAdmin(context);
    const now = new Date();
    const withinDays = data.withinDays ?? 7;
    const upper = new Date(now.getTime() + withinDays * 86400_000).toISOString();

    let q = admin
      .from("tool_orders")
      .select(
        "id, user_id, tool_slug, access_type, billing_period, status, payment_status, expires_at, current_period_end, renewal_status",
      )
      .eq("status", "approved")
      .order("expires_at", { ascending: true })
      .limit(200);

    if (data.renewalFailed) {
      q = q.eq("renewal_status", "failed");
    } else {
      q = q.gte("expires_at", now.toISOString()).lte("expires_at", upper);
    }

    const { data: orders } = await q;
    const list = (orders as any[]) ?? [];
    if (list.length === 0) return { orders: [] as any[] };

    const userIds = Array.from(new Set(list.map((o) => o.user_id)));
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, email, full_name")
      .in("id", userIds);
    const pMap = new Map<string, { email: string | null; fullName: string | null }>(
      ((profiles as any[]) ?? []).map((p) => [p.id as string, { email: p.email, fullName: p.full_name }]),
    );
    return {
      orders: list.map((o) => ({
        id: o.id as string,
        userId: o.user_id as string,
        toolSlug: o.tool_slug as string,
        accessType: o.access_type as string | null,
        billingPeriod: o.billing_period as string | null,
        expiresAt: o.expires_at as string | null,
        renewalStatus: o.renewal_status as string | null,
        email: pMap.get(o.user_id)?.email ?? null,
        fullName: pMap.get(o.user_id)?.fullName ?? null,
      })),
    };
  });

export const adminExtendOrderExpiry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ orderId: z.string().uuid(), days: z.number().int().min(1).max(365) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const admin = await assertAdmin(context);
    const { data: row } = await admin
      .from("tool_orders")
      .select("id, user_id, expires_at, current_period_end")
      .eq("id", data.orderId)
      .maybeSingle();
    if (!row) throw new Error("Order not found.");
    const r = row as any;
    const base = r.expires_at ? new Date(r.expires_at) : new Date();
    if (Number.isNaN(base.getTime())) throw new Error("Order has no valid expiry to extend.");
    const start = base.getTime() > Date.now() ? base.getTime() : Date.now();
    const nextExpiry = new Date(start + data.days * 86400_000).toISOString();

    const patch: Record<string, unknown> = { expires_at: nextExpiry };
    if (r.current_period_end) patch.current_period_end = nextExpiry;
    const { error } = await admin.from("tool_orders").update(patch).eq("id", data.orderId);
    if (error) throw new Error(error.message);

    await logAdminActivity(
      { userId: context.userId },
      {
        action: "customer.access.extend",
        area: "communications",
        target_type: "tool_order",
        target_id: data.orderId,
        reference: `+${data.days}d → ${nextExpiry}`,
      },
    );
    return { ok: true, expiresAt: nextExpiry };
  });

// -------------------------------------------------------------------------
// Simple segmentation lists for the Communication Centre filters.
// -------------------------------------------------------------------------

export const adminListCustomerSegment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        segment: z.enum([
          "active",
          "expired",
          "new",
          "by_tool",
          "failed_payments",
          "no_reviews",
        ]),
        toolSlug: z.string().trim().max(120).optional(),
        newWithinDays: z.number().int().min(1).max(365).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const admin = await assertAdmin(context);
    const now = new Date();

    let userIds: string[] = [];

    if (data.segment === "active") {
      const { data: rows } = await admin
        .from("tool_orders")
        .select("user_id, expires_at")
        .eq("status", "approved")
        .gte("expires_at", now.toISOString())
        .limit(2000);
      userIds = Array.from(new Set(((rows as any[]) ?? []).map((r) => r.user_id)));
    } else if (data.segment === "expired") {
      const { data: rows } = await admin
        .from("tool_orders")
        .select("user_id, expires_at, status")
        .eq("status", "approved")
        .lt("expires_at", now.toISOString())
        .limit(2000);
      userIds = Array.from(new Set(((rows as any[]) ?? []).map((r) => r.user_id)));
    } else if (data.segment === "new") {
      const cutoff = new Date(now.getTime() - (data.newWithinDays ?? 14) * 86400_000).toISOString();
      const { data: rows } = await admin
        .from("profiles")
        .select("id")
        .gte("created_at", cutoff)
        .limit(2000);
      userIds = ((rows as any[]) ?? []).map((r) => r.id);
    } else if (data.segment === "by_tool") {
      if (!data.toolSlug) throw new Error("Choose a tool.");
      const { data: rows } = await admin
        .from("tool_orders")
        .select("user_id")
        .eq("tool_slug", data.toolSlug)
        .in("status", ["approved", "pending", "pending_manual"])
        .limit(2000);
      userIds = Array.from(new Set(((rows as any[]) ?? []).map((r) => r.user_id)));
    } else if (data.segment === "failed_payments") {
      const { data: rows } = await admin
        .from("tool_orders")
        .select("user_id")
        .in("payment_status", ["failed", "reversed"])
        .limit(2000);
      userIds = Array.from(new Set(((rows as any[]) ?? []).map((r) => r.user_id)));
    } else if (data.segment === "no_reviews") {
      const { data: buyers } = await admin
        .from("tool_orders")
        .select("user_id")
        .eq("status", "approved")
        .limit(2000);
      const buyerIds = Array.from(new Set(((buyers as any[]) ?? []).map((r) => r.user_id)));
      if (!buyerIds.length) return { customers: [] };
      const { data: reviewers } = await admin
        .from("tool_reviews")
        .select("user_id")
        .in("user_id", buyerIds);
      const reviewerSet = new Set(((reviewers as any[]) ?? []).map((r) => r.user_id));
      userIds = buyerIds.filter((id) => !reviewerSet.has(id));
    }

    if (!userIds.length) return { customers: [] };

    const { data: profiles } = await admin
      .from("profiles")
      .select("id, email, full_name, created_at")
      .in("id", userIds)
      .order("created_at", { ascending: false })
      .limit(500);
    return {
      customers: ((profiles as any[]) ?? []).map((p) => ({
        userId: p.id as string,
        email: p.email as string | null,
        fullName: p.full_name as string | null,
        registeredAt: p.created_at as string,
      })),
    };
  });
