/**
 * Phase 3 compatibility boundary for old dashboard callers.
 * Ticket issuance and gateway sessions live exclusively in the standalone
 * authentication-only gateway. There is no upstream session adapter here.
 */
export const CHATGPT_PROXY_BASE = "/api/chatgpt-proxy";
export const CHATGPT_LANDING_PATH = "/";
export const CHATGPT_PROXY_COOKIE = "__Host-trst_cg_gateway_v3";
export const CHATGPT_HANDOFF_TTL_SECONDS = 60;
const ORIGIN = "https://chatgpt.topratedseotools.com";

export function chatgptProxyPublicOrigin() { return ORIGIN; }
export function isDedicatedChatGPTProxyRequest(request: Request) {
  return new URL(request.url).origin === ORIGIN;
}
export function readChatGptAppDeviceFingerprint(_request: Request): null {
  return null;
}
export async function createChatGPTProxyLaunch(
  _userId: string,
  _appDeviceFingerprint?: string | null,
): Promise<{ launchUrl: string; handoffExpiresAt: string; proxyPublicOrigin: string }> {
  throw new Error("Reload your dashboard to launch ChatGPT securely.");
}
function legacyUnavailable() {
  return new Response("Reload your dashboard to launch ChatGPT securely.", {
    status: 403,
    headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
}
export function ensureChatGptAppDeviceResponse(_request: Request) {
  return legacyUnavailable();
}
export async function handleChatGPTProxyRequest(_request: Request) {
  return legacyUnavailable();
}