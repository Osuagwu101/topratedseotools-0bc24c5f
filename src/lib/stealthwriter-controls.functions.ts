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

    return {
      controls,
      devices: (devices ?? []) as Array<{
        id: string;
        label: string;
        first_seen_at: string;
        last_seen_at: string;
      }>,
    };
  });

const updateInput = userInput.extend({
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
    const now = new Date().toISOString();
    const row = {
      user_id: data.userId,
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

    if (data.status !== "active") {
      await admin
        .from("stealthwriter_proxy_sessions")
        .update({ status: "revoked" })
        .eq("user_id", data.userId)
        .in("status", ["issued", "active"]);
    }

    await logAdminActivity(context, {
      action: "stealthwriter.customer_controls_update",
      area: "customers",
      target_type: "user",
      target_id: data.userId,
      details:
        `Humanizer=${data.humanizer_enabled ? "on" : "off"} (${data.humanizer_daily_limit}/day), ` +
        `AI Detector=${data.ai_detector_enabled ? "on" : "off"} (${data.ai_detector_daily_limit}/day), ` +
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
