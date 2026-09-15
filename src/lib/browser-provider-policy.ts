export type SessionBrowserProvider = "browser_use" | "cloudflare" | "self_hosted";

export function validSessionBrowserProvider(value: unknown): SessionBrowserProvider | null {
  return value === "browser_use" || value === "cloudflare" || value === "self_hosted"
    ? value
    : null;
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
    if (!provider) throw new Error("The configured secure-login browser provider is not supported.");
    return provider;
  }

  return validSessionBrowserProvider(globalDefault) ?? "browser_use";
}

export function usesWebsiteSavedBrowserState(provider: SessionBrowserProvider) {
  return provider !== "self_hosted";
}

export const SELF_HOSTED_BROWSER_TOOLS = ["phrasly", "stealthwriter", "chatgpt"] as const;

export function supportsSelfHostedBrowser(toolSlug: unknown): boolean {
  return typeof toolSlug === "string" && (SELF_HOSTED_BROWSER_TOOLS as readonly string[]).includes(toolSlug);
}
