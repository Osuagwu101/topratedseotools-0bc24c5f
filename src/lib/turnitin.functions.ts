import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { DEFAULT_TURNITIN_REPORT_PREFERENCES, prefsFromRow, reportDownloadFilename } from "@/lib/turnitin-report-preferences";

export type TurnitinJobStatus =
  | "draft"
  | "uploading"
  | "queued"
  | "processing"
  | "completed"
  | "failed";

export type TurnitinReportType = "similarity" | "ai";
export type TurnitinBillingMode = "prepaid" | "postpaid";
export type TurnitinReportStatus = "pending" | "available" | "unavailable" | "failed";

export interface TurnitinCreditSummary {
  available_credits: number;
  reserved_credits: number;
  next_expiry_at: string | null;
}

export interface TurnitinReportRow {
  id: string;
  job_id: string;
  report_type: TurnitinReportType;
  status: TurnitinReportStatus;
  score: number | null;
  storage_bucket: string | null;
  storage_path: string | null;
  unavailable_reason: string | null;
  available_at: string | null;
}

export interface TurnitinJobRow {
  id: string;
  original_filename: string;
  display_name: string | null;
  status: TurnitinJobStatus;
  upstream_status: string | null;
  similarity_percentage: number | null;
  ai_percentage: number | null;
  ai_unavailable_reason: string | null;
  submitted_at: string | null;
  accepted_at: string | null;
  completed_at: string | null;
  failed_at: string | null;
  failure_code: string | null;
  failure_message: string | null;
  credit_state: "none" | "reserved" | "consumed" | "refunded";
  billing_mode: TurnitinBillingMode;
  upstream_submission_id: string | null;
  upstream_last_error: string | null;
  word_count: number | null;
  created_at: string;
  reports: TurnitinReportRow[];
}

export interface TurnitinWorkspaceData {
  foundationReady: boolean;
  summary: TurnitinCreditSummary;
  account: {
    billing_mode: TurnitinBillingMode;
    postpaid_rate_ngn: number | null;
  };
  postpaid: {
    total_charges: number;
    unpaid_checks: number;
    outstanding_ngn: number;
    paid_ngn: number;
  };
  jobs: TurnitinJobRow[];
}

function missingFoundation(error: unknown): boolean {
  const e = error as { code?: string; message?: string; details?: string } | null;
  const text = `${e?.code ?? ""} ${e?.message ?? ""} ${e?.details ?? ""}`.toLowerCase();
  return (
    text.includes("turnitin_") ||
    text.includes("pgrst202") ||
    text.includes("42p01") ||
    text.includes("does not exist") ||
    text.includes("could not find the function")
  );
}

export const getMyTurnitinWorkspace = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<TurnitinWorkspaceData> => {
    const db = context.supabase as any;

    const [summaryResult, jobsResult, reportsResult, accountResult, chargesResult] =
      await Promise.all([
      db.rpc("turnitin_my_credit_summary"),
      db
        .from("turnitin_jobs")
        .select(
          "id, original_filename, display_name, status, upstream_status, similarity_percentage, ai_percentage, ai_unavailable_reason, submitted_at, accepted_at, completed_at, failed_at, failure_code, failure_message, credit_state, billing_mode, upstream_submission_id, upstream_last_error, word_count, created_at",
        )
        .eq("user_id", context.userId)
        .is("history_deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(200),
      db
        .from("turnitin_reports")
        .select(
          "id, job_id, report_type, status, score, storage_bucket, storage_path, unavailable_reason, available_at",
        )
        .eq("user_id", context.userId)
        .order("created_at", { ascending: false })
        .limit(400),
      db
        .from("turnitin_account_settings")
        .select("billing_mode, postpaid_rate_ngn")
        .eq("user_id", context.userId)
        .maybeSingle(),
      db
        .from("turnitin_postpaid_charges")
        .select("status, amount_ngn, paid_amount_ngn")
        .eq("user_id", context.userId),
    ]);

    const errors = [
      summaryResult.error,
      jobsResult.error,
      reportsResult.error,
      accountResult.error,
      chargesResult.error,
    ].filter(Boolean);

    if (errors.length) {
      if (errors.every(missingFoundation)) {
        return {
          foundationReady: false,
          summary: {
            available_credits: 0,
            reserved_credits: 0,
            next_expiry_at: null,
          },
          account: {
            billing_mode: "prepaid",
            postpaid_rate_ngn: null,
          },
          postpaid: {
            total_charges: 0,
            unpaid_checks: 0,
            outstanding_ngn: 0,
            paid_ngn: 0,
          },
          jobs: [],
        };
      }
      throw new Error(
        String(
          (errors[0] as { message?: string } | undefined)?.message ??
            "Could not load Turnitin workspace.",
        ),
      );
    }

    const summaryRaw = Array.isArray(summaryResult.data)
      ? summaryResult.data[0]
      : summaryResult.data;
    const summary: TurnitinCreditSummary = {
      available_credits: Number(summaryRaw?.available_credits ?? 0),
      reserved_credits: Number(summaryRaw?.reserved_credits ?? 0),
      next_expiry_at: summaryRaw?.next_expiry_at ?? null,
    };

    const accountRaw = accountResult.data as
      | { billing_mode?: string; postpaid_rate_ngn?: number | null }
      | null;

    const account = {
      billing_mode:
        accountRaw?.billing_mode === "postpaid"
          ? ("postpaid" as const)
          : ("prepaid" as const),
      postpaid_rate_ngn:
        accountRaw?.postpaid_rate_ngn == null
          ? null
          : Number(accountRaw.postpaid_rate_ngn),
    };

    const chargeRows = (chargesResult.data ?? []) as Array<{
      status?: string;
      amount_ngn?: number | null;
      paid_amount_ngn?: number | null;
    }>;
    const postpaid = {
      total_charges: chargeRows.length,
      unpaid_checks: chargeRows.filter(
        (row) => row.status === "unpaid" || row.status === "partially_paid",
      ).length,
      outstanding_ngn: chargeRows.reduce((sum, row) => {
        if (row.status === "void") return sum;
        return (
          sum +
          Math.max(
            0,
            Number(row.amount_ngn ?? 0) - Number(row.paid_amount_ngn ?? 0),
          )
        );
      }, 0),
      paid_ngn: chargeRows.reduce(
        (sum, row) => sum + Number(row.paid_amount_ngn ?? 0),
        0,
      ),
    };

    const reportsByJob = new Map<string, TurnitinReportRow[]>();
    for (const raw of reportsResult.data ?? []) {
      const report = raw as TurnitinReportRow;
      const existing = reportsByJob.get(report.job_id) ?? [];
      existing.push(report);
      reportsByJob.set(report.job_id, existing);
    }

    const jobs: TurnitinJobRow[] = (jobsResult.data ?? []).map((raw: unknown) => {
      const job = raw as Omit<TurnitinJobRow, "reports">;
      return {
        ...job,
        reports: reportsByJob.get(job.id) ?? [],
      };
    });

    return { foundationReady: true, summary, account, postpaid, jobs };
  });

export const getMyTurnitinReportDownload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ reportId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const db = context.supabase as any;
    const { data: report, error } = await db
      .from("turnitin_reports")
      .select(
        "id, user_id, job_id, report_type, status, storage_bucket, storage_path",
      )
      .eq("id", data.reportId)
      .eq("user_id", context.userId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!report) throw new Error("Report not found.");
    if (report.status !== "available") {
      throw new Error("This report is not ready to download yet.");
    }
    if (!report.storage_bucket || !report.storage_path) {
      throw new Error("The report file has not been stored yet.");
    }

    const { data: job, error: jobError } = await db
      .from("turnitin_jobs")
      .select("original_filename, history_deleted_at")
      .eq("id", report.job_id)
      .eq("user_id", context.userId)
      .maybeSingle();

    if (jobError) throw new Error(jobError.message);
    if (job?.history_deleted_at) throw new Error("This check has been deleted.");
    if (!job?.original_filename) {
      throw new Error("The original document name could not be found.");
    }

    // Defaults are per customer and evaluated at download time, not at submission.
    const { data: storedPrefs, error: prefsError } = await db
      .from("turnitin_report_preferences")
      .select("*")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (prefsError) throw new Error("Could not read your report naming settings.");
    const prefs = storedPrefs
      ? prefsFromRow(storedPrefs as Record<string, unknown>)
      : DEFAULT_TURNITIN_REPORT_PREFERENCES;
    const filename = reportDownloadFilename(
      String(job.original_filename),
      report.report_type as TurnitinReportType,
      prefs,
    );

    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const admin = supabaseAdmin as any;
    const { data: signed, error: signedError } = await admin.storage
      .from(report.storage_bucket)
      .createSignedUrl(report.storage_path, 60, {
        download: filename,
      });

    if (signedError || !signed?.signedUrl) {
      throw new Error(signedError?.message ?? "Could not prepare the report download.");
    }

    return {
      url: signed.signedUrl as string,
      filename,
      reportType: report.report_type as TurnitinReportType,
    };
  });


/**
 * Delete a finished check from the customer's account without modifying
 * credit consumption, postpaid charges or provider-side records.
 * Only its owner can request the change. Running checks are protected.
 */
export const deleteMyTurnitinCheck = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ jobId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any;
    const { data: job, error } = await admin.from("turnitin_jobs")
      .select("id, user_id, status, history_deleted_at")
      .eq("id", data.jobId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error("Could not find this check.");
    if (!job || job.history_deleted_at) throw new Error("This check is no longer available.");
    if (!["completed", "failed"].includes(job.status)) {
      throw new Error("Please wait until processing finishes before deleting this check.");
    }

    // Hide first, under ownership and status guards; billing history is retained.
    const { data: deleted, error: updateError } = await admin.from("turnitin_jobs")
      .update({ history_deleted_at: new Date().toISOString() })
      .eq("id", data.jobId)
      .eq("user_id", context.userId)
      .is("history_deleted_at", null)
      .in("status", ["completed", "failed"])
      .select("id")
      .maybeSingle();
    if (updateError || !deleted) throw new Error("Could not delete this check. Please retry.");

    // Revoke the customer's future report downloads and clean stored PDF
    // copies without touching the financial ledger or upstream provider.
    const { data: reports, error: reportError } = await admin.from("turnitin_reports")
      .select("id, storage_bucket, storage_path")
      .eq("job_id", data.jobId)
      .eq("user_id", context.userId);
    if (reportError) {
      console.error("[Turnitin] Report cleanup lookup failed after history deletion", reportError.message);
      return { deleted: true };
    }
    for (const report of reports ?? []) {
      if (!report.storage_bucket || !report.storage_path) continue;
      const { error: storageError } = await admin.storage
        .from(report.storage_bucket)
        .remove([report.storage_path]);
      if (storageError) {
        console.error("[Turnitin] Stored report cleanup failed", storageError.message);
      }
    }
    return { deleted: true };
  });
