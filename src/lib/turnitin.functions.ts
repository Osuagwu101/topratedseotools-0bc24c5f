import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type TurnitinJobStatus =
  | "draft"
  | "uploading"
  | "queued"
  | "processing"
  | "completed"
  | "failed";

export type TurnitinReportType = "similarity" | "ai";
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
  upstream_submission_id: string | null;
  upstream_last_error: string | null;
  word_count: number | null;
  created_at: string;
  reports: TurnitinReportRow[];
}

function turnitinReportDownloadName(
  originalFilename: string,
  reportType: TurnitinReportType,
): string {
  const leaf = String(originalFilename || "report")
    .split(/[\\/]/)
    .pop() || "report";
  const stem = leaf
    .replace(/\.[^.]+$/, "")
    .replace(/[\u0000-\u001f\u007f"<>:|?*]/g, "_")
    .trim()
    .slice(0, 180) || "report";
  const prefix = reportType === "ai" ? "AI_" : "si_";
  return `${prefix}${stem}.pdf`;
}

export interface TurnitinWorkspaceData {
  foundationReady: boolean;
  summary: TurnitinCreditSummary;
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

    const [summaryResult, jobsResult, reportsResult] = await Promise.all([
      db.rpc("turnitin_my_credit_summary"),
      db
        .from("turnitin_jobs")
        .select(
          "id, original_filename, display_name, status, upstream_status, similarity_percentage, ai_percentage, ai_unavailable_reason, submitted_at, accepted_at, completed_at, failed_at, failure_code, failure_message, credit_state, upstream_submission_id, upstream_last_error, word_count, created_at",
        )
        .eq("user_id", context.userId)
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
    ]);

    const errors = [
      summaryResult.error,
      jobsResult.error,
      reportsResult.error,
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

    return { foundationReady: true, summary, jobs };
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
      .select("original_filename")
      .eq("id", report.job_id)
      .eq("user_id", context.userId)
      .maybeSingle();

    if (jobError) throw new Error(jobError.message);
    if (!job?.original_filename) {
      throw new Error("The original document name could not be found.");
    }

    const filename = turnitinReportDownloadName(
      String(job.original_filename),
      report.report_type as TurnitinReportType,
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
