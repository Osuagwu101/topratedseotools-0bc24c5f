/* Server-only helpers for resuming and verifying remote authentication sessions. */
import { CdpClient } from "@/lib/browser-auth.server";
import {
  checkAuthenticationStatusExpression,
  detectOtpExpression,
} from "@/lib/browser-auth-otp.server";

export async function attachBrowserUsePage(client: CdpClient): Promise<string> {
  const targets = await client.send("Target.getTargets");
  let targetId = (targets?.targetInfos ?? []).find(
    (target: { type?: string; url?: string }) =>
      target.type === "page" && target.url !== "about:blank",
  )?.targetId as string | undefined;

  if (!targetId) {
    targetId = (targets?.targetInfos ?? []).find(
      (target: { type?: string }) => target.type === "page",
    )?.targetId as string | undefined;
  }

  if (!targetId) {
    const created = await client.send("Target.createTarget", { url: "about:blank" });
    targetId = String(created.targetId);
  }

  const attached = await client.send("Target.attachToTarget", {
    targetId,
    flatten: true,
  });
  if (!attached?.sessionId) throw new Error("Could not attach to the authentication page.");
  return String(attached.sessionId);
}

export type AuthOrOtpOutcome =
  | { status: "authenticated"; url?: string; title?: string }
  | { status: "otp"; type?: string; fieldSelector?: string }
  | { status: "timeout"; url?: string; title?: string; observedPage: boolean };

/**
 * Detect an OTP challenge before considering the page authenticated.
 * This ordering is deliberate: some verification pages retain account/nav UI,
 * which must never be mistaken for a completed login.
 */
export async function waitForAuthOrOtp(
  client: CdpClient,
  sessionId?: string,
  timeoutMs = 15_000,
): Promise<AuthOrOtpOutcome> {
  const deadline = Date.now() + timeoutMs;
  let lastUrl: string | undefined;
  let lastTitle: string | undefined;
  let observedPage = false;

  while (Date.now() < deadline) {
    try {
      const otpResult = await client.send(
        "Runtime.evaluate",
        { expression: detectOtpExpression(), returnByValue: true },
        sessionId,
      );
      observedPage = true;
      const otp = otpResult?.result?.value;
      if (otp?.detected) {
        return {
          status: "otp",
          type: typeof otp.type === "string" ? otp.type : "unknown",
          fieldSelector:
            typeof otp.fieldSelector === "string" ? otp.fieldSelector : undefined,
        };
      }

      const authResult = await client.send(
        "Runtime.evaluate",
        {
          expression: checkAuthenticationStatusExpression(),
          returnByValue: true,
          awaitPromise: true,
        },
        sessionId,
      );
      observedPage = true;
      const auth = authResult?.result?.value;
      if (auth && typeof auth === "object") {
        lastUrl = typeof auth.url === "string" ? auth.url : lastUrl;
        lastTitle = typeof auth.title === "string" ? auth.title : lastTitle;
        if (auth.authenticated) {
          return { status: "authenticated", url: lastUrl, title: lastTitle };
        }
      }
    } catch {
      // Redirects can invalidate the current execution context briefly.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return { status: "timeout", url: lastUrl, title: lastTitle, observedPage };
}

/**
 * After an OTP submit, the challenge field can remain visible briefly while
 * Phrasly validates the code and redirects. Keep polling instead of treating
 * the first still-visible OTP field as an immediate rejection.
 */
export async function waitForAuthenticatedPage(
  client: CdpClient,
  sessionId?: string,
  timeoutMs = 15_000,
): Promise<{ authenticated: boolean; url?: string; title?: string }> {
  const deadline = Date.now() + timeoutMs;
  let lastUrl: string | undefined;
  let lastTitle: string | undefined;

  while (Date.now() < deadline) {
    try {
      const otpResult = await client.send(
        "Runtime.evaluate",
        { expression: detectOtpExpression(), returnByValue: true },
        sessionId,
      );
      if (otpResult?.result?.value?.detected) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        continue;
      }

      const authResult = await client.send(
        "Runtime.evaluate",
        {
          expression: checkAuthenticationStatusExpression(),
          returnByValue: true,
          awaitPromise: true,
        },
        sessionId,
      );
      const auth = authResult?.result?.value;
      if (auth && typeof auth === "object") {
        lastUrl = typeof auth.url === "string" ? auth.url : lastUrl;
        lastTitle = typeof auth.title === "string" ? auth.title : lastTitle;
        if (auth.authenticated) {
          return { authenticated: true, url: lastUrl, title: lastTitle };
        }
      }
    } catch {
      // Redirects can briefly invalidate the execution context after submit.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return { authenticated: false, url: lastUrl, title: lastTitle };
}
