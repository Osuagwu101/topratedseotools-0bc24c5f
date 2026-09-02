/**
 * Custom Payments — one-time admin-created payment links.
 *
 * Every link permanently records the gateway selected by the Super Admin.
 * These payments remain isolated from tool_orders, subscriptions and access.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { logAdminActivity } from "@/lib/admin-audit.server";
import {
  customPaymentCurrenciesForGateway,
  customPaymentGatewaySupportsCurrency,
  customPaymentMinorUnits,
  customPaymentRequiresWholeAmount,
  normalizeCustomPaymentCurrency,
  roundCustomPaymentAmount,
  type CustomPaymentGateway,
} from "@/lib/custom-payment-currency";

const SITE_ORIGIN = "https://topratedseotools.com";
const tokenSchema = z
  .string()
  .min(20)
  .max(120)
  .regex(/^[A-Za-z0-9_-]+$/);
const gatewaySchema = z.enum(["paystack", "flutterwave"]);
const currencySchema = z
  .string()
  .trim()
  .transform((v) => v.toUpperCase())
  .refine((v) => /^[A-Z]{3}$/.test(v), "Invalid currency code");

async function assertSuperAdmin(context: { supabase: any; userId: string }) {
  const { data: isAdmin, error: roleError } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (roleError) throw new Error(roleError.message);
  if (!isAdmin) throw new Error("Forbidden");
  const { data: isSuper, error: superError } = await context.supabase.rpc("is_super_admin", {
    _user_id: context.userId,
  });
  if (superError) throw new Error(superError.message);
  if (!isSuper) throw new Error("Only a Super Admin can manage Custom Payments.");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

function computePublicStatus(row: { status: string; expires_at?: string | null }) {
  if (row.status === "paid") return "paid" as const;
  if (row.status === "disabled") return "disabled" as const;
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) return "expired" as const;
  return "active" as const;
}

function parseMetadata(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object") return value as Record<string, unknown>;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return {};
}

function gatewayLabel(gateway: CustomPaymentGateway): string {
  return gateway === "paystack" ? "Paystack" : "Flutterwave";
}

async function loadCustomPaymentGateway(admin: any, gateway: CustomPaymentGateway) {
  const [{ loadGatewaySecrets }, { getAdapter }] = await Promise.all([
    import("@/lib/gateways/secrets.server"),
    import("@/lib/gateways/registry"),
  ]);
  await loadGatewaySecrets(admin, true);

  const { data: provider, error } = await admin
    .from("payment_providers")
    .select("slug, display_name, enabled, environment, config")
    .eq("slug", gateway)
    .maybeSingle();
  if (error) throw new Error(`Could not load ${gatewayLabel(gateway)} configuration.`);
  if (!provider?.enabled)
    throw new Error(`${gatewayLabel(gateway)} is disabled in Payment Settings.`);

  const adapter = getAdapter(gateway, (provider.config ?? {}) as Record<string, unknown>);
  if (!adapter.isConfigured()) throw new Error(`${gatewayLabel(gateway)} is not fully configured.`);
  const environment = adapter.environment() ?? provider.environment;
  if (environment !== "test" && environment !== "live") {
    throw new Error(`${gatewayLabel(gateway)} environment could not be determined.`);
  }
  return { adapter, provider, environment } as const;
}

function validateGatewayCurrency(gateway: CustomPaymentGateway, currency: string) {
  if (!customPaymentGatewaySupportsCurrency(gateway, currency)) {
    if (gateway === "paystack")
      throw new Error("Paystack Custom Payments are charged in NGN only.");
    throw new Error(
      `${currency} is not in the supported Flutterwave Custom Payment currency list.`,
    );
  }
}

function normalizeAmount(amount: number, currency: string): number {
  const rounded = roundCustomPaymentAmount(amount, currency);
  if (customPaymentRequiresWholeAmount(currency) && rounded !== Number(amount)) {
    throw new Error(`${currency} custom payments must use a whole-number amount.`);
  }
  return rounded;
}

export interface CustomPaymentPublicLink {
  title: string;
  description: string | null;
  amount: number;
  currency: string;
  payment_gateway: CustomPaymentGateway;
  recipient_name: string | null;
  recipient_email: string | null;
  status: "active" | "paid" | "disabled" | "expired";
  expires_at: string | null;
  paid_at: string | null;
}

export const adminGetCustomPaymentCurrencyOptions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ gateway: gatewaySchema }).parse(input))
  .handler(async ({ data, context }) => {
    const admin = await assertSuperAdmin(context);
    const gateway = data.gateway as CustomPaymentGateway;
    const { provider, environment } = await loadCustomPaymentGateway(admin, gateway);
    return {
      gateway,
      display_name: gatewayLabel(gateway),
      environment,
      currencies: customPaymentCurrenciesForGateway(gateway),
      provider_enabled: !!provider.enabled,
    };
  });

export const getCustomPaymentLink = createServerFn({ method: "GET" })
  .inputValidator((input) => z.object({ token: tokenSchema }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await (supabaseAdmin as any)
      .from("custom_payment_links")
      .select(
        "title, description, amount, amount_ngn, currency, payment_gateway, recipient_name, recipient_email, status, expires_at, paid_at",
      )
      .eq("public_token", data.token)
      .maybeSingle();
    if (error) throw new Error("Could not load this payment link.");
    if (!row) throw new Error("Payment link not found.");
    const currency = normalizeCustomPaymentCurrency(row.currency ?? "NGN");
    const payment_gateway: CustomPaymentGateway =
      row.payment_gateway === "flutterwave" ? "flutterwave" : "paystack";
    return {
      title: row.title as string,
      description: row.description as string | null,
      amount: Number(row.amount ?? row.amount_ngn),
      currency,
      payment_gateway,
      recipient_name: row.recipient_name as string | null,
      recipient_email: row.recipient_email as string | null,
      status: computePublicStatus(row),
      expires_at: row.expires_at as string | null,
      paid_at: row.paid_at as string | null,
    } satisfies CustomPaymentPublicLink;
  });

export const adminListCustomPaymentLinks = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const admin = await assertSuperAdmin(context);
    const [{ data: links, error: linksError }, { data: transactions, error: txError }] =
      await Promise.all([
        admin
          .from("custom_payment_links")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(200),
        admin
          .from("custom_payment_transactions")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(500),
      ]);
    if (linksError) throw new Error(linksError.message);
    if (txError) throw new Error(txError.message);
    return {
      links: (links ?? []).map((row: any) => ({
        ...row,
        amount: Number(row.amount ?? row.amount_ngn),
        currency: normalizeCustomPaymentCurrency(row.currency ?? "NGN"),
        payment_gateway: row.payment_gateway === "flutterwave" ? "flutterwave" : "paystack",
        public_status: computePublicStatus(row),
        payment_url: `${SITE_ORIGIN}/pay/${row.public_token}`,
      })),
      transactions: (transactions ?? []).map((row: any) => ({
        ...row,
        amount: Number(row.amount ?? row.amount_ngn),
        currency: normalizeCustomPaymentCurrency(row.currency ?? "NGN"),
      })),
    };
  });

export const adminCreateCustomPaymentLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        title: z.string().trim().min(2).max(140),
        description: z.string().trim().max(1000).optional().nullable(),
        amount: z.coerce.number().positive().max(100_000_000),
        currency: currencySchema,
        payment_gateway: gatewaySchema,
        recipient_name: z.string().trim().max(140).optional().nullable(),
        recipient_email: z.string().trim().email().max(254).optional().nullable().or(z.literal("")),
        expires_hours: z.coerce.number().int().min(1).max(720).optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const admin = await assertSuperAdmin(context);
    const gateway = data.payment_gateway as CustomPaymentGateway;
    await loadCustomPaymentGateway(admin, gateway);
    const currency = normalizeCustomPaymentCurrency(data.currency);
    validateGatewayCurrency(gateway, currency);
    const amount = normalizeAmount(data.amount, currency);

    const { randomBytes } = await import("crypto");
    const token = randomBytes(24).toString("base64url");
    const expiresAt = data.expires_hours
      ? new Date(Date.now() + data.expires_hours * 3600_000).toISOString()
      : null;
    const { data: row, error } = await admin
      .from("custom_payment_links")
      .insert({
        public_token: token,
        title: data.title,
        description: data.description || null,
        amount,
        amount_ngn: currency === "NGN" ? amount : null,
        currency,
        payment_gateway: gateway,
        recipient_name: data.recipient_name || null,
        recipient_email: data.recipient_email || null,
        expires_at: expiresAt,
        created_by: context.userId,
      })
      .select("id, public_token, title, amount, currency, payment_gateway, expires_at")
      .maybeSingle();
    if (error || !row) throw new Error(error?.message || "Could not create payment link.");
    await logAdminActivity(context, {
      action: "custom_payment.create",
      area: "payments",
      target_type: "custom_payment_link",
      target_id: row.id as string,
      details: `${data.title} · ${gatewayLabel(gateway)} · ${currency} ${amount}`,
    });
    return {
      id: row.id as string,
      payment_url: `${SITE_ORIGIN}/pay/${row.public_token}`,
      amount: Number(row.amount),
      currency,
      payment_gateway: gateway,
      expires_at: row.expires_at as string | null,
    };
  });

export const adminSetCustomPaymentLinkStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ id: z.string().uuid(), status: z.enum(["active", "disabled"]) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const admin = await assertSuperAdmin(context);
    const { data: current } = await admin
      .from("custom_payment_links")
      .select("id, status, title")
      .eq("id", data.id)
      .maybeSingle();
    if (!current) throw new Error("Payment link not found.");
    if (current.status === "paid")
      throw new Error("A paid payment link cannot be re-opened or disabled.");
    const { error } = await admin
      .from("custom_payment_links")
      .update({ status: data.status, updated_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    await logAdminActivity(context, {
      action: `custom_payment.${data.status}`,
      area: "payments",
      target_type: "custom_payment_link",
      target_id: data.id,
      details: current.title as string,
    });
    return { ok: true };
  });

/**
 * Internal merchant correlation key. Required by Flutterwave (`tx_ref`) and
 * used by us to tie an attempt row to a checkout. It is NEVER proof of payment
 * and is never shown to the customer as a transaction reference.
 */
function newMerchantReference(gateway: CustomPaymentGateway, randomHex: string): string {
  return `CP-${gateway === "paystack" ? "PS" : "FW"}-${Date.now()}-${randomHex}`;
}

export const initializeCustomPayment = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        token: tokenSchema,
        payer_name: z.string().trim().min(2).max(140),
        payer_email: z.string().trim().email().max(254),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any;

    const { data: siteGate } = await admin
      .from("site_settings")
      .select("payments_paused, maintenance_mode")
      .eq("id", true)
      .maybeSingle();
    if (siteGate?.maintenance_mode)
      throw new Error("Payments are temporarily unavailable during maintenance.");
    if (siteGate?.payments_paused)
      throw new Error("Payments are temporarily paused. Please try again later.");

    const { data: link, error: linkError } = await admin
      .from("custom_payment_links")
      .select(
        "id, public_token, title, amount, amount_ngn, currency, payment_gateway, status, expires_at",
      )
      .eq("public_token", data.token)
      .maybeSingle();
    if (linkError || !link) throw new Error("Payment link not found.");
    const status = computePublicStatus(link);
    if (status === "paid") throw new Error("This payment has already been completed.");
    if (status === "disabled") throw new Error("This payment link has been disabled.");
    if (status === "expired")
      throw new Error("This payment link has expired. Contact Admin for a new link.");

    const gateway: CustomPaymentGateway =
      link.payment_gateway === "flutterwave" ? "flutterwave" : "paystack";
    const currency = normalizeCustomPaymentCurrency(link.currency ?? "NGN");
    validateGatewayCurrency(gateway, currency);
    const { adapter, environment } = await loadCustomPaymentGateway(admin, gateway);

    const { randomBytes } = await import("crypto");
    const merchantReference = newMerchantReference(gateway, randomBytes(6).toString("hex"));
    const amount = normalizeAmount(Number(link.amount ?? link.amount_ngn), currency);
    const amountMinor = customPaymentMinorUnits(amount, currency);

    const { error: insertError } = await admin.from("custom_payment_transactions").insert({
      link_id: link.id,
      reference: merchantReference,
      merchant_reference: merchantReference,
      amount,
      amount_ngn: currency === "NGN" ? amount : null,
      currency,
      payer_name: data.payer_name,
      payer_email: data.payer_email,
      payment_gateway: gateway,
      gateway_environment: environment,
      paystack_environment: environment,
      status: "initiated",
    });
    if (insertError) throw new Error("Could not start this payment. Please try again.");

    try {
      const init = await adapter.initialize({
        // Paystack generates its own reference for Custom Payments; for
        // Flutterwave this value is the required merchant `tx_ref`.
        reference: merchantReference,
        gatewayGeneratedReference: gateway === "paystack",
        amountMinor,
        currency,
        email: data.payer_email,
        customerName: data.payer_name,
        description: link.title,
        callbackUrl: `${SITE_ORIGIN}/pay/${data.token}`,
        metadata: {
          kind: "custom_payment",
          custom_payment_link_id: link.id,
          custom_payment_token: data.token,
          merchant_reference: merchantReference,
          title: link.title,
          amount_major: amount,
          currency,
          payment_gateway: gateway,
        },
      });

      // Paystack's returned reference is the authoritative gateway reference.
      const gatewayReference = gateway === "paystack" ? init.reference || null : null;
      if (gateway === "paystack") {
        if (!gatewayReference) throw new Error("Paystack did not return a transaction reference.");
        const { error: refError } = await admin
          .from("custom_payment_transactions")
          .update({ gateway_reference: gatewayReference, updated_at: new Date().toISOString() })
          .eq("link_id", link.id)
          .eq("merchant_reference", merchantReference);
        if (refError) throw new Error("Could not record the gateway reference for this payment.");
      }

      return {
        authorization_url: init.authorization_url,
        payment_gateway: gateway,
        /** Gateway-issued reference (Paystack). Null for Flutterwave until verification. */
        gateway_reference: gatewayReference,
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : `${gatewayLabel(gateway)} initialization failed.`;
      await admin
        .from("custom_payment_transactions")
        .update({
          status: "failed",
          last_error: message.slice(0, 500),
          updated_at: new Date().toISOString(),
        })
        .eq("link_id", link.id)
        .eq("merchant_reference", merchantReference);
      throw new Error(message);
    }
  });

export type CustomPaymentVerifyResult = {
  ok: boolean;
  status: "paid" | "pending" | "failed";
  /** Only ever a gateway-issued identifier — never the merchant correlation key. */
  gateway_identifier: string | null;
  payment_gateway: CustomPaymentGateway;
};

/**
 * Gateway-authoritative verification. Callback query values are only lookup
 * inputs; nothing here trusts `status`, browser state, or local row status.
 */
export const verifyCustomPayment = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        token: tokenSchema,
        /** Paystack-issued reference from the callback. */
        gateway_reference: z.string().trim().min(6).max(160).optional(),
        /** Flutterwave-issued transaction id from the callback. */
        transaction_id: z.coerce.string().trim().min(1).max(80).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<CustomPaymentVerifyResult> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any;
    const { data: link } = await admin
      .from("custom_payment_links")
      .select(
        "id, amount, amount_ngn, currency, payment_gateway, status, paid_reference, paid_gateway_reference, paid_gateway_transaction_id",
      )
      .eq("public_token", data.token)
      .maybeSingle();
    if (!link) throw new Error("Payment link not found.");

    const gateway: CustomPaymentGateway =
      link.payment_gateway === "flutterwave" ? "flutterwave" : "paystack";
    if (link.status === "paid") {
      return {
        ok: true,
        status: "paid",
        gateway_identifier: (link.paid_gateway_transaction_id ??
          link.paid_gateway_reference ??
          null) as string | null,
        payment_gateway: gateway,
      };
    }

    const { adapter } = await loadCustomPaymentGateway(admin, gateway);
    const currency = normalizeCustomPaymentCurrency(link.currency ?? "NGN");
    const amount = normalizeAmount(Number(link.amount ?? link.amount_ngn), currency);
    const expectedMinor = customPaymentMinorUnits(amount, currency);

    const markFailed = async (attemptId: string | null, reason: string) => {
      if (!attemptId) return;
      await admin
        .from("custom_payment_transactions")
        .update({ status: "failed", last_error: reason, updated_at: new Date().toISOString() })
        .eq("id", attemptId);
    };

    let attempt: any = null;
    let tx: Awaited<ReturnType<typeof adapter.verify>>;
    let gatewayReference: string | null = null;
    let gatewayTransactionId: string | null = null;

    if (gateway === "paystack") {
      if (!data.gateway_reference) {
        return { ok: false, status: "pending", gateway_identifier: null, payment_gateway: gateway };
      }
      const { data: row } = await admin
        .from("custom_payment_transactions")
        .select(
          "id, link_id, merchant_reference, reference, gateway_reference, payer_name, payer_email, payment_gateway, status",
        )
        .eq("link_id", link.id)
        .eq("gateway_reference", data.gateway_reference)
        .maybeSingle();
      if (!row) throw new Error("This payment reference does not belong to this bill.");
      if (row.payment_gateway && row.payment_gateway !== gateway)
        throw new Error("Payment gateway did not match this bill.");
      attempt = row;
      tx = await adapter.verify(data.gateway_reference);
      if (tx.status === "failed") {
        await markFailed(attempt.id, "Gateway reported payment failed");
        return { ok: false, status: "failed", gateway_identifier: null, payment_gateway: gateway };
      }
      if (tx.status !== "success") {
        return { ok: false, status: "pending", gateway_identifier: null, payment_gateway: gateway };
      }
      if (tx.reference !== data.gateway_reference)
        throw new Error("Gateway verification reference did not match this bill.");
      gatewayReference = data.gateway_reference;
      gatewayTransactionId = tx.id == null ? null : String(tx.id);
    } else {
      if (!data.transaction_id) {
        return { ok: false, status: "pending", gateway_identifier: null, payment_gateway: gateway };
      }
      if (typeof adapter.verifyByTransactionId !== "function") {
        throw new Error("This gateway cannot verify payments by transaction id.");
      }
      tx = await adapter.verifyByTransactionId(data.transaction_id);
      if (tx.status === "failed")
        return { ok: false, status: "failed", gateway_identifier: null, payment_gateway: gateway };
      if (tx.status !== "success")
        return { ok: false, status: "pending", gateway_identifier: null, payment_gateway: gateway };
      if (tx.id == null || String(tx.id) !== String(data.transaction_id)) {
        throw new Error("Gateway transaction id did not match the verified transaction.");
      }
      const merchantReference = String(tx.reference ?? "");
      if (!merchantReference)
        throw new Error("Gateway verification did not return a merchant correlation key.");
      const { data: row } = await admin
        .from("custom_payment_transactions")
        .select(
          "id, link_id, merchant_reference, reference, payer_name, payer_email, payment_gateway, status",
        )
        .eq("link_id", link.id)
        .eq("merchant_reference", merchantReference)
        .maybeSingle();
      if (!row) throw new Error("This payment does not belong to this bill.");
      if (row.payment_gateway && row.payment_gateway !== gateway)
        throw new Error("Payment gateway did not match this bill.");
      attempt = row;
      gatewayTransactionId = String(tx.id);
    }

    if (
      Number(tx.amount) !== expectedMinor ||
      String(tx.currency ?? "").toUpperCase() !== currency
    ) {
      await markFailed(attempt.id, "Verified amount or currency mismatch");
      throw new Error(
        "Payment verification failed because the amount or currency did not match this bill.",
      );
    }
    const metadata = parseMetadata(tx.metadata);
    if (String(metadata.custom_payment_link_id ?? "") !== String(link.id)) {
      throw new Error("Payment verification metadata did not match this bill.");
    }

    const merchantReference = String(attempt.merchant_reference ?? attempt.reference);
    const paidAt = tx.paid_at ? new Date(tx.paid_at).toISOString() : new Date().toISOString();
    const { data: accepted, error } = await admin.rpc("finalize_custom_payment_v2", {
      _link_id: link.id,
      _merchant_reference: merchantReference,
      _gateway_reference: gatewayReference,
      _gateway_transaction_id: gatewayTransactionId,
      _payer_name: attempt.payer_name ?? null,
      _payer_email: attempt.payer_email,
      _paid_at: paidAt,
    });
    if (error) throw new Error("Payment was verified but could not be recorded. Contact Admin.");
    if (!accepted)
      throw new Error("This bill was already paid through a different transaction. Contact Admin.");
    return {
      ok: true,
      status: "paid",
      gateway_identifier: gatewayReference ?? gatewayTransactionId,
      payment_gateway: gateway,
    };
  });
