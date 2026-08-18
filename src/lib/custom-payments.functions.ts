/**
 * Custom Payments — one-time admin-created Paystack payment links.
 *
 * These payments are deliberately separate from tool_orders so a custom bill
 * can never grant tool access or appear as a subscription. Public recipients
 * do not need a Top Rated SEO Tools account; the unguessable public token is
 * the only identifier exposed to the browser.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { logAdminActivity } from "@/lib/admin-audit.server";
import {
  currencyDisplayName,
  customPaymentMinorUnits,
  merchantPaystackCurrencies,
  merchantSupportsPaystackCurrency,
  normalizePaystackCurrency,
  roundCustomPaymentAmount,
  type PaystackCurrencyOption,
} from "@/lib/custom-payment-currency";

const SITE_ORIGIN = "https://topratedseotools.com";
const PAYSTACK_BASE = "https://api.paystack.co";
const tokenSchema = z.string().min(20).max(120).regex(/^[A-Za-z0-9_-]+$/);
const currencySchema = z.string().trim().transform((v) => v.toUpperCase()).refine((v) => /^[A-Z]{3}$/.test(v), "Invalid currency code");

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
      return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
  return {};
}

async function loadPaystack(admin: any) {
  const { loadGatewaySecrets } = await import("@/lib/gateways/secrets.server");
  await loadGatewaySecrets(admin, true);

  const { data: provider } = await admin
    .from("payment_providers")
    .select("enabled, is_active, environment, config")
    .eq("slug", "paystack")
    .maybeSingle();
  if (!provider?.enabled || !provider?.is_active) {
    throw new Error("Paystack must be the active payment gateway before creating a Custom Payment checkout.");
  }

  const secret = process.env.PAYSTACK_SECRET_KEY ?? "";
  if (!secret) throw new Error("Paystack is not configured. Contact Admin.");
  const environment = secret.startsWith("sk_test_") ? "test" : "live";
  return { secret, environment, config: provider.config ?? {} } as const;
}

async function paystackRequest<T>(secret: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${PAYSTACK_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  let payload: { status?: boolean; message?: string; data?: T } = {};
  try {
    payload = await res.json() as typeof payload;
  } catch {
    throw new Error(`Paystack request failed (${res.status}).`);
  }
  if (!res.ok || !payload.status || payload.data == null) {
    throw new Error(payload.message || `Paystack request failed (${res.status}).`);
  }
  return payload.data;
}

type PaystackCountry = {
  name?: string;
  relationships?: { currency?: { data?: string[] } };
};

/**
 * Paystack /country is global catalogue metadata. It is deliberately used only
 * to enrich the currencies already enabled in this merchant's provider config;
 * it must never be used to decide what this integration is allowed to charge.
 */
async function getPaystackCurrencyOptions(secret: string, merchantCurrencies: string[]): Promise<PaystackCurrencyOption[]> {
  const enabled = new Set(merchantCurrencies.map(normalizePaystackCurrency));
  const countriesByCode = new Map<string, Set<string>>();

  try {
    const countries = await paystackRequest<PaystackCountry[]>(secret, "/country");
    for (const country of countries ?? []) {
      for (const raw of country.relationships?.currency?.data ?? []) {
        let code: string;
        try { code = normalizePaystackCurrency(raw); } catch { continue; }
        if (!enabled.has(code)) continue;
        if (!countriesByCode.has(code)) countriesByCode.set(code, new Set());
        if (country.name) countriesByCode.get(code)!.add(country.name);
      }
    }
  } catch {
    // Country metadata is display-only. Merchant-configured currencies remain
    // authoritative even if Paystack's miscellaneous endpoint is unavailable.
  }

  const priority = ["NGN", "USD", "GHS", "KES", "ZAR", "XOF", "EGP"];
  return merchantCurrencies
    .map(normalizePaystackCurrency)
    .filter((code, index, values) => values.indexOf(code) === index)
    .map((code) => ({
      code,
      name: currencyDisplayName(code),
      countries: [...(countriesByCode.get(code) ?? new Set<string>())].sort(),
    }))
    .sort((a, b) => {
      const ai = priority.indexOf(a.code);
      const bi = priority.indexOf(b.code);
      if (ai !== -1 || bi !== -1) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      return a.code.localeCompare(b.code);
    });
}

function requireMerchantCurrencies(config: unknown): string[] {
  const currencies = merchantPaystackCurrencies(config);
  if (!currencies.length) {
    throw new Error("No Custom Payment currency is configured for this Paystack merchant account.");
  }
  return currencies;
}

export interface CustomPaymentPublicLink {
  title: string;
  description: string | null;
  amount: number;
  currency: string;
  recipient_name: string | null;
  recipient_email: string | null;
  status: "active" | "paid" | "disabled" | "expired";
  expires_at: string | null;
  paid_at: string | null;
}

export const adminGetCustomPaymentCurrencyOptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const admin = await assertSuperAdmin(context);
    const { secret, config } = await loadPaystack(admin);
    const merchantCurrencies = requireMerchantCurrencies(config);
    const currencies = await getPaystackCurrencyOptions(secret, merchantCurrencies);
    return {
      currencies,
      fx_preview_available: false,
      fx_source: "paystack" as const,
      fx_note: "Only currencies enabled on this Paystack merchant account are available. Paystack does not expose a public FX quote endpoint, so Custom Payments do not use third-party exchange rates.",
    };
  });

export const getCustomPaymentLink = createServerFn({ method: "GET" })
  .inputValidator((input) => z.object({ token: tokenSchema }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await (supabaseAdmin as any)
      .from("custom_payment_links")
      .select("title, description, amount, amount_ngn, currency, recipient_name, recipient_email, status, expires_at, paid_at")
      .eq("public_token", data.token)
      .maybeSingle();
    if (error) throw new Error("Could not load this payment link.");
    if (!row) throw new Error("Payment link not found.");
    const currency = normalizePaystackCurrency(row.currency ?? "NGN");
    return {
      title: row.title as string,
      description: row.description as string | null,
      amount: Number(row.amount ?? row.amount_ngn),
      currency,
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
    const [{ data: links, error: linksError }, { data: transactions, error: txError }] = await Promise.all([
      admin.from("custom_payment_links").select("*").order("created_at", { ascending: false }).limit(200),
      admin.from("custom_payment_transactions").select("*").order("created_at", { ascending: false }).limit(500),
    ]);
    if (linksError) throw new Error(linksError.message);
    if (txError) throw new Error(txError.message);
    return {
      links: (links ?? []).map((row: any) => ({
        ...row,
        amount: Number(row.amount ?? row.amount_ngn),
        currency: normalizePaystackCurrency(row.currency ?? "NGN"),
        public_status: computePublicStatus(row),
        payment_url: `${SITE_ORIGIN}/pay/${row.public_token}`,
      })),
      transactions: (transactions ?? []).map((row: any) => ({
        ...row,
        amount: Number(row.amount ?? row.amount_ngn),
        currency: normalizePaystackCurrency(row.currency ?? "NGN"),
      })),
    };
  });

export const adminCreateCustomPaymentLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({
    title: z.string().trim().min(2).max(140),
    description: z.string().trim().max(1000).optional().nullable(),
    amount: z.coerce.number().positive().max(100_000_000),
    currency: currencySchema,
    recipient_name: z.string().trim().max(140).optional().nullable(),
    recipient_email: z.string().trim().email().max(254).optional().nullable().or(z.literal("")),
    expires_hours: z.coerce.number().int().min(1).max(720).optional().nullable(),
  }).parse(input))
  .handler(async ({ data, context }) => {
    const admin = await assertSuperAdmin(context);
    const { config } = await loadPaystack(admin);
    requireMerchantCurrencies(config);
    const currency = normalizePaystackCurrency(data.currency);
    if (!merchantSupportsPaystackCurrency(config, currency)) {
      throw new Error(`${currency} is not enabled on this Paystack merchant account.`);
    }
    const amount = roundCustomPaymentAmount(data.amount, currency);
    if (currency === "XOF" && amount !== Number(data.amount)) {
      throw new Error("XOF custom payments must use a whole-number amount.");
    }

    const { randomBytes } = await import("crypto");
    const token = randomBytes(24).toString("base64url");
    const expiresAt = data.expires_hours ? new Date(Date.now() + data.expires_hours * 3600_000).toISOString() : null;
    const { data: row, error } = await admin
      .from("custom_payment_links")
      .insert({
        public_token: token,
        title: data.title,
        description: data.description || null,
        amount,
        amount_ngn: currency === "NGN" ? amount : null,
        currency,
        recipient_name: data.recipient_name || null,
        recipient_email: data.recipient_email || null,
        expires_at: expiresAt,
        created_by: context.userId,
      })
      .select("id, public_token, title, amount, currency, expires_at")
      .maybeSingle();
    if (error || !row) throw new Error(error?.message || "Could not create payment link.");
    await logAdminActivity(context, {
      action: "custom_payment.create",
      area: "payments",
      target_type: "custom_payment_link",
      target_id: row.id as string,
      details: `${data.title} · ${currency} ${Number(row.amount).toFixed(currency === "XOF" ? 0 : 2)}`,
    });
    return {
      id: row.id as string,
      payment_url: `${SITE_ORIGIN}/pay/${row.public_token}`,
      amount: Number(row.amount),
      currency,
      expires_at: row.expires_at as string | null,
    };
  });

export const adminSetCustomPaymentLinkStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid(), status: z.enum(["active", "disabled"]) }).parse(input))
  .handler(async ({ data, context }) => {
    const admin = await assertSuperAdmin(context);
    const { data: current } = await admin.from("custom_payment_links").select("id, status, title").eq("id", data.id).maybeSingle();
    if (!current) throw new Error("Payment link not found.");
    if (current.status === "paid") throw new Error("A paid payment link cannot be re-opened or disabled.");
    const { error } = await admin.from("custom_payment_links").update({ status: data.status, updated_at: new Date().toISOString() }).eq("id", data.id);
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

export const initializeCustomPayment = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({
    token: tokenSchema,
    payer_name: z.string().trim().min(2).max(140),
    payer_email: z.string().trim().email().max(254),
  }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any;

    const { data: siteGate } = await admin.from("site_settings").select("payments_paused, maintenance_mode").eq("id", true).maybeSingle();
    if (siteGate?.maintenance_mode) throw new Error("Payments are temporarily unavailable during maintenance.");
    if (siteGate?.payments_paused) throw new Error("Payments are temporarily paused. Please try again later.");

    const { data: link, error: linkError } = await admin
      .from("custom_payment_links")
      .select("id, public_token, title, amount, amount_ngn, currency, status, expires_at")
      .eq("public_token", data.token)
      .maybeSingle();
    if (linkError || !link) throw new Error("Payment link not found.");
    const status = computePublicStatus(link);
    if (status === "paid") throw new Error("This payment has already been completed.");
    if (status === "disabled") throw new Error("This payment link has been disabled.");
    if (status === "expired") throw new Error("This payment link has expired. Contact Admin for a new link.");

    const { secret, environment, config } = await loadPaystack(admin);
    requireMerchantCurrencies(config);
    const currency = normalizePaystackCurrency(link.currency ?? "NGN");
    if (!merchantSupportsPaystackCurrency(config, currency)) {
      throw new Error(`${currency} is not enabled on this Paystack merchant account. Please ask the sender for a new payment link in an enabled currency.`);
    }

    const { randomBytes } = await import("crypto");
    const reference = `CP-${Date.now()}-${randomBytes(6).toString("hex")}`;
    const amount = roundCustomPaymentAmount(Number(link.amount ?? link.amount_ngn), currency);
    const amountMinor = customPaymentMinorUnits(amount, currency);

    const { error: insertError } = await admin.from("custom_payment_transactions").insert({
      link_id: link.id,
      reference,
      amount,
      amount_ngn: currency === "NGN" ? amount : null,
      currency,
      payer_name: data.payer_name,
      payer_email: data.payer_email,
      payment_gateway: "paystack",
      paystack_environment: environment,
      status: "initiated",
    });
    if (insertError) throw new Error("Could not start this payment. Please try again.");

    try {
      const init = await paystackRequest<{ authorization_url: string; access_code: string; reference: string }>(secret, "/transaction/initialize", {
        method: "POST",
        body: JSON.stringify({
          email: data.payer_email,
          amount: String(amountMinor),
          currency,
          reference,
          callback_url: `${SITE_ORIGIN}/pay/${data.token}`,
          metadata: JSON.stringify({
            kind: "custom_payment",
            custom_payment_link_id: link.id,
            custom_payment_token: data.token,
            title: link.title,
            amount_major: amount,
            currency,
          }),
        }),
      });
      return { authorization_url: init.authorization_url, reference: init.reference || reference };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Paystack initialization failed.";
      await admin.from("custom_payment_transactions").update({ status: "failed", last_error: message.slice(0, 500), updated_at: new Date().toISOString() }).eq("reference", reference);
      if (/currency/i.test(message)) {
        throw new Error(`${message} This Paystack business may not be enabled to accept ${currency}.`);
      }
      throw new Error(message);
    }
  });

export const verifyCustomPayment = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ token: tokenSchema, reference: z.string().min(8).max(120) }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any;
    const { data: link } = await admin
      .from("custom_payment_links")
      .select("id, amount, amount_ngn, currency, status, paid_reference")
      .eq("public_token", data.token)
      .maybeSingle();
    if (!link) throw new Error("Payment link not found.");
    if (link.status === "paid" && link.paid_reference === data.reference) return { ok: true, status: "paid" as const };

    const { data: attempt } = await admin
      .from("custom_payment_transactions")
      .select("id, link_id, reference, payer_name, payer_email, amount, amount_ngn, currency, status")
      .eq("reference", data.reference)
      .eq("link_id", link.id)
      .maybeSingle();
    if (!attempt) throw new Error("Payment reference does not belong to this link.");

    const { secret } = await loadPaystack(admin);
    const tx = await paystackRequest<any>(secret, `/transaction/verify/${encodeURIComponent(data.reference)}`);
    if (String(tx.status).toLowerCase() !== "success") throw new Error("Payment is not yet confirmed.");

    const currency = normalizePaystackCurrency(link.currency ?? "NGN");
    const amount = roundCustomPaymentAmount(Number(link.amount ?? link.amount_ngn), currency);
    const expectedMinor = customPaymentMinorUnits(amount, currency);
    if (Number(tx.amount) !== expectedMinor || String(tx.currency ?? "").toUpperCase() !== currency) {
      await admin.from("custom_payment_transactions").update({ status: "failed", last_error: "Verified amount or currency mismatch", updated_at: new Date().toISOString() }).eq("reference", data.reference);
      throw new Error("Payment verification failed because the amount or currency did not match this bill.");
    }
    const metadata = parseMetadata(tx.metadata);
    if (String(metadata.custom_payment_link_id ?? "") !== String(link.id)) throw new Error("Payment verification metadata did not match this bill.");

    const paidAt = tx.paid_at ? new Date(tx.paid_at).toISOString() : new Date().toISOString();
    const { data: accepted, error } = await admin.rpc("finalize_custom_payment", {
      _link_id: link.id,
      _reference: data.reference,
      _gateway_transaction_id: tx.id == null ? null : String(tx.id),
      _payer_name: attempt.payer_name ?? null,
      _payer_email: attempt.payer_email,
      _paid_at: paidAt,
    });
    if (error) throw new Error("Payment was verified but could not be recorded. Contact Admin with the reference.");
    if (!accepted) throw new Error("This bill was already paid using a different reference. Contact Admin.");
    return { ok: true, status: "paid" as const };
  });
