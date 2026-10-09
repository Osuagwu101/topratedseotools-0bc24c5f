/* Customer-owned interactive Originality report viewing.
 * Every action is tied to the authenticated customer's TRST job.
 * The upstream Originality session and its credentials stay server-side.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash, randomUUID } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { OriginalityViewerFilters } from "@/lib/turnitin-originality.server";

const jobInput = z.object({ jobId: z.string().uuid() });
const filterInput = jobInput.extend({
  filters: z.object({
    collections: z.array(z.enum(["internet", "publication", "submitted_work"])).min(1).max(3).refine(
      (arr) => new Set(arr).size === arr.length, "Choose unique source collections.",
    ),
    exclude_bibliography: z.boolean(),
    exclude_quotes: z.boolean(),
    exclude_citations: z.boolean(),
    small_matches: z.object({
      enabled: z.boolean(),
      mode: z.enum(["words", "percent"]),
      threshold: z.number().int().min(1).max(250),
    }),
  }).superRefine((v, ctx) => {
    if (!v.small_matches.enabled) return;
    const n = v.small_matches.threshold;
    const [lo, hi] = v.small_matches.mode === "words" ? [8, 250] : [1, 50];
    if (n < lo || n > hi) ctx.addIssue({
      code: "custom",
      path: ["small_matches", "threshold"],
      message: `Small matches must be between ${lo} and ${hi}.`,
    });
  }),
});
const pageInput = jobInput.extend({ pageIndex: z.number().int().min(0).max(400) });

async function requireOwnedViewerJob(db: any, userId: string, jobId: string) {
  const { data: job, error } = await db.from("turnitin_jobs")
    .select("id, user_id, display_name, original_filename, upstream_submission_id, similarity_percentage, status, history_deleted_at")
    .eq("id", jobId).eq("user_id", userId)
    .is("history_deleted_at", null).maybeSingle();
  if (error || !job) throw new Error("Report not found or not accessible.");
  if (job.status !== "completed" || !/^\d{1,20}$/.test(String(job.upstream_submission_id ?? ""))) {
    throw new Error("The interactive report is not ready yet.");
  }
  return job;
}

export const getMyTurnitinInteractiveReport = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => jobInput.parse(data))
  .handler(async ({ context, data }) => {
    const job = await requireOwnedViewerJob(context.supabase, context.userId, data.jobId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getOriginalityViewerData } = await import("@/lib/turnitin-originality.server");
    const upstream = await getOriginalityViewerData(supabaseAdmin as any, String(job.upstream_submission_id));
    const raw = upstream as any;
    const similarity = raw.similarity ?? {};
    const exclusions = raw.exclusions ?? {};
    return {
      jobId: job.id as string,
      title: String(job.display_name || job.original_filename),
      filename: String(job.original_filename),
      wordCount: Number(raw.wordCount ?? 0),
      pageCount: Number(raw.pageCount ?? 0),
      pages: (Array.isArray(raw.pages) ? raw.pages : []).slice(0, 200).map((p: any) => ({
        index: Number(p.index),
        width: Number(p.width),
        height: Number(p.height),
      })),
      aiPercentage: raw.ai?.percent == null ? null : Number(raw.ai.percent),
      similarity: {
        overallPercent: Number(similarity.overallPercent ?? job.similarity_percentage ?? 0),
        matchedWords: Number(similarity.matchedWords ?? 0),
        totalWords: Number(similarity.totalWords ?? raw.wordCount ?? 0),
        sources: (Array.isArray(similarity.sources) ? similarity.sources : []).slice(0, 500).map((s: any) => ({
          index: Number(s.index),
          number: Number(s.number),
          collection: String(s.collection ?? "internet"),
          url: String(s.url ?? "").slice(0, 700),
          linkText: String(s.linkText ?? "").slice(0, 700),
          percent: Number(s.percent ?? 0),
          matchedWords: Number(s.matchedWords ?? 0),
          matches: (Array.isArray(s.matches) ? s.matches : []).slice(0, 3000).map((m: any) => ({
            id: String(m.id),
            group: String(m.group ?? "not_cited_or_quoted"),
            page: Number(m.page ?? 0),
            words: Number(m.words ?? 0),
            charStart: Number(m.charStart ?? 0),
            charEnd: Number(m.charEnd ?? 0),
            cited: !!m.cited,
            quoted: !!m.quoted,
            inBibliography: m.inBibliography === true,
            rects: (Array.isArray(m.rects) ? m.rects : []).slice(0, 200).filter((rect: unknown) =>
              Array.isArray(rect) && rect.length === 4 && rect.every(v => typeof v === "number" && Number.isFinite(v)),
            ),
          })),
        })),
        matchGroupSummary: similarity.matchGroupSummary ?? {},
      },
      exclusions: {
        sources: Array.isArray(exclusions.sources) ? exclusions.sources.map(Number).filter(Number.isFinite).slice(0, 500) : [],
        matches: Array.isArray(exclusions.matches) ? exclusions.matches.map(String).slice(0, 3000) : [],
        filters: exclusions.filters as OriginalityViewerFilters,
      },
    };
  });

export const getMyTurnitinViewerPageImage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => pageInput.parse(data))
  .handler(async ({ context, data }) => {
    const job = await requireOwnedViewerJob(context.supabase, context.userId, data.jobId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { getOriginalityViewerPage } = await import("@/lib/turnitin-originality.server");
    const page = await getOriginalityViewerPage(supabaseAdmin as any, String(job.upstream_submission_id), data.pageIndex);
    return {
      imageDataUrl: `data:${page.contentType};base64,${Buffer.from(page.bytes).toString("base64")}`,
    };
  });

export const applyMyTurnitinViewerFilters = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => filterInput.parse(input))
  .handler(async ({ context, data }) => {
    const db = context.supabase as any;
    const job = await requireOwnedViewerJob(db, context.userId, data.jobId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any;
    const { getOriginalityViewerData, setOriginalityViewerFilters, downloadOriginalityViewerSimilarityPdf } =
      await import("@/lib/turnitin-originality.server");
    const id = String(job.upstream_submission_id);
    const current = await getOriginalityViewerData(admin, id);
    const prev = current.exclusions ?? {};
    const sources = Array.isArray(prev.sources) ? prev.sources.map(Number).filter(Number.isFinite) : [];
    const matches = Array.isArray(prev.matches) ? prev.matches.map(String) : [];
    // Preserve any source- or match-level exclusions already made upstream.
    await setOriginalityViewerFilters(admin, id, {
      sources, matches,
      filters: data.filters,
    });
    // The live viewer's download endpoint regenerates the similarity PDF with
    // applied filters. Replace the stored TRST PDF only after full validation.
    let pdfUpdated = false;
    let warning: string | null = null;
    try {
      const bytes = await downloadOriginalityViewerSimilarityPdf(admin, id);
      const { data: report, error: lookupError } = await admin.from("turnitin_reports")
        .select("id, storage_path")
        .eq("job_id", job.id).eq("user_id", context.userId)
        .eq("report_type", "similarity").eq("status", "available").maybeSingle();
      if (lookupError || !report) throw new Error("Existing similarity PDF was not found.");
      const path = `${context.userId}/${job.id}/similarity-filtered-${Date.now()}-${randomUUID()}.pdf`;
      const bucket = admin.storage.from("turnitin-reports");
      const { error: uploadError } = await bucket.upload(path, bytes, {
        contentType: "application/pdf", upsert: false,
      });
      if (uploadError) throw new Error("Could not store the updated similarity PDF.");
      const { error: updateError } = await admin.from("turnitin_reports")
        .update({
          storage_path: path,
          storage_bucket: "turnitin-reports",
          file_size_bytes: bytes.byteLength,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          available_at: new Date().toISOString(),
        })
        .eq("id", report.id).eq("user_id", context.userId);
      if (updateError) {
        await bucket.remove([path]);
        throw new Error("Could not update the report download.");
      }
      pdfUpdated = true;
      if (report.storage_path && report.storage_path !== path) {
        const { error: cleanupError } = await bucket.remove([report.storage_path]);
        if (cleanupError) console.error("[Turnitin viewer] Obsolete report cleanup failed:", cleanupError.message);
      }
    } catch (error) {
      console.error("[Turnitin viewer] Filtered PDF refresh failed:", error instanceof Error ? error.message : "Unknown");
      warning = "Filters were applied to the interactive report, but the downloaded PDF could not be refreshed. Please try again later.";
    }
    return { applied: true, pdfUpdated, warning };
  });
