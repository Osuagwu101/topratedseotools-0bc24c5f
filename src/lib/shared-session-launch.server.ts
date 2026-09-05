/* Server-only launcher for writer sessions. Never performs credential login. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { CdpClient, loadBrowserSecret, type BrowserAuthProvider } from "@/lib/browser-auth.server";
import { waitForAuthOrOtp } from "@/lib/browser-auth-session.server";

const BROWSER_USE_BASE = "https://api.browser-use.com/api/v3";
const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";

export const WRITER_REAUTH_MESSAGE =
  "Phrasly access is temporarily unavailable while an administrator refreshes authentication.";
export const WRITER_TEMPORARY_MESSAGE =
  "Phrasly access is temporarily unavailable. Please try again shortly.";

export class SharedAuthStateRejectedError extends Error {
  constructor(message = WRITER_REAUTH_MESSAGE) {
    super(message);
    this.name = "SharedAuthStateRejectedError";
  }
}

export type StoredCookie = {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: string;
};
export type StoredBrowserState = {
  authenticated_cookies: StoredCookie[];
  session_tokens?: Record<string, any> | null;
};
export type SessionOnlyLaunch = {
  provider: BrowserAuthProvider;
  providerSessionId: string;
  liveUrl: string;
  expiresAt: string;
};

async function fetchJson(url: string, init: RequestInit) {
  const res = await fetch(url, init);
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* no provider body exposure */
  }
  if (!res.ok) throw new Error(`Browser provider request failed (${res.status}).`);
  return json;
}

async function waitForDocument(client: CdpClient, sessionId?: string) {
  for (let i = 0; i < 24; i++) {
    try {
      const r = await client.send(
        "Runtime.evaluate",
        { expression: "document.readyState", returnByValue: true },
        sessionId,
      );
      if (["complete", "interactive"].includes(r?.result?.value)) return;
    } catch {
      /* navigation in progress */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

function normaliseSameSite(value: unknown): "Strict" | "Lax" | "None" | undefined {
  const v = String(value ?? "").toLowerCase();
  if (v === "strict") return "Strict";
  if (v === "lax") return "Lax";
  if (v === "none" || v === "no_restriction") return "None";
  return undefined;
}

async function seedAndVerify(
  client: CdpClient,
  loginUrl: string,
  state: StoredBrowserState,
  sessionId?: string,
) {
  await client.send("Page.enable", {}, sessionId);
  await client.send("Runtime.enable", {}, sessionId);
  await client.send("Network.enable", {}, sessionId).catch(() => undefined);
  const host = new URL(loginUrl).hostname;
  const cookies = Array.isArray(state.authenticated_cookies) ? state.authenticated_cookies : [];
  if (!cookies.length) throw new SharedAuthStateRejectedError();

  for (const cookie of cookies) {
    if (!cookie?.name) continue;
    const params: Record<string, any> = {
      name: cookie.name,
      value: String(cookie.value ?? ""),
      domain: cookie.domain || host,
      path: cookie.path || "/",
      secure: cookie.secure ?? true,
      httpOnly: cookie.httpOnly ?? false,
    };
    if (typeof cookie.expires === "number" && cookie.expires > 0) params.expires = cookie.expires;
    const sameSite = normaliseSameSite(cookie.sameSite);
    if (sameSite) params.sameSite = sameSite;
    await client.send("Network.setCookie", params, sessionId).catch(() => undefined);
  }

  await client.send("Page.navigate", { url: loginUrl }, sessionId);
  await waitForDocument(client, sessionId);

  const storage = state.session_tokens?.storage;
  if (storage && typeof storage === "object") {
    const expression = `(() => { const s=${JSON.stringify(storage)}; for (const [k,v] of Object.entries(s.localStorage||{})) localStorage.setItem(k,String(v)); for (const [k,v] of Object.entries(s.sessionStorage||{})) sessionStorage.setItem(k,String(v)); return true; })()`;
    await client
      .send("Runtime.evaluate", { expression, returnByValue: true }, sessionId)
      .catch(() => undefined);

    // Revisit the intended protected landing URL after storage seeding. If the
    // first request redirected to /login because authentication lived in web
    // storage, reloading would only reload /login and falsely reject valid state.
    await client.send("Page.navigate", { url: loginUrl }, sessionId).catch(() => undefined);
    await waitForDocument(client, sessionId);
  }

  const outcome = await waitForAuthOrOtp(client, sessionId, 10_000);
  if (outcome.status === "authenticated") return;
  if (outcome.status === "otp" || (outcome.status === "timeout" && outcome.observedPage)) {
    throw new SharedAuthStateRejectedError();
  }
  throw new Error(WRITER_TEMPORARY_MESSAGE);
}

async function attachPage(client: CdpClient) {
  const targets = await client.send("Target.getTargets");
  let targetId = (targets?.targetInfos ?? []).find((t: any) => t.type === "page")?.targetId;
  if (!targetId)
    targetId = (await client.send("Target.createTarget", { url: "about:blank" })).targetId;
  const attached = await client.send("Target.attachToTarget", { targetId, flatten: true });
  return attached.sessionId as string;
}

export async function launchBrowserUseSessionOnly(
  admin: any,
  input: {
    loginUrl: string;
    timeoutMinutes: number;
    state: StoredBrowserState;
    viewport?: { width: number; height: number };
  },
): Promise<SessionOnlyLaunch> {
  const key = await loadBrowserSecret(admin, "BROWSER_USE_API_KEY");
  if (!key) throw new Error("Browser Use is not configured. Contact Admin.");
  const browser = await fetchJson(`${BROWSER_USE_BASE}/browsers`, {
    method: "POST",
    headers: { "X-Browser-Use-API-Key": key, "Content-Type": "application/json" },
    body: JSON.stringify({
      timeout: input.timeoutMinutes,
      browserScreenWidth: input.viewport?.width ?? 1440,
      browserScreenHeight: input.viewport?.height ?? 900,
      allowResizing: false,
      enableRecording: false,
    }),
  });
  if (!browser?.id || !browser?.liveUrl || !browser?.cdpUrl)
    throw new Error("Browser Use did not return a usable browser session.");
  let cdp: CdpClient | null = null;
  try {
    cdp = await CdpClient.connect(String(browser.cdpUrl));
    const sessionId = await attachPage(cdp);
    await seedAndVerify(cdp, input.loginUrl, input.state, sessionId);
    return {
      provider: "browser_use",
      providerSessionId: String(browser.id),
      liveUrl: String(browser.liveUrl),
      expiresAt: String(
        browser.timeoutAt ?? new Date(Date.now() + input.timeoutMinutes * 60000).toISOString(),
      ),
    };
  } catch (e) {
    await fetch(`${BROWSER_USE_BASE}/browsers/${encodeURIComponent(String(browser.id))}`, {
      method: "PATCH",
      headers: { "X-Browser-Use-API-Key": key, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "stop" }),
    }).catch(() => undefined);
    throw e;
  } finally {
    cdp?.close();
  }
}

export async function launchCloudflareSessionOnly(
  admin: any,
  input: { loginUrl: string; timeoutMinutes: number; state: StoredBrowserState },
): Promise<SessionOnlyLaunch> {
  const accountId = await loadBrowserSecret(admin, "CLOUDFLARE_ACCOUNT_ID");
  const token = await loadBrowserSecret(admin, "CLOUDFLARE_BROWSER_RUN_API_TOKEN");
  if (!accountId || !token)
    throw new Error("Cloudflare Browser Run is not configured. Contact Admin.");
  const json = await fetchJson(
    `${CLOUDFLARE_API}/accounts/${encodeURIComponent(accountId)}/browser-rendering/devtools/browser?keep_alive=600000&targets=true`,
    { method: "POST", headers: { Authorization: `Bearer ${token}` } },
  );
  const browser = json?.result ?? json;
  const target =
    (browser?.targets ?? []).find((t: any) => t.type === "page") ?? browser?.targets?.[0];
  if (!browser?.sessionId || !target?.webSocketDebuggerUrl)
    throw new Error("Cloudflare Browser Run did not return a usable page session.");
  let cdp: CdpClient | null = null;
  try {
    cdp = await CdpClient.connect(String(target.webSocketDebuggerUrl));
    await seedAndVerify(cdp, input.loginUrl, input.state);
    let liveUrl = String(target.devtoolsFrontendUrl ?? "");
    try {
      const view = await cdp.send("Cloudflare.getLiveView", {
        mode: "tab",
        expiresInMs: Math.min(input.timeoutMinutes * 60000, 3600000),
      });
      if (view?.devtoolsFrontendUrl) liveUrl = String(view.devtoolsFrontendUrl);
    } catch {
      /* existing URL is acceptable */
    }
    if (!liveUrl) throw new Error("Cloudflare did not return a Live View URL.");
    return {
      provider: "cloudflare",
      providerSessionId: String(browser.sessionId),
      liveUrl,
      expiresAt: new Date(Date.now() + input.timeoutMinutes * 60000).toISOString(),
    };
  } catch (e) {
    await fetch(
      `${CLOUDFLARE_API}/accounts/${encodeURIComponent(accountId)}/browser-rendering/devtools/browser/${encodeURIComponent(String(browser.sessionId))}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
    ).catch(() => undefined);
    throw e;
  } finally {
    cdp?.close();
  }
}
