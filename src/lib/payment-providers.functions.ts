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
    required_env: [
      "FLUTTERWAVE_SECRET_KEY",
      "FLUTTERWAVE_PUBLIC_KEY",
      "FLUTTERWAVE_ENCRYPTION_KEY",
      "FLUTTERWAVE_WEBHOOK_HASH",
    ],
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
        const { runProviderConnectionTest } = await import(
          "@/lib/gateways/provider-validation.server"
        );
        const test = await runProviderConnectionTest({ slug: data.slug, config: mergedConfig });
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

/*
 * There is no "set active gateway" action any more: routing is automatic and
 * currency-driven (see src/lib/gateway-routing.ts). Admins keep credentials,
 * configuration, and connection tests only.
 */



export const adminTestProviderConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const admin = await assertAdmin(context);
    await loadGatewaySecrets(admin, true);
    const { data: p } = await admin.from("payment_providers").select("*").eq("id", data.id).maybeSingle();
    if (!p) throw new Error("Provider not found");

    const { recordProviderTestResult, runProviderConnectionTest } = await import(
      "@/lib/gateways/provider-validation.server"
    );
    const r = await runProviderConnectionTest(p);
    await recordProviderTestResult(admin, data.id, r);
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

    const { recordProviderTestResult, runProviderConnectionTest } = await import(
      "@/lib/gateways/provider-validation.server"
    );
    const r = await runProviderConnectionTest(p);
    await recordProviderTestResult(admin, data.id, r);
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
    const { data: p } = await admin.from("payment_providers").select("slug").eq("id", data.id).maybeSingle();

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
 * Enable / disable a gateway for checkout without opening the edit dialog.
 * Enabling runs the same credential + live-connection checks as activation so a
 * broken gateway can never be exposed to customers.
 */
export const adminSetProviderEnabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ id: z.string().uuid(), enabled: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const admin = await assertSuperAdmin(context);
    const { data: target } = await admin
      .from("payment_providers")
      .select("id, slug, config, is_active")
      .eq("id", data.id)
      .maybeSingle();
    if (!target) throw new Error("Provider not found");

    if (data.enabled) {
      await loadGatewaySecrets(admin, true);
      const known = KNOWN[target.slug as string];
      if (known) {
        const missing = missingSecrets(known.required_env);
        const cfg = (target.config ?? {}) as Record<string, unknown>;
        for (const f of known.config_fields) {
          if (f.required && !cfg[f.key]) missing.push(f.label);
        }
        if (missing.length) {
          throw new Error(`Cannot enable ${known.display_name} — missing: ${missing.join(", ")}.`);
        }
        const { recordProviderTestResult, runProviderConnectionTest } = await import(
          "@/lib/gateways/provider-validation.server"
        );
        const test = await runProviderConnectionTest(target);
        await recordProviderTestResult(admin, data.id, test);
        if (!test.ok) throw new Error(`Cannot enable — credential check failed: ${test.message}`);
      }
    }


    const { error } = await admin
      .from("payment_providers")
      .update({ enabled: data.enabled })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    await logAdminActivity(context, {
      action: data.enabled ? "payment_provider.enable" : "payment_provider.disable",
      area: "payments",
      target_type: "payment_provider",
      target_id: data.id,
      details: target.slug as string,
    });
    return { ok: true, enabled: data.enabled };
  });


/*
 * Checkout copy ("You'll be redirected to <gateway>") is derived on the client
 * from the selected currency via src/lib/gateway-routing.ts — no server call
 * and no admin-selected active gateway.
 */

