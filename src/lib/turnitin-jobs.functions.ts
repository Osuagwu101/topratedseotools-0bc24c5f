/*
 * Turnitin Phase 5 customer job orchestration.
 *
 * Credit lifecycle:
 *   intent -> reserve 1 credit
 *   upstream accepts -> consume reserved credit
 *   explicit pre-acceptance rejection -> release reserved credit
 *   ambiguous network failure -> keep reservation + same upload_token for retry
 *   accepted job later fully fails -> refund one fresh credit
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash, randomUUID } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  downloadOriginalityReport,
  getOriginalitySubmissionStatus,
  OriginalityAdapterError,
  submitOriginalityDocument,
  testStoredOriginalitySession,
} from "@/lib/turnitin-originality.server";

const SOURCE_BUCKET = "turnitin-source";
const REPORT_BUCKET = "turnitin-reports";
const MAX_FILE_BYTES = 100 * 1024 * 1024;
const ACCEPTED_MIME = new Map([
  ["application/pdf", "pdf"],
  ["application/msword", "doc"],
  [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "docx",
  ],
]);

const optionsSchema = z
  .object({
    excludeBibliography: z.boolean().default(false),
    excludeQuotes: z.boolean().default(false),
    excludeCitations: z.boolean().default(false),
    excludeSmallMatches: z.boolean().default(false),
    smallMatchMode: z.enum(["words", "percent"]).default("words"),
    smallMatchThreshold: z.number().int().nullable().optional(),
    reportView: z.enum(["sources", "match_groups"]).default("sources"),
    reportFormat: z.string().trim().max(80).nullable().optional(),
    reportTitle: z.string().trim().max(500).nullable().optional(),
    authorFirstName: z.string().trim().max(200).nullable().optional(),
    authorLastName: z.string().trim().max(200).nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.excludeSmallMatches) return;
    const n = value.smallMatchThreshold;
    const [lo, hi] =
      value.smallMatchMode === "percent" ? [1, 50] : [8, 200];
    if (n == null || n < lo || n > hi) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["smallMatchThreshold"],
        message: `Small-match threshold must be between ${lo} and ${hi} ${value.smallMatchMode === "percent" ? "%" : "words"}.`,
      });
    }
  });

const intentInput = z.object({
  filename: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(150),
  sizeBytes: z.number().int().min(1).max(MAX_FILE_BYTES),
  options: optionsSchema,
});

function safeFilename(name: string): string {
  return name.replace(/[\\/\0\r\n]/g, "_").slice(0, 255);
}

async function adminClient() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

async function releaseReservation(
  admin: any,
  userId: string,
  jobId: string,
  reason: string,
) {
  const { error } = await admin.rpc("turnitin_release_reserved_credit", {
    _user_id: userId,
    _job_id: jobId,
    _reason: reason,
  });
  if (error) throw new Error(error.message);
}

async function removeSource(admin: any, path: string | null | undefined) {
  if (!path) return;
  await admin.storage.from(SOURCE_BUCKET).remove([path]);
}

async function markExplicitPreAcceptanceFailure(
  admin: any,
  userId: string,
  jobId: string,
  sourcePath: string | null,
  error: unknown,
) {
  try {
    await releaseReservation(
      admin,
      userId,
      jobId,
      error instanceof Error ? error.message : "Upstream submission failed.",
    );
  } finally {
    await admin
      .from("turnitin_jobs")
      .update({
        status: "failed",
        failed_at: new Date().toISOString(),
        failure_code:
          error instanceof OriginalityAdapterError
            ? error.code
            : "SUBMISSION_FAILED",
        failure_message:
          error instanceof Error ? error.message : "Submission failed.",
        upstream_last_error:
          error instanceof Error ? error.message : "Submission failed.",
      })
      .eq("id", jobId)
      .eq("user_id", userId);
    await removeSource(admin, sourcePath);
  }
}

export const createTurnitinUploadIntent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => intentInput.parse(input))
  .handler(async ({ data, context }) => {
    const ext = ACCEPTED_MIME.get(data.mimeType);
    if (!ext) {
      throw new Error("Use a PDF, DOC or DOCX file.");
    }

    const admin = await adminClient();

    // Fail before reserving a local credit when the provider session is stale
    // or the prepaid master account has no upstream slots.
    const upstream = await testStoredOriginalitySession(admin);
    if (upstream.availableSlots != null && upstream.availableSlots <= 0) {
      throw new Error(
        "Turnitin checks are temporarily unavailable because the upstream check balance is empty.",
      );
    }

    const jobId = randomUUID();
    const uploadToken = randomUUID();
    const originalFilename = safeFilename(data.filename);
    const sourcePath = `${context.userId}/${jobId}/source.${ext}`;

    const { error: jobError } = await admin.from("turnitin_jobs").insert({
      id: jobId,
      user_id: context.userId,
      original_filename: originalFilename,
      display_name: data.options.reportTitle?.trim() || originalFilename,
      mime_type: data.mimeType,
      file_size_bytes: data.sizeBytes,
      source_storage_bucket: SOURCE_BUCKET,
      source_storage_path: sourcePath,
      status: "uploading",
      upstream_upload_token: uploadToken,
      exclude_bibliography: data.options.excludeBibliography,
      exclude_quotes: data.options.excludeQuotes,
      exclude_citations: data.options.excludeCitations,
      exclude_small_matches: data.options.excludeSmallMatches,
      small_match_mode: data.options.smallMatchMode,
      small_match_threshold: data.options.excludeSmallMatches
        ? data.options.smallMatchThreshold ?? null
        : null,
      report_view: data.options.reportView,
      report_format: data.options.reportFormat ?? null,
      report_title: data.options.reportTitle?.trim() || originalFilename,
      author_first_name: data.options.authorFirstName?.trim() || null,
      author_last_name: data.options.authorLastName?.trim() || null,
    });
    if (jobError) throw new Error(jobError.message);

    const { error: reserveError } = await admin.rpc("turnitin_reserve_credit", {
      _user_id: context.userId,
      _job_id: jobId,
    });
    if (reserveError) {
      await admin.from("turnitin_jobs").delete().eq("id", jobId);
      if (/TURNITIN_NO_CREDIT/i.test(reserveError.message)) {
        throw new Error("You do not have an available Turnitin check credit.");
      }
      throw new Error(reserveError.message);
    }

    try {
      const { data: signed, error: signedError } = await admin.storage
        .from(SOURCE_BUCKET)
        .createSignedUploadUrl(sourcePath);
      if (signedError || !signed?.token) {
        throw new Error(
          signedError?.message ?? "Could not prepare the document upload.",
        );
      }

      return {
        jobId,
        bucket: SOURCE_BUCKET,
        path: sourcePath,
        token: String(signed.token),
      };
    } catch (error) {
      await releaseReservation(
        admin,
        context.userId,
        jobId,
        "Could not prepare the private source upload.",
      );
      await admin.from("turnitin_jobs").delete().eq("id", jobId);
      throw error;
    }
  });

const jobIdInput = z.object({
  jobId: z.string().uuid(),
});

export const cancelTurnitinUpload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      jobId: z.string().uuid(),
      reason: z.string().trim().max(500).optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const admin = await adminClient();
    const { data: job, error } = await admin
      .from("turnitin_jobs")
      .select(
        "id, user_id, credit_state, upstream_submission_id, source_storage_path, status",
      )
      .eq("id", data.jobId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!job) throw new Error("Turnitin job not found.");
    if (job.upstream_submission_id || job.credit_state === "consumed") {
      throw new Error("This check was already accepted and can no longer be cancelled.");
    }

    if (job.credit_state === "reserved") {
      await releaseReservation(
        admin,
        context.userId,
        job.id,
        data.reason || "Customer source upload was cancelled.",
      );
    }
    await removeSource(admin, job.source_storage_path);
    await admin
      .from("turnitin_jobs")
      .update({
        status: "failed",
        failed_at: new Date().toISOString(),
        failure_code: "UPLOAD_CANCELLED",
        failure_message: data.reason || "Document upload was cancelled.",
      })
      .eq("id", job.id);

    return { ok: true };
  });

export const submitTurnitinJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => jobIdInput.parse(input))
  .handler(async ({ data, context }) => {
    const admin = await adminClient();
    const { data: job, error } = await admin
      .from("turnitin_jobs")
      .select("*")
      .eq("id", data.jobId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!job) throw new Error("Turnitin job not found.");

    // If upstream acceptance happened but local finalisation previously failed,
    // never upload again. Finalise the same accepted submission instead.
    if (job.upstream_submission_id) {
      if (job.credit_state === "reserved") {
        const { error: consumeError } = await admin.rpc(
          "turnitin_consume_reserved_credit",
          {
            _user_id: context.userId,
            _job_id: job.id,
            _upstream_submission_id: String(job.upstream_submission_id),
          },
        );
        if (consumeError) throw new Error(consumeError.message);
      }
      return {
        ok: true,
        jobId: job.id,
        submissionId: String(job.upstream_submission_id),
        status: "queued" as const,
      };
    }

    if (job.credit_state !== "reserved") {
      throw new Error("This Turnitin check does not have a reserved credit.");
    }
    if (!job.source_storage_path || !job.upstream_upload_token) {
      await markExplicitPreAcceptanceFailure(
        admin,
        context.userId,
        job.id,
        job.source_storage_path,
        new Error("Turnitin job is missing its source file or upload token."),
      );
      throw new Error("Turnitin job is incomplete.");
    }

    const { data: sourceBlob, error: downloadError } = await admin.storage
      .from(SOURCE_BUCKET)
      .download(job.source_storage_path);
    if (downloadError || !sourceBlob) {
      const failure = new Error(
        downloadError?.message ?? "The uploaded document could not be read.",
      );
      await markExplicitPreAcceptanceFailure(
        admin,
        context.userId,
        job.id,
        job.source_storage_path,
        failure,
      );
      throw failure;
    }

    const bytes = new Uint8Array(await sourceBlob.arrayBuffer());

    try {
      const result = await submitOriginalityDocument(admin, {
        filename: String(job.original_filename),
        mimeType: String(job.mime_type),
        bytes,
        uploadToken: String(job.upstream_upload_token),
        excludeBibliography: !!job.exclude_bibliography,
        excludeQuotes: !!job.exclude_quotes,
        excludeCitations: !!job.exclude_citations,
        excludeSmallMatches: !!job.exclude_small_matches,
        smallMatchMode:
          job.small_match_mode === "percent" ? "percent" : "words",
        smallMatchThreshold:
          job.small_match_threshold == null
            ? null
            : Number(job.small_match_threshold),
        reportView: job.report_view === "sources" ? "sources" : "match_groups",
        reportFormat: job.report_format,
        reportTitle: job.report_title || job.original_filename,
        authorFirstName: job.author_first_name,
        authorLastName: job.author_last_name,
        folderId: null,
      });

      const acceptedAt = new Date().toISOString();

      // Record acceptance before consuming the local reservation. If the RPC
      // fails, a retry sees this submission ID and only finalises credit state.
      const { error: acceptanceError } = await admin
        .from("turnitin_jobs")
        .update({
          upstream_submission_id: result.submissionId,
          upstream_status: "queued",
          status: "queued",
          accepted_at: acceptedAt,
          submitted_at: acceptedAt,
          upstream_last_error: null,
        })
        .eq("id", job.id)
        .eq("user_id", context.userId);
      if (acceptanceError) throw new Error(acceptanceError.message);

      const { error: consumeError } = await admin.rpc(
        "turnitin_consume_reserved_credit",
        {
          _user_id: context.userId,
          _job_id: job.id,
          _upstream_submission_id: result.submissionId,
        },
      );
      if (consumeError) {
        throw new Error(
          `Upstream accepted the document but local credit finalisation failed: ${consumeError.message}`,
        );
      }

      // The provider now owns the accepted source; remove our private copy.
      await removeSource(admin, job.source_storage_path);
      await admin
        .from("turnitin_jobs")
        .update({
          source_storage_path: null,
          upstream_last_error: null,
        })
        .eq("id", job.id);

      return {
        ok: true,
        jobId: job.id,
        submissionId: result.submissionId,
        status: "queued" as const,
      };
    } catch (error) {
      // A network failure after all same-token retries is ambiguous: the
      // provider may have accepted the request but the response was lost.
      // Preserve both the source file and reserved credit so a retry reuses
      // the same upload_token and can never burn a second upstream slot.
      if (
        error instanceof OriginalityAdapterError &&
        error.code === "NETWORK_ERROR"
      ) {
        await admin
          .from("turnitin_jobs")
          .update({
            status: "uploading",
            upstream_last_error: error.message,
          })
          .eq("id", job.id);
        throw new Error(
          "The connection to Originality Reports was interrupted. Retry this check; the same protected upload token will be reused.",
        );
      }

      // If an upstream ID was recorded before a later local failure, do not
      // release credit; the next retry will finalise that same submission.
      const { data: latest } = await admin
        .from("turnitin_jobs")
        .select("upstream_submission_id")
        .eq("id", job.id)
        .maybeSingle();
      if (latest?.upstream_submission_id) {
        await admin
          .from("turnitin_jobs")
          .update({
            upstream_last_error:
              error instanceof Error ? error.message : "Local finalisation failed.",
          })
          .eq("id", job.id);
        throw error;
      }

      await markExplicitPreAcceptanceFailure(
        admin,
        context.userId,
        job.id,
        job.source_storage_path,
        error,
      );
      throw error;
    }
  });

function mapLocalStatus(
  upstreamStatus: string,
  hasSimilarity: boolean,
  aiSettled: boolean,
): "queued" | "processing" | "completed" | "failed" {
  const status = upstreamStatus.toLowerCase();
  if (status === "failed") return "failed";
  if (status === "queued" || status === "pending") return "queued";
  if (
    status === "completed" ||
    status === "manual_completed"
  ) {
    return hasSimilarity && aiSettled ? "completed" : "processing";
  }
  return "processing";
}

async function storeReport(
  admin: any,
  userId: string,
  jobId: string,
  submissionId: string,
  type: "similarity" | "ai",
  score: number | null,
) {
  const path = `${userId}/${jobId}/${type}.pdf`;
  try {
    const bytes = await downloadOriginalityReport(
      admin,
      submissionId,
      type,
    );
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const { error: uploadError } = await admin.storage
      .from(REPORT_BUCKET)
      .upload(path, bytes, {
        contentType: "application/pdf",
        upsert: true,
      });
    if (uploadError) throw new Error(uploadError.message);

    const { error: rowError } = await admin.from("turnitin_reports").upsert(
      {
        user_id: userId,
        job_id: jobId,
        report_type: type,
        status: "available",
        score,
        storage_bucket: REPORT_BUCKET,
        storage_path: path,
        mime_type: "application/pdf",
        file_size_bytes: bytes.byteLength,
        sha256,
        unavailable_reason: null,
        available_at: new Date().toISOString(),
      },
      { onConflict: "job_id,report_type" },
    );
    if (rowError) throw new Error(rowError.message);
    return true;
  } catch (error) {
    await admin.from("turnitin_reports").upsert(
      {
        user_id: userId,
        job_id: jobId,
        report_type: type,
        status: "failed",
        score,
        unavailable_reason:
          error instanceof Error ? error.message : "Report download failed.",
      },
      { onConflict: "job_id,report_type" },
    );
    return false;
  }
}

async function syncOneJob(admin: any, userId: string, job: any) {
  if (!job.upstream_submission_id || job.credit_state !== "consumed") {
    return;
  }

  const now = new Date().toISOString();
  try {
    const upstream = await getOriginalitySubmissionStatus(
      admin,
      String(job.upstream_submission_id),
    );

    if (!upstream) {
      await admin
        .from("turnitin_jobs")
        .update({
          upstream_last_checked_at: now,
          upstream_sync_attempts: Number(job.upstream_sync_attempts ?? 0) + 1,
        })
        .eq("id", job.id);
      return;
    }

    const aiUnavailableReason =
      upstream.aiUnavailableReason ||
      (upstream.wordCount != null && upstream.wordCount > 30_000
        ? "AI writing detection is unavailable for documents over 30,000 words."
        : upstream.wordCount != null && upstream.wordCount < 300
          ? "AI writing detection requires at least 300 words of prose."
          : null);

    if (upstream.status === "failed") {
      const { error: refundError } = await admin.rpc(
        "turnitin_refund_consumed_credit",
        {
          _user_id: userId,
          _job_id: job.id,
          _reason:
            upstream.refundReason ||
            "Originality Reports marked the accepted job as failed.",
        },
      );
      if (refundError && !/ALREADY_REFUNDED/i.test(refundError.message)) {
        throw new Error(refundError.message);
      }

      await admin
        .from("turnitin_jobs")
        .update({
          status: "failed",
          upstream_status: upstream.status,
          similarity_percentage: upstream.similarityPercentage,
          ai_percentage: upstream.aiPercentage,
          ai_unavailable_reason: aiUnavailableReason,
          word_count: upstream.wordCount,
          failed_at: now,
          failure_code: "UPSTREAM_FAILED",
          failure_message:
            upstream.refundReason ||
            "Originality Reports marked this check as failed.",
          upstream_last_checked_at: now,
          upstream_sync_attempts: Number(job.upstream_sync_attempts ?? 0) + 1,
          upstream_last_error: null,
        })
        .eq("id", job.id);
      return;
    }

    let similarityStored = false;
    let aiStored = false;

    const { data: currentReports } = await admin
      .from("turnitin_reports")
      .select("report_type, status, storage_path")
      .eq("job_id", job.id);

    const similarityCurrent = (currentReports ?? []).find(
      (r: any) => r.report_type === "similarity",
    );
    const aiCurrent = (currentReports ?? []).find(
      (r: any) => r.report_type === "ai",
    );

    if (similarityCurrent?.status === "available" && similarityCurrent.storage_path) {
      similarityStored = true;
    } else if (upstream.similarityReportExists) {
      similarityStored = await storeReport(
        admin,
        userId,
        job.id,
        String(job.upstream_submission_id),
        "similarity",
        upstream.similarityPercentage,
      );
    }

    if (aiUnavailableReason) {
      const { error: aiUnavailableError } = await admin
        .from("turnitin_reports")
        .upsert(
          {
            user_id: userId,
            job_id: job.id,
            report_type: "ai",
            status: "unavailable",
            score: null,
            storage_bucket: null,
            storage_path: null,
            unavailable_reason: aiUnavailableReason,
            available_at: null,
          },
          { onConflict: "job_id,report_type" },
        );
      if (aiUnavailableError) throw new Error(aiUnavailableError.message);
      aiStored = true;
    } else if (aiCurrent?.status === "available" && aiCurrent.storage_path) {
      aiStored = true;
    } else if (upstream.aiReportExists) {
      aiStored = await storeReport(
        admin,
        userId,
        job.id,
        String(job.upstream_submission_id),
        "ai",
        upstream.aiPercentage,
      );
    }

    const localStatus = mapLocalStatus(
      upstream.status,
      similarityStored,
      aiStored,
    );

    await admin
      .from("turnitin_jobs")
      .update({
        status: localStatus,
        upstream_status: upstream.status,
        similarity_percentage: upstream.similarityPercentage,
        ai_percentage: upstream.aiPercentage,
        ai_unavailable_reason: aiUnavailableReason,
        word_count: upstream.wordCount,
        completed_at: localStatus === "completed" ? now : null,
        upstream_last_checked_at: now,
        upstream_sync_attempts: Number(job.upstream_sync_attempts ?? 0) + 1,
        upstream_last_error: null,
      })
      .eq("id", job.id);
  } catch (error) {
    await admin
      .from("turnitin_jobs")
      .update({
        upstream_last_checked_at: now,
        upstream_sync_attempts: Number(job.upstream_sync_attempts ?? 0) + 1,
        upstream_last_error:
          error instanceof Error ? error.message : "Status synchronization failed.",
      })
      .eq("id", job.id);
    throw error;
  }
}

export const syncMyTurnitinJobs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const admin = await adminClient();
    const { data: jobs, error } = await admin
      .from("turnitin_jobs")
      .select("*")
      .eq("user_id", context.userId)
      .in("status", ["queued", "processing"])
      .order("created_at", { ascending: true })
      .limit(10);
    if (error) throw new Error(error.message);

    let synced = 0;
    const errors: string[] = [];
    for (const job of jobs ?? []) {
      try {
        await syncOneJob(admin, context.userId, job);
        synced++;
      } catch (error) {
        errors.push(error instanceof Error ? error.message : "Sync failed.");
      }
    }

    return { ok: true, synced, errors };
  });

export const retryTurnitinJob = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => jobIdInput.parse(input))
  .handler(async ({ data, context }) => {
    const admin = await adminClient();
    const { data: job, error } = await admin
      .from("turnitin_jobs")
      .select("id, user_id, status, credit_state, upstream_submission_id")
      .eq("id", data.jobId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!job) throw new Error("Turnitin job not found.");

    if (job.upstream_submission_id && job.credit_state === "consumed") {
      await syncOneJob(admin, context.userId, job);
      return { ok: true, action: "synced" as const };
    }

    if (job.credit_state !== "reserved") {
      throw new Error("This check no longer has a reserved credit to retry.");
    }

    // Client calls submitTurnitinJob next; keeping retry separate makes the
    // history UI explicit without duplicating orchestration here.
    return { ok: true, action: "resubmit" as const };
  });
