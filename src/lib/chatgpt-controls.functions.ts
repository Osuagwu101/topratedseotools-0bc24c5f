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
  provider_account_key:z.enum(["account_1","account_2"]),
  device_limit: z.number().int().min(1).max(10),
  status: z.enum(["active", "suspended"]),
});

export const adminUpdateChatGptControls = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => updateInput.parse(input))
  .handler(async ({ data, context }) => {
    const admin = await assertAdmin(context);
    const now = new Date().toISOString();
    const {loadEncryptedChatGPTSession}=await import("./chatgpt-proxy.server");
    await loadEncryptedChatGPTSession(data.provider_account_key);

    const { error } = await admin
      .from("chatgpt_user_controls")
      .upsert(
        {
          user_id: data.userId,
          provider_account_key:data.provider_account_key,
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
      details: `ChatGPT devices=${data.device_limit}, status=${data.status}, account=${data.provider_account_key}`,
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

// ------------------------------------------------ shared project grants

export const adminListChatGptProjectGrants = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => userInput.parse(input))
  .handler(async ({ data, context }) => {
    const admin = await assertAdmin(context);
    const { data: rows, error } = await admin
      .from("chatgpt_project_grants")
      .select("provider_account_key,project_id,project_name,created_at")
      .eq("user_id", data.userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (rows ?? []) as Array<{
      provider_account_key: "account_1" | "account_2";
      project_id: string;
      project_name: string | null;
      created_at: string;
    }>;
  });

const grantInput = userInput.extend({
  provider_account_key: z.enum(["account_1", "account_2"]),
  project: z.string().trim().min(1).max(500),
  project_name: z.string().trim().max(120).optional(),
});

export const adminGrantChatGptProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => grantInput.parse(input))
  .handler(async ({ data, context }) => {
    const admin = await assertAdmin(context);
    const { projectIdFromInput } = await import("@/lib/chatgpt-project-access");
    const projectId = projectIdFromInput(data.project);
    if (!projectId) throw new Error("Paste the ChatGPT project link (it contains g-p-…).");

    const { data: existing, error: readError } = await admin
      .from("chatgpt_project_grants")
      .select("user_id")
      .eq("provider_account_key", data.provider_account_key)
      .eq("project_id", projectId)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    if (existing && String(existing.user_id) !== data.userId) {
      throw new Error("This project is already granted to another writer. Remove that grant first.");
    }

    const { error } = await admin.from("chatgpt_project_grants").upsert(
      {
        provider_account_key: data.provider_account_key,
        project_id: projectId,
        user_id: data.userId,
        project_name: data.project_name || null,
        granted_by: context.userId,
      },
      { onConflict: "provider_account_key,project_id" },
    );
    if (error) throw new Error(error.message);
    const { forgetProjectGrantCache } = await import("@/lib/chatgpt-isolation.server");
    forgetProjectGrantCache();

    await logAdminActivity(context, {
      action: "chatgpt.project_grant",
      area: "customers",
      target_type: "user",
      target_id: data.userId,
      details: `ChatGPT project ${projectId} (${data.provider_account_key}) granted${data.project_name ? `: ${data.project_name}` : ""}`,
    });
    return { ok: true, projectId };
  });

const revokeInput = userInput.extend({
  provider_account_key: z.enum(["account_1", "account_2"]),
  project_id: z.string().regex(/^g-p-[0-9a-f]{32}$/i),
});

export const adminRevokeChatGptProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => revokeInput.parse(input))
  .handler(async ({ data, context }) => {
    const admin = await assertAdmin(context);
    const { error } = await admin
      .from("chatgpt_project_grants")
      .delete()
      .eq("provider_account_key", data.provider_account_key)
      .eq("project_id", data.project_id.toLowerCase())
      .eq("user_id", data.userId);
    if (error) throw new Error(error.message);
    const { forgetProjectGrantCache } = await import("@/lib/chatgpt-isolation.server");
    forgetProjectGrantCache();

    await logAdminActivity(context, {
      action: "chatgpt.project_revoke",
      area: "customers",
      target_type: "user",
      target_id: data.userId,
      details: `ChatGPT project ${data.project_id} (${data.provider_account_key}) access removed`,
    });
    return { ok: true };
  });
