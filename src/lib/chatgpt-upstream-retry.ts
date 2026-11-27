/*
 * Retry brief network failures between the server and ChatGPT before showing
 * writers the "Access Needs Attention" page (reference GPT-04).
 *
 * Reads (GET/HEAD) are always safe to resend. Anything else (for example
 * sending a message) is resent only when the connection was never made, so
 * ChatGPT cannot have received it and nothing is sent twice.
 */

const NEVER_CONNECTED = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
]);

export function networkErrorCode(error: unknown): string | null {
  const e = error as { code?: unknown; cause?: { code?: unknown; cause?: { code?: unknown } } } | null;
  const code = e?.cause?.code ?? e?.cause?.cause?.code ?? e?.code;
  return typeof code === "string" ? code : null;
}

export function isSafeToRetry(method: string, error: unknown): boolean {
  const m = method.toUpperCase();
  if (m === "GET" || m === "HEAD") return true;
  const code = networkErrorCode(error);
  return code !== null && NEVER_CONNECTED.has(code);
}

export const RETRY_DELAYS_MS = [400, 1200];

export async function fetchWithNetworkRetry(
  doFetch: () => Promise<Response>,
  method: string,
  delays: number[] = RETRY_DELAYS_MS,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await doFetch();
    } catch (error) {
      lastError = error;
      if (attempt === delays.length || !isSafeToRetry(method, error)) break;
      await sleep(delays[attempt]);
    }
  }
  throw lastError;
}
