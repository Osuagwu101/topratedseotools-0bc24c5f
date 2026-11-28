/** Native Claude approvals, scoped by the handler to an already-owned chat.
 * Never turn a writer's click into an account-wide permission grant.
 */
export function validateClaudeToolApproval(value: unknown): { status: number; error: string } | { payload: Record<string, unknown> } {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return { status: 400, error: "Invalid tool approval" };
  const p = value as Record<string, unknown>;
  if (Object.keys(p).some(k => !["tool_use_id", "approval_key", "is_approved", "approval_option", "params"].includes(k)) ||
      typeof p.tool_use_id !== "string" || !/^[A-Za-z0-9_-]{1,256}$/.test(p.tool_use_id) ||
      typeof p.is_approved !== "boolean" ||
      (p.approval_key !== undefined && p.approval_key !== null &&
        (typeof p.approval_key !== "string" || p.approval_key.length > 4096 || /[\r\n]/.test(p.approval_key))) ||
      (p.params !== undefined && (!p.params || typeof p.params !== "object" || Array.isArray(p.params))))
    return { status: 400, error: "Invalid tool approval" };
  if (p.approval_option === "always")
    return { status: 403, error: "Choose Allow once. Account-wide tool permissions are managed by Admin." };
  if (p.approval_option !== undefined && !["once", "perChat"].includes(String(p.approval_option)))
    return { status: 400, error: "Invalid tool approval option" };
  if (p.is_approved && p.approval_option === undefined)
    return { status: 400, error: "Choose Allow once for this tool request." };
  return { payload: p };
}
