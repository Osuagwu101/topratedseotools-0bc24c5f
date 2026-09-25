/**
 * Phrasly is moving to the same server-side proxy architecture used by
 * StealthWriter, but with one upstream Phrasly account.
 *
 * Phase 1 deliberately blocks every legacy remote-browser entry point so a
 * Phrasly launch can never fall back to Browser Use or Cloudflare while the
 * encrypted session vault and proxy are added in later phases.
 */
export const PHRASLY_TOOL_SLUG = "phrasly";

export const PHRASLY_PROXY_SETUP_MESSAGE =
  "Phrasly is temporarily unavailable while Admin completes the new secure session setup.";

export function isPhraslyToolSlug(value: unknown): boolean {
  return String(value ?? "").trim().toLowerCase() === PHRASLY_TOOL_SLUG;
}

export function blockLegacyPhraslyBrowserFlow(toolSlug: unknown): void {
  if (isPhraslyToolSlug(toolSlug)) {
    throw new Error(PHRASLY_PROXY_SETUP_MESSAGE);
  }
}
