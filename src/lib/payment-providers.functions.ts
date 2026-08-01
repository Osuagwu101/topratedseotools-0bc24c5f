/**
 * Payment providers — server functions.
 *
 * Admin can add, edit, enable/disable, activate, and test payment
 * providers from the dashboard without code changes. Secret keys are NOT
 * stored in this table (they live in encrypted secret storage) — this table
 * stores public keys, environment, non-secret config (e.g. Monnify contract
 * code), enabled/active flags and the last connection-test result.
 *
 * Only a Super Admin may change gateway settings.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { logAdminActivity } from "@/lib/admin-audit.server";
import { loadGatewaySecrets, missingSecrets, isGatewaySecretName } from "@/lib/gateways/secrets.server";

async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase.rpc("has_role", {
    _user_id: ctx.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

/** Gateway settings are Super-Admin-only (money movement). */
async function assertSuperAdmin(ctx: { supabase: any; userId: string }) {
  const admin = await assertAdmin(ctx);
  const { data, error } = await ctx.supabase.rpc("is_super_admin", { _user_id: ctx.userId });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Only a Super Admin can change payment gateway settings.");
  return admin;
}

export interface PaymentProviderRow {
  id: string;
  slug: string;
  display_name: string;
  environment: "test" | "live";
  public_key: string | null;
  enabled: boolean;
  is_active: boolean;
  webhook_secret_hint: string | null;
  config: Record<string, string | number | boolean | null>;
  last_test_at: string | null;
  last_test_status: string | null;
  last_test_message: string | null;
  updated_at: string;
  has_secret_configured: boolean; // computed
  missing_secrets: string[]; // computed
  webhook_url: string | null; // computed
  supports_recurring: boolean; // computed
  configured_secrets?: string[]; // computed — names only, never values
}

const KNOWN: Record<
  string,
  {
    display_name: string;
    secret_env: string;
    /** Every secret/credential the gateway needs before it can be activated. */
    required_env: string[];
    supports_recurring: boolean;
    webhook_path: string;
    /** Non-secret config fields the admin fills in here. */
    config_fields: { key: string; label: string; required: boolean }[];
    /**
     * Credentials the admin can enter securely from the dashboard. Values are
     * written to encrypted server-side storage and never returned to the UI.
     */
    secret_fields: { name: string; label: string; required: boolean }[];
  }
> = {
  paystack: {
    display_name: "Paystack",
    secret_env: "PAYSTACK_SECRET_KEY",
    required_env: ["PAYSTACK_SECRET_KEY"],
    supports_recurring: true,
    webhook_path: "/api/public/webhooks/paystack",
    config_fields: [],
    secret_fields: [{ name: "PAYSTACK_SECRET_KEY", label: "Secret key", required: true }],
  },
  flutterwave: {
    display_name: "Flutterwave",
    secret_env: "FLUTTERWAVE_SECRET_KEY",
    required_env: ["FLUTTERWAVE_SECRET_KEY", "FLUTTERWAVE_WEBHOOK_HASH"],
    supports_recurring: false,
    webhook_path: "/api/public/webhooks/flutterwave",
    config_fields: [],
    secret_fields: [
      { name: "FLUTTERWAVE_SECRET_KEY", label: "Secret key", required: true },
      { name: "FLUTTERWAVE_PUBLIC_KEY", label: "Public key", required: false },
      { name: "FLUTTERWAVE_ENCRYPTION_KEY", label: "Encryption key", required: false },
      { name: "FLUTTERWAVE_WEBHOOK_HASH", label: "Webhook secret hash (verif-hash)", required: true },
    ],
  },
  monnify: {
    display_name: "Monnify",
    secret_env: "MONNIFY_SECRET_KEY",
    required_env: ["MONNIFY_API_KEY", "MONNIFY_SECRET_KEY"],
    supports_recurring: false,
    webhook_path: "/api/public/webhooks/monnify",
    config_fields: [
      { key: "contract_code", label: "Contract Code", required: true },
      { key: "base_url", label: "API Base URL", required: false },
    ],
    secret_fields: [
      { name: "MONNIFY_API_KEY", label: "API key", required: true },
      { name: "MONNIFY_SECRET_KEY", label: "Secret key", required: true },
    ],
  },
};

const SITE_ORIGIN = "https://topratedseotools.com";

export const adminListPaymentProviders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const admin = await assertAdmin(context);
    await loadGatewaySecrets(admin, true);
    const { data, error } = await admin
      .from("payment_providers")
      .select("*")
      .order("display_name", { ascending: true });
    if (error) throw new Error(error.message);
    const { data: isSuper } = await context.supabase.rpc("is_super_admin", {
      _user_id: context.userId,
    });
    const rows: PaymentProviderRow[] = (data ?? []).map((r: any) => {
      const known = KNOWN[r.slug];
      const hasSecret = known?.secret_env ? missingSecrets([known.secret_env]).length === 0 : false;
      const missing = missingSecrets(known?.required_env ?? []);
      const configured_secrets = (known?.secret_fields ?? [])
        .filter((f) => missingSecrets([f.name]).length === 0)
        .map((f) => f.name);
      const cfg = (r.config ?? {}) as Record<string, unknown>;
      // Monnify also needs its contract code before it can be activated.
      for (const f of known?.config_fields ?? []) {
        if (f.required && !cfg[f.key]) missing.push(f.label);
      }
      return {
        ...r,
        has_secret_configured: hasSecret,
        missing_secrets: missing,
        configured_secrets,
        webhook_url: known ? `${SITE_ORIGIN}${known.webhook_path}` : null,
        supports_recurring: known?.supports_recurring ?? false,
      } as PaymentProviderRow;
    });
    const catalog = Object.entries(KNOWN).map(([slug, meta]) => ({
      slug,
      display_name: meta.display_name,
      secret_env: meta.secret_env,
      required_env: meta.required_env,
      supports_recurring: meta.supports_recurring,
      config_fields: meta.config_fields,
      secret_fields: meta.secret_fields,
      webhook_url: `${SITE_ORIGIN}${meta.webhook_path}`,
    }));
    return { providers: rows, catalog, is_super_admin: !!isSuper };
  });

export const adminUpsertPaymentProvider = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid().optional(),
        slug: z.string().min(2).max(60),
        display_name: z.string().min(1).max(100),
        environment: z.enum(["test", "live"]),
        public_key: z.string().max(400).optional().nullable(),
        webhook_secret_hint: z.string().max(120).optional().nullable(),
        enabled: z.boolean().optional(),
        /** Non-secret gateway config (e.g. Monnify contract code). */
        config: z.record(z.string(), z.string().max(200).nullable()).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const admin = await assertSuperAdmin(context);
    await loadGatewaySecrets(admin, true);
    const { data: existingRow } = await admin
      .from("payment_providers")
      .select("id, config")
      .eq("slug", data.slug)
      .maybeSingle();
    const mergedConfig = {
      ...(((existingRow as { config?: Record<string, unknown> } | null)?.config ?? {}) as Record<string, unknown>),
      ...(data.config ?? {}),
    };

    // A gateway can only be enabled for checkout once its credentials exist and
    // the gateway itself accepts them.
    if (data.enabled) {
      const known = KNOWN[data.slug];
      if (known) {
        const missing = missingSecrets(known.required_env);
        for (const f of known.config_fields) {
          if (f.required && !mergedConfig[f.key]) missing.push(f.label);
        }
        if (missing.length) {
          throw new Error(`Cannot enable ${known.display_name} — missing: ${missing.join(", ")}.`);
        }
        const test = await runConnectionTest({ slug: data.slug, config: mergedConfig });
        if (!test.ok) {
          throw new Error(
            `Cannot enable ${known.display_name} — credential check failed: ${test.message}`,
          );
        }
      }
    }

    const patch = {
      slug: data.slug,
      display_name: data.display_name,
      environment: data.environment,
      public_key: data.public_key ?? null,
      webhook_secret_hint: data.webhook_secret_hint ?? null,
      enabled: data.enabled ?? false,
      config: mergedConfig,
    };
    let row: any;
    if (data.id) {
      const { data: updated, error } = await admin
        .from("payment_providers")
        .update(patch)
        .eq("id", data.id)
        .select("*")
        .maybeSingle();
      if (error) throw new Error(error.message);
      row = updated;
    } else {
      const { data: inserted, error } = await admin
        .from("payment_providers")
        .upsert(patch, { onConflict: "slug" })
        .select("*")
        .maybeSingle();
      if (error) throw new Error(error.message);
      row = inserted;
    }
    await logAdminActivity(context, {
      action: "payment_provider.upsert",
      area: "payments",
      target_type: "payment_provider",
      target_id: row?.id ?? data.slug,
      details: `${data.slug} · ${data.environment} · enabled=${data.enabled ?? false}`,
    });
    return { ok: true, provider: row };
  });

export const adminSetActiveProvider = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const admin = await assertSuperAdmin(context);
    await loadGatewaySecrets(admin, true);
    const { data: target } = await admin
      .from("payment_providers")
      .select("id, slug, config")
      .eq("id", data.id)
      .maybeSingle();
    if (!target) throw new Error("Provider not found");

    // Never make a half-configured gateway live — customers would be stranded.
    const known = KNOWN[target.slug as string];
    if (known) {
      const missing = missingSecrets(known.required_env);
      const cfg = (target.config ?? {}) as Record<string, unknown>;
      for (const f of known.config_fields) {
        if (f.required && !cfg[f.key]) missing.push(f.label);
      }
      if (missing.length) {
        throw new Error(`Cannot activate ${known.display_name} — missing: ${missing.join(", ")}.`);
      }
      // Never activate on credentials the gateway itself rejects.
      const test = await runConnectionTest(target);
      await recordTestResult(admin, data.id, test);
      if (!test.ok) {
        throw new Error(
          `Cannot activate ${known.display_name} — credential check failed: ${test.message}`,
        );
      }
    }

    // clear existing active, then set new
    await admin.from("payment_providers").update({ is_active: false }).eq("is_active", true);
    const { error } = await admin
      .from("payment_providers")
      .update({ is_active: true, enabled: true })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    await logAdminActivity(context, {
      action: "payment_provider.set_active",
      area: "payments",
      target_type: "payment_provider",
      target_id: data.id,
      details: target.slug as string,
    });
    return { ok: true };
  });

/**
 * Live credential validation against the gateway's own API. Shared by the
 * "Test" button, credential saving and activation, so a gateway can never go
 * live with invalid keys.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runConnectionTest(p: any): Promise<{ ok: boolean; message: string }> {
  let ok = false;
  let msg = "";
  try {
    if (p.slug === "paystack") {
      const secret = process.env.PAYSTACK_SECRET_KEY;
      if (!secret) {
        msg = "Paystack secret key is not set.";
      } else {
        const res = await fetch("https://api.paystack.co/balance", {
          headers: { Authorization: `Bearer ${secret}` },
        });
        const body = (await res.json()) as { status?: boolean; message?: string };
        ok = res.ok && !!body.status;
        msg = body.message ?? (ok ? "Connection successful" : `HTTP ${res.status}`);
      }
    } else if (p.slug === "flutterwave") {
      const secret = process.env.FLUTTERWAVE_SECRET_KEY;
      if (!secret) {
        msg = "Flutterwave secret key is not set.";
      } else {
        // Authenticated endpoint: rejects an invalid/incorrect secret key.
        const res = await fetch("https://api.flutterwave.com/v3/subaccounts?page=1", {
          headers: { Authorization: `Bearer ${secret}` },
        });
        const body = (await res.json()) as { status?: string; message?: string };
        ok = res.ok && body.status === "success";
        if (ok) {
          const extras: string[] = [];
          if (!process.env.FLUTTERWAVE_WEBHOOK_HASH) extras.push("webhook hash missing");
          if (!process.env.FLUTTERWAVE_ENCRYPTION_KEY) extras.push("encryption key missing");
          msg = extras.length
            ? `Credentials valid (${extras.join(", ")})`
            : "Connection successful";
        } else {
          msg = body.message ?? `HTTP ${res.status}`;
        }
      }
    } else if (p.slug === "monnify") {
      const apiKey = process.env.MONNIFY_API_KEY;
      const secretKey = process.env.MONNIFY_SECRET_KEY;
      const cfg = (p.config ?? {}) as Record<string, unknown>;
      const base = (cfg.base_url as string) || "https://api.monnify.com";
      if (!apiKey || !secretKey) {
        msg = "Monnify API key and secret key must both be set.";
      } else if (!cfg.contract_code) {
        msg = "Monnify contract code is missing.";
      } else {
        const basic = Buffer.from(`${apiKey}:${secretKey}`).toString("base64");
        const res = await fetch(`${base}/api/v1/auth/login`, {
          method: "POST",
          headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/json" },
        });
        const body = (await res.json()) as { requestSuccessful?: boolean; responseMessage?: string };
        ok = res.ok && !!body.requestSuccessful;
        msg = ok ? "Connection successful" : body.responseMessage ?? `HTTP ${res.status}`;
      }
    } else {
      msg = "Test connection is not implemented for this provider yet.";
    }
  } catch (err) {
    msg = (err as Error).message;
  }
  return { ok, message: msg.slice(0, 500) };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function recordTestResult(admin: any, id: string, r: { ok: boolean; message: string }) {
  await admin
    .from("payment_providers")
    .update({
      last_test_at: new Date().toISOString(),
      last_test_status: r.ok ? "ok" : "failed",
      last_test_message: r.message,
    })
    .eq("id", id);
}

export const adminTestProviderConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const admin = await assertAdmin(context);
    await loadGatewaySecrets(admin, true);
    const { data: p } = await admin.from("payment_providers").select("*").eq("id", data.id).maybeSingle();
    if (!p) throw new Error("Provider not found");

    const r = await runConnectionTest(p);
    await recordTestResult(admin, data.id, r);
    await logAdminActivity(context, {
      action: "payment_provider.test",
      area: "payments",
      target_type: "payment_provider",
      target_id: data.id,
      success: r.ok,
      details: r.message,
    });
    return r;
  });

/**
 * Save gateway credentials entered by a Super Admin. Values go straight into
 * server-side secret storage (never the client, never the provider row) and the
 * gateway is validated immediately afterwards.
 */
export const adminSaveProviderSecrets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid(),
        secrets: z.record(z.string(), z.string().min(1).max(500)),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const admin = await assertSuperAdmin(context);
    const { data: p } = await admin.from("payment_providers").select("*").eq("id", data.id).maybeSingle();
    if (!p) throw new Error("Provider not found");
    const known = KNOWN[p.slug as string];
    if (!known) throw new Error("Unknown gateway");

    const allowed = new Set(known.secret_fields.map((f) => f.name));
    const rows: { name: string; value: string; updated_at: string }[] = [];
    for (const [name, value] of Object.entries(data.secrets)) {
      const trimmed = String(value).trim();
      if (!trimmed) continue;
      if (!allowed.has(name) || !isGatewaySecretName(name)) {
        throw new Error(`Unexpected credential field: ${name}`);
      }
      rows.push({ name, value: trimmed, updated_at: new Date().toISOString() });
    }
    if (!rows.length) throw new Error("Nothing to save — enter at least one credential.");

    const { error } = await admin.from("internal_secrets").upsert(rows, { onConflict: "name" });
    if (error) throw new Error(error.message);
    await loadGatewaySecrets(admin, true);

    const r = await runConnectionTest(p);
    await recordTestResult(admin, data.id, r);
    await logAdminActivity(context, {
      action: "payment_provider.save_secrets",
      area: "payments",
      target_type: "payment_provider",
      target_id: data.id,
      success: r.ok,
      // names only — never log credential values
      details: `${p.slug}: ${rows.map((x) => x.name).join(", ")} · ${r.message}`,
    });
    return { saved: rows.map((x) => x.name), ...r };
  });

export const adminDeletePaymentProvider = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const admin = await assertSuperAdmin(context);
    const { data: p } = await admin.from("payment_providers").select("slug, is_active").eq("id", data.id).maybeSingle();
    if (p?.is_active) throw new Error("Cannot delete the active provider — activate another first.");
    const { error } = await admin.from("payment_providers").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    await logAdminActivity(context, {
      action: "payment_provider.delete",
      area: "payments",
      target_type: "payment_provider",
      target_id: data.id,
      details: p?.slug,
    });
    return { ok: true };
  });

/**
 * Public, non-sensitive info about the gateway customers will be sent to.
 * Used for checkout copy ("You'll be redirected to <gateway>") so switching
 * the active gateway in Admin updates the customer experience with no deploy.
 */
export const getActiveGatewayPublic = createServerFn({ method: "GET" }).handler(async () => {
  const fallback = { slug: "paystack", display_name: "Paystack", supports_recurring: true };
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await (supabaseAdmin as any)
      .from("payment_providers")
      .select("slug, display_name, enabled")
      .eq("is_active", true)
      .maybeSingle();
    if (!data || data.enabled === false) return fallback;
    const slug = String(data.slug);
    return {
      slug,
      display_name: (data.display_name as string) || KNOWN[slug]?.display_name || slug,
      supports_recurring: KNOWN[slug]?.supports_recurring ?? false,
    };
  } catch {
    return fallback;
  }
});
