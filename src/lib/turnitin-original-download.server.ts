/** Return a short-lived attachment link only for an authenticated owner's original. */
export async function prepareTurnitinOriginalDownload(db: any, admin: any, userId: string, jobId: string) {
  const { data: job, error } = await db.from("turnitin_jobs")
    .select("id, user_id, original_filename, source_storage_bucket, source_storage_path, history_deleted_at")
    .eq("id", jobId).eq("user_id", userId).is("history_deleted_at", null).maybeSingle();
  if (error) throw new Error("Could not find this submission. Please try again.");
  if (!job || job.user_id !== userId || job.history_deleted_at)
    throw new Error("Submission not found.");
  if (job.source_storage_bucket !== "turnitin-source" || !job.source_storage_path ||
      !String(job.source_storage_path).startsWith(`${userId}/${jobId}/`))
    throw new Error("The original file is no longer available for this check.");
  const filename = String(job.original_filename || "submission").replace(/[\\/\0\r\n]/g, "_").slice(0, 255);
  const { data: signed, error: storageError } = await admin.storage.from("turnitin-source")
    .createSignedUrl(job.source_storage_path, 60, { download: filename });
  if (storageError || !signed?.signedUrl)
    throw new Error("The original file is unavailable. If your upload is still running, wait for it to finish and try again.");
  return { url: signed.signedUrl as string, filename };
}
