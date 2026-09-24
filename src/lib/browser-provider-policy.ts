export type SessionBrowserProvider = "browser_use" | "cloudflare";

/**
 * The self-hosted browser runtime was retired. Persisted legacy values are
 * deliberately ignored so the site falls back to its managed browser provider.
 */
export function validSessionBrowserProvider(value: unknown): SessionBrowserProvider | null {
  return value === "browser_use" || value === "cloudflare" ? value : null;
}

export function resolveSessionBrowserProvider(
  toolOverride: unknown,
  globalDefault: unknown,
): SessionBrowserProvider {
  return (
    validSessionBrowserProvider(toolOverride) ??
    validSessionBrowserProvider(globalDefault) ??
    "browser_use"
  );
}

export function resolveAdminSecureLoginProvider(
  toolOverride: unknown,
  globalDefault: unknown,
): SessionBrowserProvider {
  if (toolOverride !== null && toolOverride !== undefined && toolOverride !== "") {
    const provider = validSessionBrowserProvider(toolOverride);
    if (!provider) {
      return validSessionBrowserProvider(globalDefault) ?? "browser_use";
    }
    return provider;
  }
  return validSessionBrowserProvider(globalDefault) ?? "browser_use";
}

export function usesWebsiteSavedBrowserState(_provider: SessionBrowserProvider) {
  return true;
}

export const SELF_HOSTED_BROWSER_TOOLS: readonly string[] = [];

export function supportsSelfHostedBrowser(_toolSlug: unknown): boolean {
  return false;
}
