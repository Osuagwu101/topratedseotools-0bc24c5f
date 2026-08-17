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

const SITE_ORIGIN = "https://topratedseotools.com";
const PAYSTACK_BASE = "https://api.paystack.co";
const tokenSchema = z.string().min(20).max(120).regex(/^[A-Za-z0-9_-]+$/);

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
    .select("enabled, is_active, environment")
    .eq("slug", "paystack")
    .maybeSingle();
  if (!provider?.enabled || !provider?.is_active) {
    throw new Error("Paystack must be the active payment gateway before creating a Custom Payment checkout.");
  }

  const secret = process.env.PAYSTACK_SECRET_KEY ?? "";
  if (!secret) throw new Error("Paystack is not configured. Contact Admin.");
  const environment = secret.startsWith("sk_test_") ? "test" : "live";
  return { secret, environment } as const;
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
  if (!res.ok || !payload.status || !payload.data) {
    throw new Error(payload.message || `Paystack request failed (${res.status}).`);
  }
  return payload.data;
}

export interface CustomPaymentPublicLink {
  title: string;
  description: string | null;
  amount_ngn: number;
  currency: "NGN";
  recipient_name: string | null;
  recipient_email: string | null;
  status: "active" | "paid" | "disabled" | "expired";
  expires_at: string | null;
  paid_at: string | null;
}

export const getCustomPaymentLink = createServerFn({ method: "GET" })
  .inputValidator((input) => z.object({ token: tokenSchema }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await (supabaseAdmin as any)
      .from("custom_payment_links")
      .select("title, description, amount_ngn, currency, recipient_name, recipient_email, status, expires_at, paid_at")
      .eq("public_token", data.token)
      .maybeSingle();
    if (error) throw new Error("Could not load this payment link.");
    if (!row) throw new Error("Payment link not found.");
    return {
      title: row.title as string,
      description: row.description as string | null,
      amount_ngn: Number(row.amount_ngn),
      currency: "NGN" as const,
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
        amount_ngn: Number(row.amount_ngn),
        public_status: computePublicStatus(row),
        payment_url: `${SITE_ORIGIN}/pay/${row.public_token}`,
      })),
      transactions: (transactions ?? []).map((row: any) => ({ ...row, amount_ngn: Number(row.amount_ngn) })),
    };
  });

export const adminCreateCustomPaymentLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      title: z.string().trim().min(2).max(140),
      description: z.string().trim().max(1000).optional().nullable(),
      amount_ngn: z.coerce.number().positive().max(100_000_000),
      recipient_name: z.string().trim().max(140).optional().nullable(),
      recipient_email: z.string().trim().email().max(254).optional().nullable().or(z.literal("")),
      expires_hours: z.coerce.number().int().min(1).max(720).optional().nullable(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const admin = await assertSuperAdmin(context);
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
        amount_ngn: Math.round(data.amount_ngn * 100) / 100,
        currency: "NGN",
        recipient_name: data.recipient_name || null,
        recipient_email: data.recipient_email || null,
        expires_at: expiresAt,
        created_by: context.userId,
      })
      .select("id, public_token, title, amount_ngn, expires_at")
      .maybeSingle();
    if (error || !row) throw new Error(error?.message || "Could not create payment link.");
    await logAdminActivity(context, {
      action: "custom_payment.create",
      area: "payments",
      target_type: "custom_payment_link",
      target_id: row.id as string,
      details: `${data.title} · NGN ${Number(row.amount_ngn).toFixed(2)}`,
    });
    return {
      id: row.id as string,
      payment_url: `${SITE_ORIGIN}/pay/${row.public_token}`,
      amount_ngn: Number(row.amount_ngn),
      expires_at: row.expires_at as string | null,
    };
  });

export const adminSetCustomPaymentLinkStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid(), status: z.enum(["active", "disabled"]) }).parse(input))
  .handler(async ({ data, context }) => {
    const admin = await assertSuperAdmin(context);
    const { data: current } = await admin
      .from("custom_payment_links")
      .select("id, status, title")
      .eq("id", data.id)
      .maybeSingle();
    if (!current) throw new Error("Payment link not found.");
    if (current.status === "paid") throw new Error("A paid payment link cannot be re-opened or disabled.");
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

export const initializeCustomPayment = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({
    token: tokenSchema,
    payer_name: z.string().trim().min(2).max(140),
    payer_email: z.string().trim().email().max(254),
  }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any;

    const { data: siteGate } = await admin
      .from("site_settings")
      .select("payments_paused, maintenance_mode")
      .eq("id", true)
      .maybeSingle();
    if (siteGate?.maintenance_mode) throw new Error("Payments are temporarily unavailable during maintenance.");
    if (siteGate?.payments_paused) throw new Error("Payments are temporarily paused. Please try again later.");

    const { data: link, error: linkError } = await admin
      .from("custom_payment_links")
      .select("id, public_token, title, amount_ngn, currency, status, expires_at")
      .eq("public_token", data.token)
      .maybeSingle();
    if (linkError || !link) throw new Error("Payment link not found.");
    const status = computePublicStatus(link);
    if (status === "paid") throw new Error("This payment has already been completed.");
    if (status === "disabled") throw new Error("This payment link has been disabled.");
    if (status === "expired") throw new Error("This payment link has expired. Contact Admin for a new link.");

    const { secret, environment } = await loadPaystack(admin);
    const { randomBytes } = await import("crypto");
    const reference = `CP-${Date.now()}-${randomBytes(6).toString("hex")}`;
    const amountNgn = Number(link.amount_ngn);
    const amountMinor = Math.round(amountNgn * 100);

    const { error: insertError } = await admin.from("custom_payment_transactions").insert({
      link_id: link.id,
      reference,
      amount_ngn: amountNgn,
      currency: "NGN",
      payer_name: data.payer_name,
      payer_email: data.payer_email,
      payment_gateway: "paystack",
      paystack_environment: environment,
      status: "initiated",
    });
    if (insertError) throw new Error("Could not start this payment. Please try again.");

    try {
      const init = await paystackRequest<{ authorization_url: string; access_code: string; reference: string }>(
        secret,
        "/transaction/initialize",
        {
          method: "POST",
          body: JSON.stringify({
            email: data.payer_email,
            amount: String(amountMinor),
            currency: "NGN",
            reference,
            callback_url: `${SITE_ORIGIN}/pay/${data.token}`,
            metadata: JSON.stringify({
              kind: "custom_payment",
              custom_payment_link_id: link.id,
              custom_payment_token: data.token,
              title: link.title,
            }),
          }),
        },
      );
      return { authorization_url: init.authorization_url, reference: init.reference || reference };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Paystack initialization failed.";
      await admin
        .from("custom_payment_transactions")
        .update({ status: "failed", last_error: message.slice(0, 500), updated_at: new Date().toISOString() })
        .eq("reference", reference);
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
      .select("id, amount_ngn, currency, status, paid_reference")
      .eq("public_token", data.token)
      .maybeSingle();
    if (!link) throw new Error("Payment link not found.");
    if (link.status === "paid" && link.paid_reference === data.reference) {
      return { ok: true, status: "paid" as const };
    }

    const { data: attempt } = await admin
      .from("custom_payment_transactions")
      .select("id, link_id, reference, payer_name, payer_email, amount_ngn, currency, status")
      .eq("reference", data.reference)
      .eq("link_id", link.id)
      .maybeSingle();
    if (!attempt) throw new Error("Payment reference does not belong to this link.");

    const { secret } = await loadPaystack(admin);
    const tx = await paystackRequest<any>(secret, `/transaction/verify/${encodeURIComponent(data.reference)}`);
    if (String(tx.status).toLowerCase() !== "success") {
      throw new Error("Payment is not yet confirmed.");
    }
    const expectedMinor = Math.round(Number(link.amount_ngn) * 100);
    if (Number(tx.amount) !== expectedMinor || String(tx.currency ?? "").toUpperCase() !== "NGN") {
      await admin
        .from("custom_payment_transactions")
        .update({ status: "failed", last_error: "Verified amount or currency mismatch", updated_at: new Date().toISOString() })
        .eq("reference", data.reference);
      throw new Error("Payment verification failed because the amount did not match this bill.");
    }
    const metadata = parseMetadata(tx.metadata);
    if (String(metadata.custom_payment_link_id ?? "") !== String(link.id)) {
      throw new Error("Payment verification metadata did not match this bill.");
    }

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
