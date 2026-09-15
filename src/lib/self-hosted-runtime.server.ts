/* Server-only client for the standalone self-hosted browser runtime. */
import { createHash, createHmac, randomBytes } from "node:crypto";

const DEFAULT_RUNTIME_BASE_URL = "https://runtime.topratedseotools.com";
import { supportsSelfHostedBrowser } from "@/lib/browser-provider-policy";

export type SelfHostedLaunch = { provider: "self_hosted"; providerSessionId: string; liveUrl: string; expiresAt: string };

export class SelfHostedAuthenticationNotReadyError extends Error {}

function runtimeConfiguration() {
  const rawBase = (process.env.SELF_HOSTED_BROWSER_RUNTIME_URL ?? DEFAULT_RUNTIME_BASE_URL).trim();
  const secret = (process.env.SELF_HOSTED_BROWSER_RUNTIME_SECRET ?? "").trim();
  let url: URL;
  try { url = new URL(rawBase); } catch { throw new Error("Self Hosted browser runtime URL is invalid."); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
    throw new Error("Self Hosted browser runtime must use a clean HTTPS URL.");
  if (secret.length < 32) throw new Error("Self Hosted browser runtime is not configured. Contact Admin.");
  return { base: url.toString().replace(/\/$/, ""), secret };
}

export function signRuntimeRequest(input: { method: string; path: string; writerId: string; body: string; timestamp: number; nonce: string; secret: string }) {
  const bodyHash = createHash("sha256").update(input.body).digest("hex");
  const canonical = [input.method.toUpperCase(), input.path, String(input.timestamp), input.nonce, input.writerId, bodyHash].join("\n");
  return createHmac("sha256", input.secret).update(canonical).digest("hex");
}

async function runtimeRequest(
  method: "POST" | "DELETE",
  path: string,
  actorId: string,
  bodyValue?: Record<string, unknown>,
) {
  const { base, secret } = runtimeConfiguration();
  const body = bodyValue === undefined ? "" : JSON.stringify(bodyValue);
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = randomBytes(18).toString("base64url");
  const signature = signRuntimeRequest({ method, path, writerId: actorId, body, timestamp, nonce, secret });
  const response = await fetch(base + path, {
    method,
    headers: {
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
      "X-Toprated-Timestamp": String(timestamp),
      "X-Toprated-Nonce": nonce,
      "X-Toprated-Writer-Id": actorId,
      "X-Toprated-Signature": signature,
    },
    ...(body ? { body } : {}),
    signal: AbortSignal.timeout(120_000),
  });
  const json = await response.json().catch(() => null) as Record<string, unknown> | null;
  return { response, json };
}

export async function launchSelfHostedBrowser(writerId: string, toolSlug: string, accountId: string): Promise<SelfHostedLaunch> {
  if (!supportsSelfHostedBrowser(toolSlug)) throw new Error("This tool is not enabled for Self Hosted browser access.");
  const path = "/api/sessions";
  const { response, json } = await runtimeRequest("POST", path, writerId, {
    writer_id: writerId,
    tool_slug: toolSlug,
    account_id: accountId,
  });
  if (!response.ok) {
    const code = typeof json?.code === "string" ? json.code : "";
    if (code === "CAPACITY_FULL") throw new Error("Self Hosted browser capacity is temporarily full.");
    if (code.includes("REAUTH")) throw new Error("The administrator must refresh this tool login.");
    throw new Error("Self Hosted browser is temporarily unavailable. Please try again shortly.");
  }
  const grant = json?.viewerGrant as Record<string, unknown> | undefined;
  const providerSessionId = String(json?.sessionId ?? "");
  const liveUrl = String(grant?.url ?? "");
  const expiresAt = String(grant?.expiresAt ?? "");
  if (!providerSessionId || !liveUrl || !expiresAt) throw new Error("Self Hosted browser returned an invalid session.");
  return { provider: "self_hosted", providerSessionId, liveUrl, expiresAt };
}

function assertSupportedRuntimeTool(toolSlug: string) {
  if (!supportsSelfHostedBrowser(toolSlug)) {
    throw new Error("This tool is not enabled for Self Hosted browser access.");
  }
}

export async function launchSelfHostedAdminAuthentication(
  adminId: string,
  toolSlug: string,
  accountId: string,
): Promise<SelfHostedLaunch> {
  assertSupportedRuntimeTool(toolSlug);
  const path = `/api/tool-auth/${encodeURIComponent(toolSlug)}/sessions`;
  const { response, json } = await runtimeRequest("POST", path, adminId, { account_id: accountId });
  if (!response.ok) {
    throw new Error("Self Hosted secure login is temporarily unavailable. Please try again shortly.");
  }
  const grant = json?.viewerGrant as Record<string, unknown> | undefined;
  const providerSessionId = String(json?.sessionId ?? "");
  const liveUrl = String(grant?.url ?? "");
  const expiresAt = String(grant?.expiresAt ?? json?.leaseExpiresAt ?? "");
  if (!providerSessionId || !liveUrl || !expiresAt) {
    throw new Error("Self Hosted secure login returned an invalid session.");
  }
  return { provider: "self_hosted", providerSessionId, liveUrl, expiresAt };
}

export async function approveSelfHostedAdminAuthentication(
  adminId: string,
  toolSlug: string,
  providerSessionId: string,
  accountId: string,
) {
  assertSupportedRuntimeTool(toolSlug);
  const path = `/api/tool-auth/${encodeURIComponent(toolSlug)}/sessions/${encodeURIComponent(providerSessionId)}/approve`;
  const { response, json } = await runtimeRequest("POST", path, adminId, { account_id: accountId });
  if (!response.ok) {
    if (json?.code === "TOOL_AUTH_NOT_VERIFIED") {
      throw new SelfHostedAuthenticationNotReadyError(
        "Finish the login in the secure browser, including any OTP, then try saving again.",
      );
    }
    throw new Error("Self Hosted could not save the authenticated session.");
  }
  if (json?.status !== "ready" || json?.administratorSessionClosed !== true) {
    throw new Error("Self Hosted returned an invalid authentication result.");
  }
}

export async function closeSelfHostedAdminAuthentication(
  adminId: string,
  toolSlug: string,
  providerSessionId: string,
  accountId: string,
) {
  assertSupportedRuntimeTool(toolSlug);
  const path = `/api/tool-auth/${encodeURIComponent(toolSlug)}/sessions/${encodeURIComponent(providerSessionId)}`;
  const { response } = await runtimeRequest("DELETE", path, adminId, { account_id: accountId });
  if (!response.ok && response.status !== 404) {
    throw new Error("Self Hosted secure login browser could not be closed.");
  }
}
