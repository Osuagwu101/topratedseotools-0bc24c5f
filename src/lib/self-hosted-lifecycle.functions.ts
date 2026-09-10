/* Authenticated lifecycle bridge. The runtime signing secret remains server-only. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  activitySelfHostedSession,
  closeSelfHostedSession,
  heartbeatSelfHostedSession,
} from "@/lib/self-hosted-runtime.server";

const inputSchema = z.object({ audit_session_id: z.string().uuid() });

async function ownedRuntimeSession(auditSessionId: string, userId: string) {
  const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
  const { data } = await (admin as any)
    .from("browser_auth_sessions")
    .select("id, user_id, provider, provider_session_id, status, expires_at")
    .eq("id", auditSessionId)
    .eq("user_id", userId)
    .eq("provider", "self_hosted")
    .maybeSingle();
  if (!data?.provider_session_id || data.status !== "ready") {
    throw new Error("Self Hosted browser session is no longer active.");
  }
  return { admin, row: data };
}

export const heartbeatSelfHostedBrowser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => inputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { admin, row } = await ownedRuntimeSession(data.audit_session_id, context.userId);
    await heartbeatSelfHostedSession(admin, context.userId, row.provider_session_id);
    return { ok: true };
  });

export const recordSelfHostedBrowserActivity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => inputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { admin, row } = await ownedRuntimeSession(data.audit_session_id, context.userId);
    await activitySelfHostedSession(admin, context.userId, row.provider_session_id);
    return { ok: true };
  });

export const closeSelfHostedBrowser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => inputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { admin, row } = await ownedRuntimeSession(data.audit_session_id, context.userId);
    await closeSelfHostedSession(admin, context.userId, row.provider_session_id);
    await (admin as any)
      .from("browser_auth_sessions")
      .update({ status: "closed", updated_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("user_id", context.userId);
    return { ok: true };
  });
