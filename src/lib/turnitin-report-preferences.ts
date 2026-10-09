import { z } from "zod";

export const turnitinReportPreferencesSchema = z.object({
  compareInternet: z.boolean(),
  comparePublications: z.boolean(),
  compareSubmittedWorks: z.boolean(),
  excludeSmallMatches: z.boolean(),
  excludeBibliography: z.boolean(),
  excludeQuotes: z.boolean(),
  excludeCitations: z.boolean(),
  smallMatchMode: z.enum(["words", "percent"]),
  smallMatchThreshold: z.number().int(),
  reportView: z.enum(["sources", "match_groups"]),
  useFilenamePrefixes: z.boolean(),
  aiReportPrefix: z.string().max(40).regex(/^[^\\/<>:"|?*\\u0000-\\u001f\\u007f]*$/u, "Invalid file name prefix."),
  similarityReportPrefix: z.string().max(40).regex(/^[^\\/<>:"|?*\\u0000-\\u001f\\u007f]*$/u, "Invalid file name prefix."),
}).superRefine((v, ctx) => {
  if (!v.compareInternet && !v.comparePublications && !v.compareSubmittedWorks) {
    ctx.addIssue({ code: "custom", message: "Select at least one comparison collection.", path: ["compareInternet"] });
  }
  const [lo, hi] = v.smallMatchMode === "percent" ? [1, 50] : [8, 200];
  if (v.smallMatchThreshold < lo || v.smallMatchThreshold > hi) {
    ctx.addIssue({ code: "custom", message: `Small-match threshold must be ${lo}–${hi} ${v.smallMatchMode === "words" ? "words" : "%"}.`, path: ["smallMatchThreshold"] });
  }
});
export type TurnitinReportPreferences = z.infer<typeof turnitinReportPreferencesSchema>;
export const DEFAULT_TURNITIN_REPORT_PREFERENCES: TurnitinReportPreferences = {
  compareInternet: true,
  comparePublications: true,
  compareSubmittedWorks: true,
  excludeSmallMatches: false,
  excludeBibliography: true,
  excludeQuotes: true,
  excludeCitations: false,
  smallMatchMode: "words",
  smallMatchThreshold: 8,
  reportView: "sources",
  useFilenamePrefixes: true,
  aiReportPrefix: "AI_",
  similarityReportPrefix: "si_",
};

export function prefsFromRow(row: Record<string, unknown> | null | undefined): TurnitinReportPreferences {
  if (!row) return { ...DEFAULT_TURNITIN_REPORT_PREFERENCES };
  return turnitinReportPreferencesSchema.parse({
    compareInternet: row.compare_internet,
    comparePublications: row.compare_publications,
    compareSubmittedWorks: row.compare_submitted_works,
    excludeSmallMatches: row.exclude_small_matches,
    excludeBibliography: row.exclude_bibliography,
    excludeQuotes: row.exclude_quotes,
    excludeCitations: row.exclude_citations,
    smallMatchMode: row.small_match_mode,
    smallMatchThreshold: row.small_match_threshold,
    reportView: row.report_view,
    useFilenamePrefixes: row.use_filename_prefixes,
    aiReportPrefix: row.ai_report_prefix,
    similarityReportPrefix: row.similarity_report_prefix,
  });
}
export function prefsToRow(p: TurnitinReportPreferences) {
  return {
    compare_internet: p.compareInternet,
    compare_publications: p.comparePublications,
    compare_submitted_works: p.compareSubmittedWorks,
    exclude_small_matches: p.excludeSmallMatches,
    exclude_bibliography: p.excludeBibliography,
    exclude_quotes: p.excludeQuotes,
    exclude_citations: p.excludeCitations,
    small_match_mode: p.smallMatchMode,
    small_match_threshold: p.smallMatchThreshold,
    report_view: p.reportView,
    use_filename_prefixes: p.useFilenamePrefixes,
    ai_report_prefix: p.aiReportPrefix,
    similarity_report_prefix: p.similarityReportPrefix,
  };
}

export function reportDownloadFilename(
  originalFilename: string,
  reportType: "ai" | "similarity",
  prefs: Pick<TurnitinReportPreferences, "useFilenamePrefixes" | "aiReportPrefix" | "similarityReportPrefix">,
): string {
  const leaf = String(originalFilename || "report").split(/[\\/]/).pop() || "report";
  const stem = leaf.replace(/\\.[^.]+$/, "").replace(/[\\u0000-\\u001f\\u007f"<>:|?*]/g, "_").trim().slice(0, 180) || "report";
  const prefix = !prefs.useFilenamePrefixes ? "" : reportType === "ai" ? prefs.aiReportPrefix : prefs.similarityReportPrefix;
  return `${prefix}${stem}.pdf`;
}
