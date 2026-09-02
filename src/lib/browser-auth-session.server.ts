/* Server-only helpers for resuming and verifying remote authentication sessions. */
import { CdpClient } from "@/lib/browser-auth.server";
import { checkAuthenticationStatusExpression } from "@/lib/browser-auth-otp.server";

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

export async function waitForAuthenticatedPage(
  client: CdpClient,
  sessionId?: string,
  timeoutMs = 15_000,
): Promise<{ authenticated: boolean; url?: string; title?: string }> {
  const deadline = Date.now() + timeoutMs;
  let last: { authenticated: boolean; url?: string; title?: string } = { authenticated: false };

  while (Date.now() < deadline) {
    try {
      const result = await client.send(
        "Runtime.evaluate",
        {
          expression: checkAuthenticationStatusExpression(),
          returnByValue: true,
          awaitPromise: true,
        },
        sessionId,
      );
      const value = result?.result?.value;
      if (value && typeof value === "object") {
        last = {
          authenticated: Boolean(value.authenticated),
          url: typeof value.url === "string" ? value.url : undefined,
          title: typeof value.title === "string" ? value.title : undefined,
        };
        if (last.authenticated) return last;
      }
    } catch {
      // Navigation can briefly invalidate the execution context; retry until timeout.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return last;
}
