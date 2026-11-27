/** A UI attachment key is not necessarily a provider file identifier. */
export function providerFileId(value: unknown): string | undefined {
  return typeof value === "string" && /^file[-_][A-Za-z0-9_-]{1,200}$/.test(value)
    ? value
    : undefined;
}

/** Check every provider reference; never let one owned ID conceal a foreign ID. */
export function attachmentFileIds(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const a = value as Record<string, unknown>;
  return [...new Set([providerFileId(a.file_id), providerFileId(a.id)].filter(
    (id): id is string => !!id,
  ))];
}

/** Register only an ID returned by a successful, writer-scoped upload creation. */
export function createdUploadFileId(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const info = value as Record<string, unknown>;
  const ids = attachmentFileIds(info);
  return ids.length === 1 ? ids[0] : undefined;
}
