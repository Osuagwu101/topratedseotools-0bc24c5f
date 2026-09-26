/* Phase 4 — Admin controls for ChatGPT access/device policy. */
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

export const adminGetChatGptControls = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => userInput.parse(input))
  .handler(async ({ data, context }) => {
    const admin = await assertAdmin(context);
    const { ensureChatGptUserControls } = await import(
      "@/lib/chatgpt-controls.server"
    );
    const controls = await ensureChatGptUserControls(data.userId);

    const { data: devices, error } = await admin
      .from("chatgpt_devices")
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
  device_limit: z.number().int().min(1).max(10),
  status: z.enum(["active", "suspended"]),
});

export const adminUpdateChatGptControls = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => updateInput.parse(input))
  .handler(async ({ data, context }) => {
    const admin = await assertAdmin(context);
    const now = new Date().toISOString();

    const { error } = await admin
      .from("chatgpt_user_controls")
      .upsert(
        {
          user_id: data.userId,
          device_limit: data.device_limit,
          status: data.status,
          suspended_reason: data.status === "active" ? null : "admin_suspended",
          suspended_at: data.status === "active" ? null : now,
          updated_at: now,
        },
        { onConflict: "user_id" },
      );
    if (error) throw new Error(error.message);

    if (data.status !== "active") {
      const { error: revokeError } = await admin
        .from("chatgpt_proxy_sessions")
        .update({ status: "revoked" })
        .eq("user_id", data.userId)
        .in("status", ["issued", "active"]);
      if (revokeError) throw new Error(revokeError.message);
    }

    await logAdminActivity(context, {
      action: "chatgpt.customer_controls_update",
      area: "customers",
      target_type: "user",
      target_id: data.userId,
      details: `ChatGPT devices=${data.device_limit}, status=${data.status}`,
    });

    return { ok: true };
  });

export const adminResetChatGptDevices = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => userInput.parse(input))
  .handler(async ({ data, context }) => {
    const admin = await assertAdmin(context);

    const { error } = await admin
      .from("chatgpt_devices")
      .delete()
      .eq("user_id", data.userId);
    if (error) throw new Error(error.message);

    await admin
      .from("chatgpt_proxy_sessions")
      .update({ status: "revoked" })
      .eq("user_id", data.userId)
      .in("status", ["issued", "active"]);

    const { reactivateChatGptAccess } = await import(
      "@/lib/chatgpt-controls.server"
    );
    await reactivateChatGptAccess(data.userId);

    await logAdminActivity(context, {
      action: "chatgpt.customer_devices_reset",
      area: "customers",
      target_type: "user",
      target_id: data.userId,
      details: "Registered ChatGPT devices cleared and ChatGPT access reactivated.",
    });

    return { ok: true };
  });
