/**
 * Customer review system — eligibility, submit/update, moderation, public read.
 *
 * Eligibility (per user + tool):
 *   qualifying order = tool_orders row with status='approved',
 *     cancelled_at IS NULL, and (access_type != 'private' OR fulfilment_status = 'active').
 *   Source = 'paystack' when origin != 'offline' (default online purchase),
 *     otherwise 'offline'. Both grant Verified Purchase.
 *
 * Locking:
 *   - Each qualifying order allows ONE submission (initial or update).
 *   - `tool_reviews.version_no` counts submissions consumed.
 *   - canReview  = no review row AND qualifying_count >= 1
 *   - canEdit    = review row exists AND qualifying_count > version_no
 *
 * History:
 *   Every submission (create or update) writes a `tool_review_versions` row
 *   snapshotting title/body/rating/status/qualifying_order_id/version_no
 *   before rotating the current row. Previous versions are never deleted.
 *
 * Moderation:
 *   Every new submission returns to 'pending'. Only 'approved' rows appear
 *   publicly and count in ratings. Admins may set 'approved' | 'rejected' |
 *   'hidden' and add a private moderation_note. Admins cannot rewrite the
 *   customer's rating/title/body via these endpoints.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { checkReviewSafety } from "./reviews-safety";

export type ReviewStatus = "pending" | "approved" | "rejected" | "hidden";
export type ReviewSource = "paystack" | "offline";

export interface PublicReview {
  id: string;
  tool_slug: string;
  rating: number;
  title: string;
  body: string;
  display_name: string | null;
  verified_source: ReviewSource;
  access_type: "shared" | "private" | null;
  submitted_at: string;
}

export interface RatingAggregate {
  average: number;
  total: number;
  breakdown: Record<1 | 2 | 3 | 4 | 5, number>;
}

export interface MyReview {
  id: string;
  tool_slug: string;
  rating: number;
  title: string;
  body: string;
  display_name: string | null;
  status: ReviewStatus;
  moderation_note: string | null;
  verified_source: ReviewSource;
  version_no: number;
  submitted_at: string;
  updated_at: string;
}

export interface ReviewEligibility {
  tool_slug: string;
  qualifying_count: number;
  latest_qualifying_order_id: string | null;
  latest_qualifying_source: ReviewSource | null;
  latest_access_type: "shared" | "private" | null;
  review: MyReview | null;
  canReview: boolean;
  canEdit: boolean;
  reason: string | null;
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

interface QualifyingRow {
  id: string;
  origin: string | null;
  access_type: string | null;
  fulfilment_status: string | null;
  approved_at: string | null;
  paid_at: string | null;
  created_at: string;
}

/** Pure logic — exported for unit tests. */
export function isQualifyingOrder(row: {
  status: string | null;
  cancelled_at: string | null | undefined;
  access_type: string | null | undefined;
  fulfilment_status: string | null | undefined;
}): boolean {
  if (row.status !== "approved") return false;
  if (row.cancelled_at) return false;
  const access = (row.access_type ?? "shared").toLowerCase();
  if (access === "private") {
    return (row.fulfilment_status ?? "").toLowerCase() === "active";
  }
  return true;
}

/**
 * Pure — refunded/reversed orders never qualify for review or unlock an update.
 * `refundedOrderIds` is the set of order ids that have any tool_payments row
 * with payment_status in ('refunded','reversed') or reconciliation_status='refunded'.
 */
export function filterRefundedOrders<T extends { id: string }>(
  orders: T[],
  refundedOrderIds: Set<string>,
): T[] {
  return orders.filter((o) => !refundedOrderIds.has(o.id));
}

/** Pure — a tool_payments row indicating a refund/reversal for eligibility purposes. */
export function isRefundPayment(row: {
  payment_status: string | null | undefined;
  reconciliation_status?: string | null | undefined;
}): boolean {
  const st = (row.payment_status ?? "").toLowerCase();
  if (st === "refunded" || st === "reversed") return true;
  const rc = (row.reconciliation_status ?? "").toLowerCase();
  return rc === "refunded";
}

export function reviewSourceFor(origin: string | null | undefined): ReviewSource {
  return (origin ?? "").toLowerCase() === "offline" ? "offline" : "paystack";
}

/** Pure: canReview / canEdit derivation from counts + version_no. */
export function deriveReviewGate(input: {
  qualifyingCount: number;
  currentVersion: number | null; // null when no review exists
}): { canReview: boolean; canEdit: boolean; reason: string | null } {
  if (input.qualifyingCount <= 0) {
    return {
      canReview: false,
      canEdit: false,
      reason: "A verified purchase is required to review this tool.",
    };
  }
  if (input.currentVersion == null) {
    return { canReview: true, canEdit: false, reason: null };
  }
  if (input.qualifyingCount > input.currentVersion) {
    return { canReview: false, canEdit: true, reason: null };
  }
  return {
    canReview: false,
    canEdit: false,
    reason:
      "Purchase this tool again to unlock a review update. Buying a different tool does not unlock editing.",
  };
}

// ---------- USER ----------

async function fetchEligibility(
  context: { supabase: any; userId: string },
  tool_slug: string,
): Promise<ReviewEligibility> {
  const { data: orders, error: oErr } = await context.supabase
    .from("tool_orders")
    .select(
      "id, origin, access_type, fulfilment_status, status, cancelled_at, approved_at, paid_at, created_at",
    )
    .eq("user_id", context.userId)
    .eq("tool_slug", tool_slug)
    .order("created_at", { ascending: false });
  if (oErr) throw new Error(oErr.message);

  const qualifying = ((orders ?? []) as any[]).filter((r) =>
    isQualifyingOrder(r as any),
  ) as (QualifyingRow & { status?: string; cancelled_at?: string | null })[];

  const latest = qualifying[0] ?? null;

  const { data: reviewRow } = await (context.supabase.from("tool_reviews") as any)
    .select("*")
    .eq("user_id", context.userId)
    .eq("tool_slug", tool_slug)
    .maybeSingle();
  const review = (reviewRow as MyReview | null) ?? null;

  const gate = deriveReviewGate({
    qualifyingCount: qualifying.length,
    currentVersion: review ? review.version_no : null,
  });

  return {
    tool_slug,
    qualifying_count: qualifying.length,
    latest_qualifying_order_id: latest?.id ?? null,
    latest_qualifying_source: latest ? reviewSourceFor(latest.origin) : null,
    latest_access_type: latest
      ? ((latest.access_type ?? "shared").toLowerCase() as "shared" | "private")
      : null,
    review,
    ...gate,
  };
}

/** Auth — returns the current user's review + eligibility for one tool. */
export const getReviewEligibility = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ tool_slug: z.string().min(1).max(120) }).parse(input),
  )
  .handler(async ({ data, context }) => fetchEligibility(context, data.tool_slug));

/** Auth — returns eligibility for every tool the user has ever bought. */
export const listMyReviewEligibility = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: orders, error } = await context.supabase
      .from("tool_orders")
      .select("tool_slug")
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    const slugs = Array.from(
      new Set(((orders ?? []) as any[]).map((r) => r.tool_slug as string)),
    );
    const items: ReviewEligibility[] = [];
    for (const s of slugs) items.push(await fetchEligibility(context, s));
    return { items };
  });

const submitInput = z.object({
  tool_slug: z.string().min(1).max(120),
  rating: z.number().int().min(1).max(5),
  title: z.string().min(3).max(120),
  body: z.string().min(10).max(2000),
  display_name: z.string().max(60).nullable().optional(),
});

/** Auth — create the first review OR spend a qualifying repurchase to update. */
export const submitReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => submitInput.parse(input))
  .handler(async ({ data, context }) => {
    const safety = checkReviewSafety({
      title: data.title,
      body: data.body,
      display_name: data.display_name ?? null,
    });
    if (!safety.ok) throw new Error(safety.reason ?? "Review rejected.");

    const eligibility = await fetchEligibility(context, data.tool_slug);
    if (!eligibility.canReview && !eligibility.canEdit) {
      throw new Error(
        eligibility.reason ?? "You are not eligible to review this tool right now.",
      );
    }
    if (!eligibility.latest_qualifying_order_id || !eligibility.latest_qualifying_source) {
      throw new Error("A verified purchase is required to review this tool.");
    }

    const now = new Date().toISOString();
    const displayName = data.display_name?.trim() || null;

    if (eligibility.canReview) {
      // First submission.
      const { data: inserted, error } = await (context.supabase.from("tool_reviews") as any)
        .insert({
          user_id: context.userId,
          tool_slug: data.tool_slug,
          rating: data.rating,
          title: data.title.trim(),
          body: data.body.trim(),
          display_name: displayName,
          status: "pending",
          verified_source: eligibility.latest_qualifying_source,
          qualifying_order_id: eligibility.latest_qualifying_order_id,
          submitted_at: now,
          version_no: 1,
        })
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      await (context.supabase.from("tool_review_versions") as any).insert({
        review_id: (inserted as any).id,
        user_id: context.userId,
        tool_slug: data.tool_slug,
        rating: data.rating,
        title: data.title.trim(),
        body: data.body.trim(),
        display_name: displayName,
        status: "pending",
        qualifying_order_id: eligibility.latest_qualifying_order_id,
        version_no: 1,
        submitted_at: now,
      });
      return { ok: true, id: (inserted as any).id, mode: "created" };
    }

    // Update path — snapshot previous version, then rotate.
    const current = eligibility.review!;
    const nextVersion = current.version_no + 1;
    await (context.supabase.from("tool_review_versions") as any).insert({
      review_id: current.id,
      user_id: context.userId,
      tool_slug: data.tool_slug,
      rating: data.rating,
      title: data.title.trim(),
      body: data.body.trim(),
      display_name: displayName,
      status: "pending",
      qualifying_order_id: eligibility.latest_qualifying_order_id,
      version_no: nextVersion,
      submitted_at: now,
    });
    const { error: uErr } = await (context.supabase.from("tool_reviews") as any)
      .update({
        rating: data.rating,
        title: data.title.trim(),
        body: data.body.trim(),
        display_name: displayName,
        status: "pending",
        moderation_note: null,
        verified_source: eligibility.latest_qualifying_source,
        qualifying_order_id: eligibility.latest_qualifying_order_id,
        submitted_at: now,
        version_no: nextVersion,
      })
      .eq("id", current.id)
      .eq("user_id", context.userId);
    if (uErr) throw new Error(uErr.message);
    return { ok: true, id: current.id, mode: "updated" };
  });

// ---------- PUBLIC ----------

async function loadPublicReviewList(
  client: any,
  tool_slug: string,
  limit: number,
): Promise<{ reviews: PublicReview[]; aggregate: RatingAggregate }> {
  // Approved reviews for aggregate (need all rows for the breakdown).
  const { data: allApproved } = await (client.from("tool_reviews") as any)
    .select("id, tool_slug, rating, title, body, display_name, verified_source, submitted_at, qualifying_order_id")
    .eq("tool_slug", tool_slug)
    .eq("status", "approved")
    .order("submitted_at", { ascending: false });

  const rows = (allApproved ?? []) as any[];

  const breakdown: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let sum = 0;
  for (const r of rows) {
    const rat = Math.min(5, Math.max(1, Number(r.rating) || 0)) as 1 | 2 | 3 | 4 | 5;
    breakdown[rat]++;
    sum += Number(r.rating) || 0;
  }
  const total = rows.length;
  const average = total ? Math.round((sum / total) * 10) / 10 : 0;

  const orderIds = rows.map((r) => r.qualifying_order_id).filter(Boolean) as string[];
  const orderMap = new Map<string, string>();
  if (orderIds.length > 0) {
    const { data: orders } = await (client.from("tool_orders") as any)
      .select("id, access_type")
      .in("id", orderIds);
    for (const o of (orders ?? []) as any[]) {
      orderMap.set(o.id as string, (o.access_type as string) ?? "shared");
    }
  }

  const reviews: PublicReview[] = rows.slice(0, limit).map((r) => ({
    id: r.id as string,
    tool_slug: r.tool_slug as string,
    rating: Number(r.rating),
    title: r.title as string,
    body: r.body as string,
    display_name: (r.display_name as string | null) ?? null,
    verified_source: (r.verified_source as ReviewSource) ?? "paystack",
    access_type:
      (orderMap.get(r.qualifying_order_id as string) as "shared" | "private" | undefined) ??
      null,
    submitted_at: r.submitted_at as string,
  }));

  return { reviews, aggregate: { average, total, breakdown } };
}

/** Public — approved reviews + aggregate for one tool. */
export const listPublicReviews = createServerFn({ method: "GET" })
  .inputValidator((input) =>
    z
      .object({ tool_slug: z.string().min(1).max(120), limit: z.number().int().min(1).max(100).optional() })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const client = publicClient();
    return await loadPublicReviewList(client, data.tool_slug, data.limit ?? 50);
  });

// ---------- ADMIN ----------

const adminListInput = z
  .object({
    tool_slug: z.string().min(1).max(120).optional(),
    status: z.enum(["pending", "approved", "rejected", "hidden"]).optional(),
    min_rating: z.number().int().min(1).max(5).optional(),
    limit: z.number().int().min(1).max(500).optional(),
  })
  .optional();

export interface AdminReview extends MyReview {
  user_id: string;
  qualifying_order_id: string | null;
  customer_email: string | null;
  customer_name: string | null;
}

export const adminListReviews = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => adminListInput.parse(input) ?? {})
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    let q = (context.supabase.from("tool_reviews") as any).select("*").order(
      "submitted_at",
      { ascending: false },
    );
    if (data?.tool_slug) q = q.eq("tool_slug", data.tool_slug);
    if (data?.status) q = q.eq("status", data.status);
    if (data?.min_rating) q = q.gte("rating", data.min_rating);
    q = q.limit(data?.limit ?? 200);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    const list = (rows ?? []) as any[];
    const userIds = Array.from(new Set(list.map((r) => r.user_id as string)));
    const emailMap = new Map<string, { email: string | null; name: string | null }>();
    if (userIds.length > 0) {
      const { data: profs } = await context.supabase
        .from("profiles")
        .select("id, email, full_name")
        .in("id", userIds);
      for (const p of (profs ?? []) as any[]) {
        emailMap.set(p.id as string, {
          email: (p.email as string | null) ?? null,
          name: (p.full_name as string | null) ?? null,
        });
      }
    }

    const reviews: AdminReview[] = list.map((r) => {
      const p = emailMap.get(r.user_id as string) ?? { email: null, name: null };
      return {
        id: r.id,
        tool_slug: r.tool_slug,
        rating: r.rating,
        title: r.title,
        body: r.body,
        display_name: r.display_name ?? null,
        status: r.status,
        moderation_note: r.moderation_note ?? null,
        verified_source: r.verified_source,
        version_no: r.version_no,
        submitted_at: r.submitted_at,
        updated_at: r.updated_at,
        user_id: r.user_id,
        qualifying_order_id: r.qualifying_order_id ?? null,
        customer_email: p.email,
        customer_name: p.name,
      };
    });

    return { reviews };
  });

const moderateInput = z.object({
  id: z.string().uuid(),
  status: z.enum(["pending", "approved", "rejected", "hidden"]),
  moderation_note: z.string().max(2000).nullable().optional(),
});

export const adminModerateReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => moderateInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const patch: Record<string, unknown> = { status: data.status };
    if (data.moderation_note !== undefined) patch.moderation_note = data.moderation_note;
    const { error } = await (context.supabase.from("tool_reviews") as any)
      .update(patch)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminListReviewVersions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ review_id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { data: rows, error } = await (context.supabase.from("tool_review_versions") as any)
      .select("*")
      .eq("review_id", data.review_id)
      .order("version_no", { ascending: false });
    if (error) throw new Error(error.message);
    return { versions: (rows ?? []) as any[] };
  });
