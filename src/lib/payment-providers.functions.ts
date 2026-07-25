/**
 * Payment providers — server functions.
 *
 * Admin can add, edit, enable/disable, activate, and test payment
 * providers from the dashboard without code changes. The secret key is
 * NOT stored in this table (it lives in encrypted secret storage) — the
 * admin edits it via the secrets form. This table stores public keys,
 * environment, enabled/active flags and last connection-test result.
 */
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
  return supabaseAdmin as any;
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
  config: Record<string, unknown>;
  last_test_at: string | null;
  last_test_status: string | null;
  last_test_message: string | null;
  updated_at: string;
  has_secret_configured: boolean; // computed
}

const KNOWN: Record<string, { display_name: string; secret_env: string; supports_recurring: boolean }> = {
  paystack: { display_name: "Paystack", secret_env: "PAYSTACK_SECRET_KEY", supports_recurring: true },
  monnify: { display_name: "Monnify", secret_env: "MONNIFY_SECRET_KEY", supports_recurring: true },
  flutterwave: { display_name: "Flutterwave", secret_env: "FLUTTERWAVE_SECRET_KEY", supports_recurring: true },
};

export const adminListPaymentProviders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const admin = await assertAdmin(context);
    const { data, error } = await admin
      .from("payment_providers")
      .select("*")
      .order("display_name", { ascending: true });
    if (error) throw new Error(error.message);
    const rows: PaymentProviderRow[] = (data ?? []).map((r: any) => {
      const known = KNOWN[r.slug];
      const secretEnv = known?.secret_env;
      const hasSecret = secretEnv ? !!process.env[secretEnv] : false;
      return { ...r, has_secret_configured: hasSecret } as PaymentProviderRow;
    });
    const catalog = Object.entries(KNOWN).map(([slug, meta]) => ({ slug, ...meta }));
    return { providers: rows, catalog };
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
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const admin = await assertAdmin(context);
    const patch = {
      slug: data.slug,
      display_name: data.display_name,
      environment: data.environment,
      public_key: data.public_key ?? null,
      webhook_secret_hint: data.webhook_secret_hint ?? null,
      enabled: data.enabled ?? false,
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
    const admin = await assertAdmin(context);
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
    });
    return { ok: true };
  });

export const adminTestProviderConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const admin = await assertAdmin(context);
    const { data: p } = await admin.from("payment_providers").select("*").eq("id", data.id).maybeSingle();
    if (!p) throw new Error("Provider not found");

    let ok = false;
    let msg = "";
    try {
      if (p.slug === "paystack") {
        const secret = process.env.PAYSTACK_SECRET_KEY;
        if (!secret) {
          msg = "PAYSTACK_SECRET_KEY is not set. Add it via the API-keys settings.";
        } else {
          const res = await fetch("https://api.paystack.co/balance", {
            headers: { Authorization: `Bearer ${secret}` },
          });
          const body = (await res.json()) as { status?: boolean; message?: string };
          ok = res.ok && !!body.status;
          msg = body.message ?? (ok ? "Connection successful" : `HTTP ${res.status}`);
        }
      } else {
        msg = "Test connection is not implemented for this provider yet.";
      }
    } catch (err) {
      msg = (err as Error).message;
    }

    await admin
      .from("payment_providers")
      .update({
        last_test_at: new Date().toISOString(),
        last_test_status: ok ? "ok" : "failed",
        last_test_message: msg.slice(0, 500),
      })
      .eq("id", data.id);

    await logAdminActivity(context, {
      action: "payment_provider.test",
      area: "payments",
      target_type: "payment_provider",
      target_id: data.id,
      success: ok,
      details: msg,
    });

    return { ok, message: msg };
  });

export const adminDeletePaymentProvider = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const admin = await assertAdmin(context);
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
