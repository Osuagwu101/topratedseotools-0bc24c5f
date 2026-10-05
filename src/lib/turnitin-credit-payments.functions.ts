import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  TURNITIN_CREDIT_MAX_QUANTITY,
  TURNITIN_CREDIT_UNIT_PRICE_NGN,
  turnitinCreditTotalNgn,
} from "@/lib/turnitin-pricing";
import {
  getAdapter,
  resolveActiveGateway,
} from "@/lib/gateways/registry";
import { loadGatewaySecrets } from "@/lib/gateways/secrets.server";
import {
  isGatewaySlug,
  majorToMinor,
  type GatewayAdapter,
  type GatewaySlug,
} from "@/lib/gateways/types";

const TURNITIN_CALLBACK_URL = "https://topratedseotools.com/turnitin/buy";

type AdminClient = any;

type TurnitinPurchaseRow = {
  id: string;
  user_id: string;
  quantity: number;
  unit_amount_ngn: number;
  total_amount_ngn: number;
  status: string;
  payment_gateway: string | null;
  payment_reference: string | null;
  payment_currency: string | null;
  payment_amount: number | null;
  gateway_environment: string | null;
  gateway_reference: string | null;
  gateway_transaction_id: string | null;
  paid_at: string | null;
  expires_at: string | null;
};

function metadataOf(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object") {
    return value as Record<string, unknown>;
  }
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

function newReference(purchaseId: string): string {
  return `TRST-TC-${purchaseId.slice(0, 8)}-${Date.now()}-${randomBytes(4).toString("hex")}`;
}

async function adminClient(): Promise<AdminClient> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

async function assertTurnitinCheckoutOpen(admin: AdminClient): Promise<void> {
  const [{ data: site }, { data: setting }] = await Promise.all([
    admin
      .from("site_settings")
      .select("payments_paused, maintenance_mode")
      .eq("id", true)
      .maybeSingle(),
    admin
      .from("tool_settings")
      .select("enabled")
      .eq("tool_slug", "turnitin")
      .maybeSingle(),
  ]);

  if (site?.maintenance_mode) {
    throw new Error(
      "The site is currently in maintenance mode. Please try again shortly.",
    );
  }
  if (site?.payments_paused) {
    throw new Error(
      "Payments are temporarily paused. Please try again shortly.",
    );
  }
  if (setting?.enabled === false) {
    throw new Error("Turnitin Checks is temporarily unavailable.");
  }
}

async function loadPurchaseGateway(
  admin: AdminClient,
  slugRaw: string | null,
): Promise<{
  slug: GatewaySlug;
  adapter: GatewayAdapter;
  environment: "test" | "live" | null;
}> {
  if (!isGatewaySlug(slugRaw)) {
    throw new Error("This Turnitin credit payment has no valid payment gateway.");
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
    throw new Error(
      "The payment provider used for this purchase is not currently configured.",
    );
  }

  return {
    slug: slugRaw,
    adapter,
    environment: adapter.environment(),
  };
}

function validateVerifiedPayment(
  tx: {
    status: string;
    reference: string;
    amount: number;
    requested_amount?: number | null;
    currency: string;
    metadata?: Record<string, unknown>;
  },
  purchase: TurnitinPurchaseRow,
): void {
  if (tx.status !== "success") {
    throw new Error("This payment has not been confirmed yet.");
  }

  const expectedMinor = majorToMinor(
    turnitinCreditTotalNgn(Number(purchase.quantity)),
  );
  const verifiedProductAmount =
    tx.requested_amount == null ? Number(tx.amount) : Number(tx.requested_amount);
  if (verifiedProductAmount < expectedMinor) {
    throw new Error("Turnitin credit payment amount is below the required purchase amount.");
  }
  if (String(tx.currency ?? "").toUpperCase() !== "NGN") {
    throw new Error("Turnitin credit payment currency verification failed.");
  }

  const metadata = metadataOf(tx.metadata);
  if (
    metadata.kind !== "turnitin_credit_purchase" ||
    String(metadata.turnitin_purchase_id ?? "") !== purchase.id ||
    String(metadata.user_id ?? "") !== purchase.user_id ||
    Number(metadata.quantity) !== Number(purchase.quantity) ||
    Number(metadata.unit_amount_ngn) !== TURNITIN_CREDIT_UNIT_PRICE_NGN
  ) {
    throw new Error("Turnitin credit payment metadata verification failed.");
  }
}

async function finalizeVerifiedPurchase(
  admin: AdminClient,
  purchase: TurnitinPurchaseRow,
  tx: {
    reference: string;
    id?: string | number | null;
    paid_at?: string | null;
  },
): Promise<void> {
  const { error } = await admin.rpc("turnitin_finalize_credit_purchase", {
    _purchase_id: purchase.id,
    _reference: String(purchase.payment_reference),
    _gateway_transaction_id:
      tx.id == null ? purchase.gateway_transaction_id : String(tx.id),
    _paid_at: tx.paid_at ?? new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
}

export const initializeTurnitinCreditPurchase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        quantity: z.coerce
          .number()
          .int()
          .min(1)
          .max(TURNITIN_CREDIT_MAX_QUANTITY),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const admin = await adminClient();
    await assertTurnitinCheckoutOpen(admin);

    const quantity = data.quantity;
    const totalAmount = turnitinCreditTotalNgn(quantity);
    const gateway = await resolveActiveGateway(admin, "NGN");

    if (
      gateway.adapter.chargeCurrencies?.length &&
      !gateway.adapter.chargeCurrencies
        .map((currency) => String(currency).toUpperCase())
        .includes("NGN")
    ) {
      throw new Error(
        `${gateway.adapter.displayName} cannot currently charge Turnitin credits in NGN.`,
      );
    }

    const environment = gateway.environment ?? "live";
    const now = new Date().toISOString();

    const { data: purchase, error: purchaseError } = await admin
      .from("turnitin_credit_purchases")
      .insert({
        user_id: context.userId,
        quantity,
        unit_amount_ngn: TURNITIN_CREDIT_UNIT_PRICE_NGN,
        status: "pending",
        payment_gateway: gateway.slug,
        payment_currency: "NGN",
        payment_amount: totalAmount,
        gateway_environment: environment,
        initiated_at: now,
        metadata: {
          kind: "turnitin_credit_purchase",
          quantity,
          unit_amount_ngn: TURNITIN_CREDIT_UNIT_PRICE_NGN,
        },
      })
      .select("id, user_id, quantity")
      .maybeSingle();

    if (purchaseError || !purchase) {
      throw new Error(
        purchaseError?.message ?? "Could not create the Turnitin credit purchase.",
      );
    }

    const reference = newReference(String(purchase.id));
    const { error: referenceError } = await admin
      .from("turnitin_credit_purchases")
      .update({ payment_reference: reference })
      .eq("id", purchase.id)
      .eq("user_id", context.userId);
    if (referenceError) throw new Error(referenceError.message);

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

    const checkoutEmail = email || `${context.userId}@users.local`;

    const metadata = {
      kind: "turnitin_credit_purchase",
      turnitin_purchase_id: purchase.id,
      user_id: context.userId,
      quantity,
      unit_amount_ngn: TURNITIN_CREDIT_UNIT_PRICE_NGN,
    };

    try {
      const init = await gateway.adapter.initialize({
        reference,
        amountMinor: majorToMinor(totalAmount),
        currency: "NGN",
        email: checkoutEmail,
        callbackUrl: TURNITIN_CALLBACK_URL,
        customerName,
        description: `Turnitin Checks · ${quantity} credit${quantity === 1 ? "" : "s"}`,
        metadata,
      });

      const { error: updateError } = await admin
        .from("turnitin_credit_purchases")
        .update({
          payment_reference: init.reference,
          gateway_reference: init.gateway_reference,
          last_error: null,
        })
        .eq("id", purchase.id)
        .eq("user_id", context.userId);
      if (updateError) throw new Error(updateError.message);

      return {
        purchaseId: String(purchase.id),
        reference: String(init.reference),
        authorization_url: String(init.authorization_url),
        quantity,
        unitAmountNgn: TURNITIN_CREDIT_UNIT_PRICE_NGN,
        totalAmountNgn: totalAmount,
        gateway: gateway.slug,
        gatewayName: gateway.adapter.displayName,
      };
    } catch (error) {
      await admin
        .from("turnitin_credit_purchases")
        .update({
          status: "failed",
          last_error:
            error instanceof Error
              ? error.message
              : "Payment initialization failed.",
        })
        .eq("id", purchase.id)
        .eq("user_id", context.userId);

      throw error;
    }
  });

export const verifyTurnitinCreditPurchase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        reference: z.string().trim().min(4).max(200),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const admin = await adminClient();

    const { data: purchaseRaw, error } = await admin
      .from("turnitin_credit_purchases")
      .select(
        "id, user_id, quantity, unit_amount_ngn, total_amount_ngn, status, payment_gateway, payment_reference, payment_currency, payment_amount, gateway_environment, gateway_reference, gateway_transaction_id, paid_at, expires_at",
      )
      .eq("user_id", context.userId)
      .eq("payment_reference", data.reference)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!purchaseRaw) throw new Error("Turnitin credit purchase not found.");

    const purchase = purchaseRaw as TurnitinPurchaseRow;

    if (purchase.status === "paid") {
      return {
        ok: true,
        status: "paid" as const,
        purchaseId: purchase.id,
        quantity: Number(purchase.quantity),
        expiresAt: purchase.expires_at,
        alreadyPaid: true,
      };
    }

    const gateway = await loadPurchaseGateway(
      admin,
      purchase.payment_gateway,
    );

    if (
      purchase.gateway_environment &&
      gateway.environment &&
      purchase.gateway_environment !== gateway.environment
    ) {
      throw new Error(
        "The payment-provider environment no longer matches this purchase.",
      );
    }

    const tx = await gateway.adapter.verify(data.reference);

    if (tx.status === "pending") {
      return {
        ok: false,
        status: "pending" as const,
        purchaseId: purchase.id,
      };
    }

    if (tx.status === "failed") {
      await admin
        .from("turnitin_credit_purchases")
        .update({
          status: "failed",
          last_error: "Payment provider verification returned failed.",
          verified_at: new Date().toISOString(),
        })
        .eq("id", purchase.id)
        .neq("status", "paid");

      return {
        ok: false,
        status: "failed" as const,
        purchaseId: purchase.id,
      };
    }

    validateVerifiedPayment(
      {
        status: tx.status,
        reference: tx.reference,
        amount: tx.amount,
        requested_amount: tx.requested_amount ?? null,
        currency: tx.currency,
        metadata: metadataOf(tx.metadata),
      },
      purchase,
    );

    await finalizeVerifiedPurchase(admin, purchase, tx);

    const { data: finalized } = await admin
      .from("turnitin_credit_purchases")
      .select("expires_at")
      .eq("id", purchase.id)
      .maybeSingle();

    return {
      ok: true,
      status: "paid" as const,
      purchaseId: purchase.id,
      quantity: Number(purchase.quantity),
      expiresAt: finalized?.expires_at ?? null,
      alreadyPaid: false,
    };
  });


export const reconcileLatestTurnitinCreditPurchase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const admin = await adminClient();

    const { data: purchaseRaw, error } = await admin
      .from("turnitin_credit_purchases")
      .select(
        "id, user_id, quantity, unit_amount_ngn, total_amount_ngn, status, payment_gateway, payment_reference, payment_currency, payment_amount, gateway_environment, gateway_reference, gateway_transaction_id, paid_at, expires_at",
      )
      .eq("user_id", context.userId)
      .eq("status", "pending")
      .not("payment_reference", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!purchaseRaw) {
      return { ok: false, status: "none" as const };
    }

    const purchase = purchaseRaw as TurnitinPurchaseRow;
    const reference = String(purchase.payment_reference ?? "");
    if (!reference) {
      throw new Error("Pending Turnitin purchase has no payment reference.");
    }

    const gateway = await loadPurchaseGateway(admin, purchase.payment_gateway);

    if (
      purchase.gateway_environment &&
      gateway.environment &&
      purchase.gateway_environment !== gateway.environment
    ) {
      throw new Error(
        "The payment-provider environment no longer matches this purchase.",
      );
    }

    const tx = await gateway.adapter.verify(reference);

    if (tx.status === "pending") {
      return {
        ok: false,
        status: "pending" as const,
        purchaseId: purchase.id,
      };
    }

    if (tx.status === "failed") {
      await admin
        .from("turnitin_credit_purchases")
        .update({
          status: "failed",
          last_error: "Payment provider verification returned failed.",
          verified_at: new Date().toISOString(),
        })
        .eq("id", purchase.id)
        .neq("status", "paid");

      return {
        ok: false,
        status: "failed" as const,
        purchaseId: purchase.id,
      };
    }

    validateVerifiedPayment(
      {
        status: tx.status,
        reference: tx.reference,
        amount: tx.amount,
        requested_amount: tx.requested_amount ?? null,
        currency: tx.currency,
        metadata: metadataOf(tx.metadata),
      },
      purchase,
    );

    await finalizeVerifiedPurchase(admin, purchase, tx);

    const { data: finalized } = await admin
      .from("turnitin_credit_purchases")
      .select("expires_at")
      .eq("id", purchase.id)
      .maybeSingle();

    return {
      ok: true,
      status: "paid" as const,
      purchaseId: purchase.id,
      quantity: Number(purchase.quantity),
      expiresAt: finalized?.expires_at ?? null,
    };
  });
