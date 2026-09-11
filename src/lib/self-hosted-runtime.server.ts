/* Server-only client for the standalone Self Hosted browser runtime. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash, createHmac, randomBytes } from "node:crypto";
import { loadBrowserSecret } from "@/lib/browser-auth.server";

const REAUTH_CODES = new Set([
  "TOOL_REAUTH_REQUIRED",
  "BROWSER_IDENTITY_MISSING",
  "BROWSER_IDENTITY_UNAVAILABLE",
  "TOOL_AUTH_NOT_VERIFIED",
]);

export class SelfHostedRuntimeError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "SelfHostedRuntimeError";
  }

  get requiresAdminReauthentication() {
    return REAUTH_CODES.has(this.code) || this.status === 423;
  }
}

function normaliseBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Self Hosted runtime URL is invalid.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("Self Hosted runtime URL must be a clean HTTPS origin.");
  }
  return url.origin;
}

async function configuration(admin: any) {
  const baseUrl = normaliseBaseUrl(
    await loadBrowserSecret(admin, "SELF_HOSTED_RUNTIME_BASE_URL"),
  );
  const secret = await loadBrowserSecret(admin, "SELF_HOSTED_RUNTIME_SERVICE_AUTH_SECRET");
  if (secret.length < 32) {
    throw new Error("Self Hosted runtime signing secret is not configured.");
  }
  return { baseUrl, secret };
}

async function request(
  admin: any,
  writerId: string,
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: Record<string, unknown>,
) {
  const { baseUrl, secret } = await configuration(admin);
  const bodyText = body === undefined ? "" : JSON.stringify(body);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = randomBytes(18).toString("base64url");
  const bodyHash = createHash("sha256").update(bodyText).digest("hex");
  const canonical = [method, path, timestamp, nonce, writerId, bodyHash].join("\n");
  const signature = createHmac("sha256", secret).update(canonical).digest("hex");
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    signal: AbortSignal.timeout(10_000),
    headers: {
      Accept: "application/json",
      "X-Toprated-Timestamp": timestamp,
      "X-Toprated-Nonce": nonce,
      "X-Toprated-Writer-Id": writerId,
      "X-Toprated-Signature": signature,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : bodyText,
  });
  const text = await response.text();
  let payload: any = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    // Runtime bodies and signed viewer URLs must not be reflected in errors.
  }
  if (!response.ok) {
    throw new SelfHostedRuntimeError(
      String(payload?.code ?? "RUNTIME_UNAVAILABLE"),
      response.status,
      response.status === 429
        ? "Self Hosted browser capacity is temporarily full."
        : "Self Hosted browser runtime is temporarily unavailable.",
    );
  }
  return payload;
}

export async function testSelfHostedRuntime(admin: any) {
  try {
    const { baseUrl } = await configuration(admin);
    const response = await fetch(`${baseUrl}/api/health`, {
      headers: { Accept: "application/json" },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.status !== "ok") {
      return { ok: false, message: "Self Hosted runtime health check failed." };
    }
    return { ok: true, message: "Self Hosted runtime connection verified." };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Self Hosted connection test failed.",
    };
  }
}

export async function launchSelfHostedSession(
  admin: any,
  input: { writerId: string; toolSlug: string },
) {
  const payload = await request(admin, input.writerId, "POST", "/api/sessions", {
    writer_id: input.writerId,
    tool_slug: input.toolSlug,
  });
  const grant = payload?.viewerGrant;
  if (
    payload?.status !== "active" ||
    typeof payload?.sessionId !== "string" ||
    typeof grant?.url !== "string" ||
    typeof payload?.leaseExpiresAt !== "string"
  ) {
    throw new SelfHostedRuntimeError(
      "RUNTIME_PROTOCOL_ERROR",
      502,
      "Self Hosted runtime returned an invalid session.",
    );
  }
  return {
    provider: "self_hosted" as const,
    providerSessionId: payload.sessionId,
    liveUrl: grant.url,
    expiresAt: payload.leaseExpiresAt,
  };
}

export async function closeSelfHostedSession(
  admin: any,
  writerId: string,
  sessionId: string,
) {
  await request(
    admin,
    writerId,
    "DELETE",
    `/api/sessions/${encodeURIComponent(sessionId)}`,
  );
}

export async function heartbeatSelfHostedSession(
  admin: any,
  writerId: string,
  sessionId: string,
) {
  return request(
    admin,
    writerId,
    "POST",
    `/api/sessions/${encodeURIComponent(sessionId)}/heartbeat`,
    {},
  );
}

export async function activitySelfHostedSession(
  admin: any,
  writerId: string,
  sessionId: string,
) {
  return request(
    admin,
    writerId,
    "POST",
    `/api/sessions/${encodeURIComponent(sessionId)}/activity`,
    {},
  );
}
