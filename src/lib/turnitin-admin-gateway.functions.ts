import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Phase 4 admin server functions: live provider re-verification and
 * credit restoration for Turnitin jobs. All logic lives in the tested core;
 * this file only wires real dependencies (service-role DB, provider, audit log).
 */

const JOB_COLS =
  "id,user_id,original_filename,status,credit_state,billing_mode,upstream_submission_id,upstream_status,created_at,failed_at,failure_code";

async function adminContext(context: any) {
  const { assertAdminRole } = await import("@/lib/turnitin-admin-gate");
  assertAdminRole(await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" }));
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

async function buildDeps(db: any, actorId: string) {
  const { getOriginalitySubmissionStatus } = await import("@/lib/turnitin-originality.server");
  const { data: acct } = await db.from("admin_accounts").select("account_email").eq("user_id", actorId).maybeSingle();
  return {
    actorId,
    now: () => new Date().toISOString(),
    loadJob: async (id: string) => {
      const { data, error } = await db.from("turnitin_jobs").select(JOB_COLS).eq("id", id).maybeSingle();
      if (error) throw new Error(error.message);
      return data ?? null;
    },
    // Status lookup only: never uploads or resubmits, so it cannot create charges.
    probe: async (job: any) => {
      if (!job.upstream_submission_id) return null;
      try {
        const s = await getOriginalitySubmissionStatus(db, String(job.upstream_submission_id));
        return s ? { kind: "found" as const, upstreamStatus: s.status } : { kind: "not_found" as const };
      } catch (e: any) {
        return { kind: "error" as const, httpStatus: e?.status ?? null, errorCode: e?.code ?? "PROVIDER_ERROR" };
      }
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      const { data, error } = await db.rpc(fn, args);
      return { data, error: error ? { message: String(error.message) } : null };
    },
    markFailed: async (id: string, upstreamStatus: string | null) => {
      const now = new Date().toISOString();
      const { error } = await db.from("turnitin_jobs").update({
        status: "failed", upstream_status: upstreamStatus, failed_at: now,
        failure_code: "UPSTREAM_FAILED_ADMIN_VERIFIED", upstream_last_checked_at: now,
      }).eq("id", id).neq("status", "completed");
      if (error) throw new Error(error.message);
    },
    audit: async (rec: any, strict: boolean) => {
      const { error } = await db.from("admin_activity_log").insert({
        actor_user_id: actorId, actor_email: acct?.account_email ?? null, actor_role: "admin",
        success: rec.success, action: rec.action, area: "turnitin", target_type: "turnitin_job",
        target_id: rec.jobId, reason: rec.reason ?? null, reference: JSON.stringify(rec.details),
      });
      if (error && strict) throw new Error("The audit log could not be written, so nothing was changed.");
    },
  };
}

export const listTurnitinJobsNeedingAttention = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const db = await adminContext(context);
    const staleBefore = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const [failed, stale] = await Promise.all([
      db.from("turnitin_jobs").select(JOB_COLS).eq("status", "failed").in("credit_state", ["consumed", "reserved"])
        .order("created_at", { ascending: false }).limit(200),
      db.from("turnitin_jobs").select(JOB_COLS).in("status", ["uploading", "queued", "processing"])
        .lt("created_at", staleBefore).order("created_at", { ascending: true }).limit(200),
    ]);
    if (failed.error) throw new Error(failed.error.message);
    if (stale.error) throw new Error(stale.error.message);
    const tag = (rows: any[], reason: string) => rows.map((r) => ({ ...r, attention: reason }));
    return {
      jobs: [...tag(failed.data ?? [], "failed_with_credit"), ...tag(stale.data ?? [], "long_running")],
      generatedAt: new Date().toISOString(),
    };
  });

export const reverifyTurnitinJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { jobId: string; correlationId: string }) => d)
  .handler(async ({ context, data }) => {
    const db = await adminContext(context);
    const { verifyJob } = await import("@/lib/turnitin-admin-gateway.core");
    return verifyJob(await buildDeps(db, context.userId) as any, data.jobId, data.correlationId);
  });

export const restoreTurnitinJobCredit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { jobId: string; reason: string; correlationId: string }) => d)
  .handler(async ({ context, data }) => {
    const db = await adminContext(context);
    const { restoreJobCredit } = await import("@/lib/turnitin-admin-gateway.core");
    return restoreJobCredit(await buildDeps(db, context.userId) as any, data.jobId, data.reason, data.correlationId);
  });
