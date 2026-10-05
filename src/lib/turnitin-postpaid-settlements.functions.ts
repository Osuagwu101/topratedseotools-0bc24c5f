import { randomBytes } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { resolveActiveGateway, getAdapter } from "@/lib/gateways/registry";
import { loadGatewaySecrets } from "@/lib/gateways/secrets.server";
import {
  isGatewaySlug,
  majorToMinor,
  type GatewayAdapter,
  type GatewaySlug,
} from "@/lib/gateways/types";

const CALLBACK_URL = "https://topratedseotools.com/turnitin/buy";
type AdminClient = any;

type SettlementRow = {
  id: string;
  user_id: string;
  amount_ngn: number;
  allocated_amount_ngn: number;
  method: string;
  status: string;
  payment_gateway: string | null;
  payment_reference: string | null;
  gateway_environment: string | null;
  gateway_reference: string | null;
  gateway_transaction_id: string | null;
  confirmed_at: string | null;
};

function metadataOf(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object") return value as Record<string, unknown>;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object"
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  return {};
}

async function adminClient(): Promise<AdminClient> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

async function assertAdmin(context: { supabase: any; userId: string }) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden");
}

async function assertPostpaidAccount(
  admin: AdminClient,
  userId: string,
): Promise<number> {
  const { data, error } = await admin
    .from("turnitin_account_settings")
    .select("billing_mode, postpaid_rate_ngn")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (data?.billing_mode !== "postpaid") {
    throw new Error("This Turnitin account is not Postpaid.");
  }

  const rate = Number(data.postpaid_rate_ngn ?? 0);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error("This Postpaid account does not have a valid agreed rate.");
  }
  return rate;
}

async function outstandingNgn(admin: AdminClient, userId: string): Promise<number> {
  const { data, error } = await admin
    .from("turnitin_postpaid_charges")
    .select("amount_ngn, paid_amount_ngn, status")
    .eq("user_id", userId)
    .in("status", ["unpaid", "partially_paid"]);

  if (error) throw new Error(error.message);
  return (data ?? []).reduce(
    (sum: number, row: any) =>
      sum +
      Math.max(
        0,
        Number(row.amount_ngn ?? 0) - Number(row.paid_amount_ngn ?? 0),
      ),
    0,
  );
}

async function loadSettlementGateway(
  admin: AdminClient,
  slugRaw: string | null,
): Promise<{
  slug: GatewaySlug;
  adapter: GatewayAdapter;
  environment: "test" | "live" | null;
}> {
  if (!isGatewaySlug(slugRaw)) {
    throw new Error("This Postpaid settlement has no valid payment gateway.");
  }

  await loadGatewaySecrets(admin, true);
  let config: Record<string, unknown> = {};
  const { data: provider } = await admin
    .from("payment_providers")
    .select("config")
    .eq("slug", slugRaw)
    .maybeSingle();

  if (provider?.config && typeof provider.config === "object") {
    config = provider.config as Record<string, unknown>;
  }

  const adapter = getAdapter(slugRaw, config);
  if (!adapter.isConfigured()) {
    throw new Error("The payment provider used for this settlement is not configured.");
  }

  return {
    slug: slugRaw,
    adapter,
    environment: adapter.environment(),
  };
}

function newReference(settlementId: string): string {
  return `TRST-TP-${settlementId.slice(0, 8)}-${Date.now()}-${randomBytes(4).toString("hex")}`;
}

function validateVerifiedSettlement(
  tx: {
    status: string;
    amount: number;
    requested_amount?: number | null;
    currency: string;
    metadata?: Record<string, unknown>;
  },
  settlement: SettlementRow,
) {
  if (tx.status !== "success") {
    throw new Error("This settlement payment has not been confirmed yet.");
  }

  if (String(tx.currency ?? "").toUpperCase() !== "NGN") {
    throw new Error("Postpaid settlement currency verification failed.");
  }

  const expectedMinor = majorToMinor(Number(settlement.amount_ngn));
  const verifiedProductAmount =
    tx.requested_amount == null ? Number(tx.amount) : Number(tx.requested_amount);

  if (verifiedProductAmount < expectedMinor) {
    throw new Error("Postpaid settlement amount is below the required amount.");
  }

  const metadata = metadataOf(tx.metadata);
  if (
    metadata.kind !== "turnitin_postpaid_settlement" ||
    String(metadata.turnitin_settlement_id ?? "") !== settlement.id ||
    String(metadata.user_id ?? "") !== settlement.user_id ||
    Number(metadata.amount_ngn) !== Number(settlement.amount_ngn)
  ) {
    throw new Error("Postpaid settlement metadata verification failed.");
  }
}

async function finalizeSettlement(
  admin: AdminClient,
  settlement: SettlementRow,
  tx: { id?: string | number | null; paid_at?: string | null },
) {
  const { data: allocated, error } = await admin.rpc(
    "turnitin_finalize_postpaid_settlement",
    {
      _settlement_id: settlement.id,
      _reference: String(settlement.payment_reference),
      _gateway_transaction_id:
        tx.id == null ? settlement.gateway_transaction_id : String(tx.id),
      _paid_at: tx.paid_at ?? new Date().toISOString(),
    },
  );
  if (error) throw new Error(error.message);
  return Number(allocated ?? 0);
}

export const initializeTurnitinPostpaidSettlement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      amountNgn: z.coerce.number().int().min(1).max(100_000_000),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const admin = await adminClient();
    await assertPostpaidAccount(admin, context.userId);

    const outstanding = await outstandingNgn(admin, context.userId);
    if (outstanding <= 0) {
      throw new Error("There is no outstanding Postpaid balance to settle.");
    }
    if (data.amountNgn > outstanding) {
      throw new Error("Settlement amount cannot exceed your outstanding balance.");
    }

    const { data: pending } = await admin
      .from("turnitin_postpaid_settlements")
      .select("id")
      .eq("user_id", context.userId)
      .eq("method", "website")
      .eq("status", "pending")
      .maybeSingle();

    if (pending) {
      throw new Error(
        "You already have a Postpaid payment awaiting confirmation. Verify it before starting another.",
      );
    }

    const gateway = await resolveActiveGateway(admin, "NGN");
    if (
      gateway.adapter.chargeCurrencies?.length &&
      !gateway.adapter.chargeCurrencies
        .map((currency) => String(currency).toUpperCase())
        .includes("NGN")
    ) {
      throw new Error(
        `${gateway.adapter.displayName} cannot currently settle Postpaid Turnitin balances in NGN.`,
      );
    }

    const { data: settlement, error: insertError } = await admin
      .from("turnitin_postpaid_settlements")
      .insert({
        user_id: context.userId,
        amount_ngn: data.amountNgn,
        allocated_amount_ngn: 0,
        method: "website",
        status: "pending",
        payment_gateway: gateway.slug,
        gateway_environment: gateway.environment ?? "live",
        note: "Customer online Postpaid settlement",
      })
      .select("id, user_id, amount_ngn")
      .maybeSingle();

    if (insertError || !settlement) {
      throw new Error(insertError?.message ?? "Could not create Postpaid settlement.");
    }

    const reference = newReference(String(settlement.id));
    await admin
      .from("turnitin_postpaid_settlements")
      .update({ payment_reference: reference })
      .eq("id", settlement.id)
      .eq("user_id", context.userId);

    let email =
      typeof context.claims?.email === "string" && context.claims.email
        ? context.claims.email
        : null;
    let customerName =
      typeof (context.claims as { name?: unknown } | undefined)?.name === "string"
        ? String((context.claims as { name?: string }).name)
        : null;

    if (!email || !customerName) {
      const { data: profile } = await admin
        .from("profiles")
        .select("email, full_name")
        .eq("id", context.userId)
        .maybeSingle();
      email = email || profile?.email || `${context.userId}@users.local`;
      customerName = customerName || profile?.full_name || null;
    }

    const metadata = {
      kind: "turnitin_postpaid_settlement",
      turnitin_settlement_id: settlement.id,
      user_id: context.userId,
      amount_ngn: data.amountNgn,
    };

    try {
      const init = await gateway.adapter.initialize({
        reference,
        amountMinor: majorToMinor(data.amountNgn),
        currency: "NGN",
        email: email || `${context.userId}@users.local`,
        callbackUrl: CALLBACK_URL,
        customerName,
        description: "Turnitin Postpaid account settlement",
        metadata,
      });

      const { error: updateError } = await admin
        .from("turnitin_postpaid_settlements")
        .update({
          payment_reference: init.reference,
          gateway_reference: init.gateway_reference,
        })
        .eq("id", settlement.id)
        .eq("user_id", context.userId);

      if (updateError) throw new Error(updateError.message);

      return {
        settlementId: String(settlement.id),
        reference: String(init.reference),
        authorization_url: String(init.authorization_url),
        amountNgn: data.amountNgn,
        outstandingNgn: outstanding,
        gateway: gateway.slug,
        gatewayName: gateway.adapter.displayName,
      };
    } catch (error) {
      await admin
        .from("turnitin_postpaid_settlements")
        .update({
          status: "failed",
          failed_at: new Date().toISOString(),
          note:
            error instanceof Error
              ? `Online settlement initialization failed: ${error.message}`
              : "Online settlement initialization failed.",
        })
        .eq("id", settlement.id)
        .eq("user_id", context.userId);
      throw error;
    }
  });

export const verifyTurnitinPostpaidSettlement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ reference: z.string().trim().min(4).max(220) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const admin = await adminClient();

    const { data: raw, error } = await admin
      .from("turnitin_postpaid_settlements")
      .select(
        "id, user_id, amount_ngn, allocated_amount_ngn, method, status, payment_gateway, payment_reference, gateway_environment, gateway_reference, gateway_transaction_id, confirmed_at",
      )
      .eq("user_id", context.userId)
      .eq("payment_reference", data.reference)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!raw) throw new Error("Postpaid settlement not found.");

    const settlement = raw as SettlementRow;
    if (settlement.status === "confirmed") {
      return {
        ok: true,
        status: "confirmed" as const,
        settlementId: settlement.id,
        amountNgn: Number(settlement.amount_ngn),
        allocatedNgn: Number(settlement.allocated_amount_ngn),
        alreadyConfirmed: true,
      };
    }

    const gateway = await loadSettlementGateway(admin, settlement.payment_gateway);
    if (
      settlement.gateway_environment &&
      gateway.environment &&
      settlement.gateway_environment !== gateway.environment
    ) {
      throw new Error("The payment-provider environment no longer matches this settlement.");
    }

    const tx = await gateway.adapter.verify(data.reference);
    if (tx.status === "pending") {
      return {
        ok: false,
        status: "pending" as const,
        settlementId: settlement.id,
      };
    }

    if (tx.status === "failed") {
      await admin
        .from("turnitin_postpaid_settlements")
        .update({
          status: "failed",
          failed_at: new Date().toISOString(),
        })
        .eq("id", settlement.id)
        .eq("status", "pending");

      return {
        ok: false,
        status: "failed" as const,
        settlementId: settlement.id,
      };
    }

    validateVerifiedSettlement(
      {
        status: tx.status,
        amount: tx.amount,
        requested_amount: tx.requested_amount ?? null,
        currency: tx.currency,
        metadata: metadataOf(tx.metadata),
      },
      settlement,
    );

    const allocatedNgn = await finalizeSettlement(admin, settlement, tx);
    return {
      ok: true,
      status: "confirmed" as const,
      settlementId: settlement.id,
      amountNgn: Number(settlement.amount_ngn),
      allocatedNgn,
      alreadyConfirmed: false,
    };
  });

export const reconcileLatestTurnitinPostpaidSettlement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const admin = await adminClient();

    const { data: raw, error } = await admin
      .from("turnitin_postpaid_settlements")
      .select(
        "id, user_id, amount_ngn, allocated_amount_ngn, method, status, payment_gateway, payment_reference, gateway_environment, gateway_reference, gateway_transaction_id, confirmed_at",
      )
      .eq("user_id", context.userId)
      .eq("method", "website")
      .eq("status", "pending")
      .not("payment_reference", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!raw) return { ok: false, status: "none" as const };

    const settlement = raw as SettlementRow;
    const reference = String(settlement.payment_reference ?? "");
    const gateway = await loadSettlementGateway(admin, settlement.payment_gateway);
    const tx = await gateway.adapter.verify(reference);

    if (tx.status === "pending") {
      return {
        ok: false,
        status: "pending" as const,
        settlementId: settlement.id,
      };
    }

    if (tx.status === "failed") {
      await admin
        .from("turnitin_postpaid_settlements")
        .update({
          status: "failed",
          failed_at: new Date().toISOString(),
        })
        .eq("id", settlement.id)
        .eq("status", "pending");

      return {
        ok: false,
        status: "failed" as const,
        settlementId: settlement.id,
      };
    }

    validateVerifiedSettlement(
      {
        status: tx.status,
        amount: tx.amount,
        requested_amount: tx.requested_amount ?? null,
        currency: tx.currency,
        metadata: metadataOf(tx.metadata),
      },
      settlement,
    );

    const allocatedNgn = await finalizeSettlement(admin, settlement, tx);
    return {
      ok: true,
      status: "confirmed" as const,
      settlementId: settlement.id,
      amountNgn: Number(settlement.amount_ngn),
      allocatedNgn,
    };
  });

const manualInput = z.object({
  userId: z.string().uuid(),
  amountNgn: z.coerce.number().int().min(1).max(100_000_000),
  method: z.enum(["bank_transfer", "whatsapp", "offline", "other"]),
  note: z.string().trim().min(3).max(1000),
});

export const adminRecordTurnitinPostpaidSettlement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => manualInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const admin = await adminClient();

    const { data: settlementId, error } = await admin.rpc(
      "turnitin_record_manual_postpaid_settlement",
      {
        _user_id: data.userId,
        _amount_ngn: data.amountNgn,
        _method: data.method,
        _note: data.note,
        _admin_id: context.userId,
      },
    );

    if (error) {
      const message = String(error.message ?? "");
      if (/EXCEEDS_OUTSTANDING/i.test(message)) {
        throw new Error("Settlement amount cannot exceed the customer's outstanding balance.");
      }
      if (/NOTHING_OUTSTANDING/i.test(message)) {
        throw new Error("This customer has no outstanding Postpaid balance.");
      }
      if (/ONLINE_SETTLEMENT_PENDING/i.test(message)) {
        throw new Error("The customer has an online settlement awaiting confirmation.");
      }
      throw new Error(message || "Could not record Postpaid settlement.");
    }

    const { error: auditError } = await admin.from("customer_admin_audit").insert({
      customer_id: data.userId,
      admin_id: context.userId,
      action: "turnitin_postpaid_settlement_recorded",
      details: {
        settlement_id: settlementId,
        amount_ngn: data.amountNgn,
        method: data.method,
        note: data.note,
      },
    });

    if (auditError) {
      console.warn(
        "[turnitin-postpaid] settlement recorded but customer audit insert failed",
        auditError.message,
      );
    }

    return {
      ok: true as const,
      settlementId: String(settlementId),
      amountNgn: data.amountNgn,
    };
  });

export const adminGetTurnitinPostpaidLedger = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ userId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const admin = await adminClient();

    const [chargesRes, settlementsRes, allocationsRes] = await Promise.all([
      admin
        .from("turnitin_postpaid_charges")
        .select(
          "id, job_id, rate_ngn, amount_ngn, paid_amount_ngn, status, charged_at, voided_at, void_reason",
        )
        .eq("user_id", data.userId)
        .order("charged_at", { ascending: false })
        .limit(200),
      admin
        .from("turnitin_postpaid_settlements")
        .select(
          "id, amount_ngn, allocated_amount_ngn, method, status, payment_gateway, payment_reference, recorded_by, note, confirmed_at, created_at",
        )
        .eq("user_id", data.userId)
        .order("created_at", { ascending: false })
        .limit(200),
      admin
        .from("turnitin_postpaid_allocations")
        .select("id, settlement_id, charge_id, amount_ngn, allocated_at")
        .order("allocated_at", { ascending: false })
        .limit(1000),
    ]);

    if (chargesRes.error) throw new Error(chargesRes.error.message);
    if (settlementsRes.error) throw new Error(settlementsRes.error.message);
    if (allocationsRes.error) throw new Error(allocationsRes.error.message);

    const charges = (chargesRes.data ?? []) as Array<any>;
    const chargeIds = new Set(charges.map((row) => String(row.id)));
    const allocations = (allocationsRes.data ?? []).filter((row: any) =>
      chargeIds.has(String(row.charge_id)),
    );

    const outstandingNgn = charges.reduce((sum, row) => {
      if (row.status === "void") return sum;
      return (
        sum +
        Math.max(
          0,
          Number(row.amount_ngn ?? 0) - Number(row.paid_amount_ngn ?? 0),
        )
      );
    }, 0);

    const paidNgn = charges.reduce(
      (sum, row) => sum + Number(row.paid_amount_ngn ?? 0),
      0,
    );

    return {
      summary: {
        totalCharges: charges.filter((row) => row.status !== "void").length,
        unpaidChecks: charges.filter(
          (row) => row.status === "unpaid" || row.status === "partially_paid",
        ).length,
        outstandingNgn,
        paidNgn,
      },
      charges: charges.map((row) => ({
        id: String(row.id),
        jobId: String(row.job_id),
        rateNgn: Number(row.rate_ngn),
        amountNgn: Number(row.amount_ngn),
        paidAmountNgn: Number(row.paid_amount_ngn),
        status: String(row.status),
        chargedAt: String(row.charged_at),
        voidedAt: row.voided_at ? String(row.voided_at) : null,
        voidReason: row.void_reason ? String(row.void_reason) : null,
      })),
      settlements: (settlementsRes.data ?? []).map((row: any) => ({
        id: String(row.id),
        amountNgn: Number(row.amount_ngn),
        allocatedAmountNgn: Number(row.allocated_amount_ngn),
        method: String(row.method),
        status: String(row.status),
        gateway: row.payment_gateway ? String(row.payment_gateway) : null,
        reference: row.payment_reference ? String(row.payment_reference) : null,
        recordedBy: row.recorded_by ? String(row.recorded_by) : null,
        note: row.note ? String(row.note) : null,
        confirmedAt: row.confirmed_at ? String(row.confirmed_at) : null,
        createdAt: String(row.created_at),
      })),
      allocations: allocations.map((row: any) => ({
        id: String(row.id),
        settlementId: String(row.settlement_id),
        chargeId: String(row.charge_id),
        amountNgn: Number(row.amount_ngn),
        allocatedAt: String(row.allocated_at),
      })),
    };
  });


export const getMyTurnitinPostpaidSettlements = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = context.supabase as any;
    const { data, error } = await db
      .from("turnitin_postpaid_settlements")
      .select(
        "id, amount_ngn, allocated_amount_ngn, method, status, payment_gateway, note, confirmed_at, created_at",
      )
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) throw new Error(error.message);

    return (data ?? []).map((row: any) => ({
      id: String(row.id),
      amountNgn: Number(row.amount_ngn),
      allocatedAmountNgn: Number(row.allocated_amount_ngn),
      method: String(row.method),
      status: String(row.status),
      gateway: row.payment_gateway ? String(row.payment_gateway) : null,
      note: row.note ? String(row.note) : null,
      confirmedAt: row.confirmed_at ? String(row.confirmed_at) : null,
      createdAt: String(row.created_at),
    }));
  });
