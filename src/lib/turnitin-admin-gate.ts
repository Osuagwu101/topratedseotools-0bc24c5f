/** Pure admin-role assertion (testable). Input is the result of rpc("has_role", ...). */
export function assertAdminRole(result: { data: unknown; error: unknown }): void {
  if (result.error || result.data !== true) throw new Error("Administrator access required.");
}
