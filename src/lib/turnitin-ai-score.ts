/**
 * Originality.report can return a masked AI percentage (*%) rather than
 * a numeric score. This marker is not 0%, and does not mean the report failed.
 */
export const ORIGINALITY_ASTERISK_PERCENT = "*%" as const;

export function isOriginalityAsteriskPercent(value: unknown): boolean {
  return typeof value === "string" && /^\s*\*\s*%?\s*$/.test(value);
}

export function shouldShowOriginalityAsteriskPercent({
  aiPercentage,
  aiUnavailableReason,
  jobStatus,
  aiReportAvailable,
}: {
  aiPercentage: number | null;
  aiUnavailableReason: string | null;
  jobStatus: string;
  aiReportAvailable: boolean;
}): boolean {
  if (aiPercentage != null) return false;
  // New checks retain the exact upstream marker in the existing text field.
  if (isOriginalityAsteriskPercent(aiUnavailableReason)) return true;

  // Older checks lost the non-numeric upstream marker while synchronizing.
  // Only recover it when a completed check has a downloadable AI report and
  // no actual "unavailable" reason; pending/failed jobs remain unchanged.
  return (
    jobStatus === "completed" &&
    aiReportAvailable &&
    !aiUnavailableReason
  );
}
