/**
 * Tools whose browser authentication is owned exclusively by administrators.
 * Writer/customer launch paths may only consume a previously saved READY state.
 */
export const ADMIN_MANAGED_SHARED_AUTH_TOOLS = new Set(["phrasly"]);

export function requiresAdminManagedSharedAuth(toolSlug: string): boolean {
  return ADMIN_MANAGED_SHARED_AUTH_TOOLS.has(toolSlug.trim().toLowerCase());
}

export const ADMIN_REAUTH_REQUIRED_MESSAGE =
  "Phrasly access is temporarily unavailable while an administrator refreshes authentication.";

export function resolveSharedAuthLandingUrl(
  toolSlug: string,
  configuredLoginUrl: string,
): string {
  if (!requiresAdminManagedSharedAuth(toolSlug)) return configuredLoginUrl;

  const url = new URL(configuredLoginUrl);
  if (toolSlug.trim().toLowerCase() === "phrasly") {
    url.pathname = "/dashboard";
    url.search = "";
    url.hash = "";
  }
  return url.toString();
}
