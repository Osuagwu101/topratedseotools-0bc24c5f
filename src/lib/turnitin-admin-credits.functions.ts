import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase.rpc("has_role", {
    _user_id: ctx.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden");
}

const userInput = z.object({
  userId: z.string().uuid(),
});

export interface AdminTurnitinCreditControls {
  customer: {
    id: string;
    email: string | null;
    fullName: string | null;
  };
  summary: {
    availableCredits: number;
    reservedCredits: number;
    consumedCredits: number;
    expiredCredits: number;
    nextExpiryAt: string | null;
    adminGrantCount: number;
  };
  grants: Array<{
    id: string;
    quantity: number;
    expiresAt: string;
    reason: string;
    createdAt: string;
    batchId: string;
    grantedBy: string | null;
    grantedByLabel: string | null;
  }>;
}

export const adminGetTurnitinCreditControls = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => userInput.parse(input))
  .handler(async ({ data, context }): Promise<AdminTurnitinCreditControls> => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any;

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("id, email, full_name")
      .eq("id", data.userId)
      .maybeSingle();

    if (profileError) throw new Error(profileError.message);
    if (!profile) throw new Error("Customer not found.");

    const { error: expireError } = await admin.rpc(
      "turnitin_expire_user_credits",
      { _user_id: data.userId },
    );
    if (expireError) throw new Error(expireError.message);

    const [batchesRes, grantsRes] = await Promise.all([
      admin
        .from("turnitin_credit_batches")
        .select(
          "id, source, granted_credits, available_credits, reserved_credits, consumed_credits, expired_credits, refunded_credits, expires_at, created_at",
        )
        .eq("user_id", data.userId)
        .order("expires_at", { ascending: true }),
      admin
        .from("turnitin_admin_credit_grants")
        .select(
          "id, user_id, batch_id, quantity, expires_at, reason, granted_by, created_at",
          { count: "exact" },
        )
        .eq("user_id", data.userId)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

    if (batchesRes.error) throw new Error(batchesRes.error.message);
    if (grantsRes.error) throw new Error(grantsRes.error.message);

    const batches = (batchesRes.data ?? []) as Array<any>;
    const grants = (grantsRes.data ?? []) as Array<any>;
    const now = Date.now();

    const actorIds = Array.from(
      new Set(
        grants
          .map((g) => g.granted_by as string | null)
          .filter((id): id is string => Boolean(id)),
      ),
    );

    const actorLabels = new Map<string, string>();
    if (actorIds.length > 0) {
      const { data: adminRows } = await admin
        .from("admin_accounts")
        .select("user_id, account_email")
        .in("user_id", actorIds);
      for (const row of adminRows ?? []) {
        if (row.user_id && row.account_email) {
          actorLabels.set(String(row.user_id), String(row.account_email));
        }
      }
    }

    let availableCredits = 0;
    let reservedCredits = 0;
    let consumedCredits = 0;
    let expiredCredits = 0;
    let nextExpiryAt: string | null = null;

    for (const batch of batches) {
      const expiresAt = new Date(batch.expires_at as string).getTime();
      if (expiresAt > now) {
        availableCredits += Number(batch.available_credits ?? 0);
        if (
          Number(batch.available_credits ?? 0) > 0 &&
          (!nextExpiryAt ||
            new Date(batch.expires_at as string).getTime() <
              new Date(nextExpiryAt).getTime())
        ) {
          nextExpiryAt = batch.expires_at as string;
        }
      }
      reservedCredits += Number(batch.reserved_credits ?? 0);
      consumedCredits += Number(batch.consumed_credits ?? 0);
      expiredCredits += Number(batch.expired_credits ?? 0);
    }

    return {
      customer: {
        id: profile.id as string,
        email: (profile.email as string | null) ?? null,
        fullName: (profile.full_name as string | null) ?? null,
      },
      summary: {
        availableCredits,
        reservedCredits,
        consumedCredits,
        expiredCredits,
        nextExpiryAt,
        adminGrantCount: Number(grantsRes.count ?? grants.length),
      },
      grants: grants.map((grant) => ({
        id: grant.id as string,
        quantity: Number(grant.quantity),
        expiresAt: grant.expires_at as string,
        reason: grant.reason as string,
        createdAt: grant.created_at as string,
        batchId: grant.batch_id as string,
        grantedBy: (grant.granted_by as string | null) ?? null,
        grantedByLabel:
          grant.granted_by && actorLabels.has(String(grant.granted_by))
            ? actorLabels.get(String(grant.granted_by)) ?? null
            : null,
      })),
    };
  });

const grantInput = z.object({
  userId: z.string().uuid(),
  quantity: z.number().int().min(1).max(10000),
  expiresAt: z.string().datetime(),
  reason: z.string().trim().min(3).max(1000),
});

export const adminGrantTurnitinCredits = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => grantInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);

    const expiresAt = new Date(data.expiresAt);
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
      throw new Error("Credit expiry must be in the future.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any;

    const { data: grantId, error } = await admin.rpc(
      "turnitin_admin_grant_credits",
      {
        _user_id: data.userId,
        _quantity: data.quantity,
        _expires_at: expiresAt.toISOString(),
        _reason: data.reason,
        _admin_id: context.userId,
      },
    );

    if (error) throw new Error(error.message);
    if (!grantId) throw new Error("Turnitin credits were not granted.");

    const { error: auditError } = await admin
      .from("customer_admin_audit")
      .insert({
        customer_id: data.userId,
        admin_id: context.userId,
        action: "turnitin_credits_granted",
        details: {
          grant_id: grantId,
          quantity: data.quantity,
          expires_at: expiresAt.toISOString(),
          reason: data.reason,
        },
      });

    if (auditError) {
      console.warn(
        "[turnitin-admin-credits] grant succeeded but customer audit insert failed",
        auditError.message,
      );
    }

    return {
      ok: true as const,
      grantId: String(grantId),
      quantity: data.quantity,
      expiresAt: expiresAt.toISOString(),
    };
  });
