/* Admin management for Phase 5.1 StealthWriter AWS-parity controls. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { logAdminActivity } from "@/lib/admin-audit.server";

async function assertAdmin(context: { supabase: any; userId: string }) {
  const { data, error } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

const userInput = z.object({ userId: z.string().uuid() });

export const adminGetStealthWriterControls = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => userInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { ensureStealthWriterUserControls } = await import(
      "@/lib/stealthwriter-controls.server"
    );
    const controls = await ensureStealthWriterUserControls(data.userId);
    const admin = await assertAdmin(context);

    const { data: devices, error } = await admin
      .from("stealthwriter_devices")
      .select("id,label,first_seen_at,last_seen_at")
      .eq("user_id", data.userId)
      .order("last_seen_at", { ascending: false });
    if (error) throw new Error(error.message);

    const { data: providerAccounts, error: providerError } = await admin
      .from("stealthwriter_provider_accounts")
      .select("account_key,display_name,sort_order,status")
      .in("account_key", ["account_1", "account_2"])
      .order("sort_order", { ascending: true });
    if (providerError) throw new Error(providerError.message);

    return {
      controls,
      provider_accounts: ((providerAccounts ?? []) as any[]).map((account) => ({
        account_key: String(account.account_key),
        display_name: String(account.display_name),
        sort_order: Number(account.sort_order),
        configured: account.status === "stored",
        status: String(account.status),
      })),
      devices: (devices ?? []) as Array<{
        id: string;
        label: string;
        first_seen_at: string;
        last_seen_at: string;
      }>,
    };
  });

const updateInput = userInput.extend({
  provider_account_key: z.enum(["account_1", "account_2"]),
  humanizer_enabled: z.boolean(),
  humanizer_daily_limit: z.number().int().min(0).max(10000),
  ai_detector_enabled: z.boolean(),
  ai_detector_daily_limit: z.number().int().min(0).max(10000),
  device_limit: z.number().int().min(1).max(10),
  status: z.enum(["active", "suspended"]),
});

export const adminUpdateStealthWriterControls = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => updateInput.parse(input))
  .handler(async ({ data, context }) => {
    const admin = await assertAdmin(context);

    const { data: providerAccount, error: providerError } = await admin
      .from("stealthwriter_provider_accounts")
      .select("account_key,status")
      .eq("account_key", data.provider_account_key)
      .eq("status", "stored")
      .maybeSingle();
    if (providerError) throw new Error(providerError.message);
    if (!providerAccount) {
      throw new Error(
        "Configure the selected StealthWriter proxy account before assigning customers to it.",
      );
    }

    const { data: previousControls, error: previousError } = await admin
      .from("stealthwriter_user_controls")
      .select("provider_account_key")
      .eq("user_id", data.userId)
      .maybeSingle();
    if (previousError) throw new Error(previousError.message);

    const providerChanged =
      !!previousControls?.provider_account_key &&
      previousControls.provider_account_key !== data.provider_account_key;

    const now = new Date().toISOString();
    const row = {
      user_id: data.userId,
      provider_account_key: data.provider_account_key,
      status: data.status,
      device_limit: data.device_limit,
      humanizer_enabled: data.humanizer_enabled,
      humanizer_daily_limit: data.humanizer_daily_limit,
      ai_detector_enabled: data.ai_detector_enabled,
      ai_detector_daily_limit: data.ai_detector_daily_limit,
      suspended_reason: data.status === "active" ? null : "admin_suspended",
      suspended_at: data.status === "active" ? null : now,
      updated_at: now,
    };

    const { error } = await admin
      .from("stealthwriter_user_controls")
      .upsert(row, { onConflict: "user_id" });
    if (error) throw new Error(error.message);

    if (data.status !== "active" || providerChanged) {
      const { error: revokeError } = await admin
        .from("stealthwriter_proxy_sessions")
        .update({ status: "revoked" })
        .eq("user_id", data.userId)
        .in("status", ["issued", "active"]);
      if (revokeError) throw new Error(revokeError.message);
    }

    await logAdminActivity(context, {
      action: "stealthwriter.customer_controls_update",
      area: "customers",
      target_type: "user",
      target_id: data.userId,
      details:
        `Humanizer=${data.humanizer_enabled ? "on" : "off"} (${data.humanizer_daily_limit}/day), ` +
        `AI Detector=${data.ai_detector_enabled ? "on" : "off"} (${data.ai_detector_daily_limit}/day), ` +
        `provider=${data.provider_account_key}${providerChanged ? " (changed; proxy sessions revoked)" : ""}, ` +
        `devices=${data.device_limit}, status=${data.status}`,
    });

    return { ok: true };
  });

export const adminResetStealthWriterDevices = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => userInput.parse(input))
  .handler(async ({ data, context }) => {
    const admin = await assertAdmin(context);

    const { error } = await admin
      .from("stealthwriter_devices")
      .delete()
      .eq("user_id", data.userId);
    if (error) throw new Error(error.message);

    await admin
      .from("stealthwriter_proxy_sessions")
      .update({ status: "revoked" })
      .eq("user_id", data.userId)
      .in("status", ["issued", "active"]);

    const { reactivateTopRatedAccount } = await import(
      "@/lib/stealthwriter-controls.server"
    );
    await reactivateTopRatedAccount(data.userId);

    await logAdminActivity(context, {
      action: "stealthwriter.customer_devices_reset",
      area: "customers",
      target_type: "user",
      target_id: data.userId,
      details: "Registered StealthWriter devices cleared and the full TopRatedSEOTools account reactivated.",
    });

    return { ok: true };
  });


/* Customer-facing AWS dashboard experience. Secrets/fingerprints are never returned. */
export const getMyStealthWriterExperience = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const {
      ensureStealthWriterUserControls,
      getStealthWriterUsageSnapshot,
    } = await import("@/lib/stealthwriter-controls.server");

    const [controls, snapshot, devicesResult] = await Promise.all([
      ensureStealthWriterUserControls(context.userId),
      getStealthWriterUsageSnapshot(context.userId),
      (supabaseAdmin as any)
        .from("stealthwriter_devices")
        .select("id,label,first_seen_at,last_seen_at")
        .eq("user_id", context.userId)
        .order("last_seen_at", { ascending: false }),
    ]);

    if (devicesResult.error) throw new Error(devicesResult.error.message);

    return {
      status: controls.status,
      device_limit: controls.device_limit,
      features: snapshot.features,
      resets_in: snapshot.resets_in,
      devices: ((devicesResult.data ?? []) as any[]).map((device) => ({
        id: String(device.id),
        label: String(device.label ?? "Device"),
        first_seen_at: String(device.first_seen_at),
        last_seen_at: String(device.last_seen_at),
      })),
    };
  });

export const removeMyStealthWriterDevice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ deviceId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: device, error: readError } = await (supabaseAdmin as any)
      .from("stealthwriter_devices")
      .select("id,device_fingerprint")
      .eq("id", data.deviceId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    if (!device) throw new Error("Device not found.");

    const { error: deleteError } = await (supabaseAdmin as any)
      .from("stealthwriter_devices")
      .delete()
      .eq("id", data.deviceId)
      .eq("user_id", context.userId);
    if (deleteError) throw new Error(deleteError.message);

    // A removed device must not keep an old proxy session alive.
    await (supabaseAdmin as any)
      .from("stealthwriter_proxy_sessions")
      .update({ status: "revoked" })
      .eq("user_id", context.userId)
      .eq("device_fingerprint", String(device.device_fingerprint))
      .in("status", ["issued", "active"]);

    return { ok: true };
  });
