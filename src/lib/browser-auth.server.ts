/*
 * Server-only remote-browser authentication engines.
 *
 * Credentials never cross the customer browser. They are read through the
 * service-role client, injected into the remote browser through CDP, and only
 * a provider-issued interactive Live View URL is returned to the subscriber.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

export type BrowserAuthProvider = "browser_use" | "cloudflare";

const BROWSER_USE_BASE = "https://api.browser-use.com/api/v3";
const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";

const PROVIDER_SECRET_NAMES: Record<BrowserAuthProvider, string[]> = {
  browser_use: ["BROWSER_USE_API_KEY"],
  cloudflare: ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_BROWSER_RUN_API_TOKEN"],
};

export function browserAuthSecretNames(provider: BrowserAuthProvider): string[] {
  return PROVIDER_SECRET_NAMES[provider];
}

export async function loadBrowserSecret(admin: any, name: string): Promise<string> {
  const env = process.env[name];
  if (env?.trim()) return env.trim();
  const { data } = await admin
    .from("internal_secrets")
    .select("value")
    .eq("name", name)
    .maybeSingle();
  return String(data?.value ?? "").trim();
}

export async function configuredBrowserSecrets(
  admin: any,
  provider: BrowserAuthProvider,
): Promise<string[]> {
  const names = browserAuthSecretNames(provider);
  const out: string[] = [];
  for (const name of names) {
    if (await loadBrowserSecret(admin, name)) out.push(name);
  }
  return out;
}

function safeErrorMessage(status: number): string {
  if (status === 401 || status === 403) return "Credentials were rejected by the browser provider.";
  if (status === 402) return "The browser provider account needs billing or usage credit.";
  if (status === 429)
    return "The browser provider is temporarily rate-limited. Please try again shortly.";
  return `Browser provider request failed (${status}).`;
}

async function fetchJson(url: string, init: RequestInit): Promise<any> {
  const res = await fetch(url, init);
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // Never return provider response bodies because they may contain signed URLs.
  }
  if (!res.ok) throw new Error(safeErrorMessage(res.status));
  return json;
}

async function stopBrowserUseSession(apiKey: string, sessionId: string) {
  try {
    await fetch(`${BROWSER_USE_BASE}/browsers/${encodeURIComponent(sessionId)}`, {
      method: "PATCH",
      headers: {
        "X-Browser-Use-API-Key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "stop" }),
    });
  } catch {
    // Best-effort cleanup. Provider timeout remains the final safety net.
  }
}

async function closeCloudflareSession(accountId: string, token: string, sessionId: string) {
  try {
    await fetch(
      `${CLOUDFLARE_API}/accounts/${encodeURIComponent(accountId)}/browser-rendering/devtools/browser/${encodeURIComponent(sessionId)}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
    );
  } catch {
    // Best-effort cleanup. Provider timeout remains the final safety net.
  }
}

export async function testBrowserProvider(
  admin: any,
  provider: BrowserAuthProvider,
): Promise<{ ok: boolean; message: string }> {
  try {
    if (provider === "browser_use") {
      const key = await loadBrowserSecret(admin, "BROWSER_USE_API_KEY");
      if (!key) return { ok: false, message: "Browser Use API key is not configured." };
      await fetchJson(`${BROWSER_USE_BASE}/sessions?page=1&page_size=1`, {
        method: "GET",
        headers: { "X-Browser-Use-API-Key": key },
      });
      return { ok: true, message: "Browser Use API connection verified." };
    }

    const accountId = await loadBrowserSecret(admin, "CLOUDFLARE_ACCOUNT_ID");
    const token = await loadBrowserSecret(admin, "CLOUDFLARE_BROWSER_RUN_API_TOKEN");
    if (!accountId || !token) {
      return {
        ok: false,
        message: "Cloudflare Account ID and Browser Run API token are required.",
      };
    }
    const json = await fetchJson(
      `${CLOUDFLARE_API}/accounts/${encodeURIComponent(accountId)}/browser-rendering/devtools/session?limit=1`,
      { method: "GET", headers: { Authorization: `Bearer ${token}` } },
    );
    if (json && json.success === false)
      return { ok: false, message: "Cloudflare rejected the Browser Run connection." };
    return { ok: true, message: "Cloudflare Browser Run API connection verified." };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Connection test failed." };
  }
}

export class CdpClient {
  private ws: WebSocket;
  private nextId = 1;
  private pending = new Map<
    number,
    {
      resolve: (value: any) => void;
      reject: (reason: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.addEventListener("message", (event: MessageEvent) => {
      if (typeof event.data !== "string") return;
      let msg: any;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (!msg?.id) return;
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new Error(String(msg.error.message ?? "CDP command failed")));
      else p.resolve(msg.result ?? {});
    });
    ws.addEventListener("close", () => {
      for (const [, p] of this.pending) {
        clearTimeout(p.timer);
        p.reject(new Error("Remote browser connection closed."));
      }
      this.pending.clear();
    });
  }

  static async connect(url: string): Promise<CdpClient> {
    if (typeof globalThis.WebSocket === "undefined") {
      throw new Error("Remote browser WebSocket support is unavailable on this server runtime.");
    }
    const ws = new globalThis.WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Remote browser connection timed out.")),
        10_000,
      );
      ws.addEventListener(
        "open",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
      ws.addEventListener(
        "error",
        () => {
          clearTimeout(timer);
          reject(new Error("Could not connect to the remote browser."));
        },
        { once: true },
      );
    });
    return new CdpClient(ws);
  }

  send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<any> {
    const id = this.nextId++;
    const payload: Record<string, unknown> = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Remote browser command timed out: ${method}`));
      }, 15_000);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify(payload));
    });
  }

  close() {
    try {
      this.ws.close();
    } catch {
      /* no-op */
    }
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForDocument(client: CdpClient, sessionId?: string) {
  for (let i = 0; i < 24; i++) {
    try {
      const r = await client.send(
        "Runtime.evaluate",
        { expression: "document.readyState", returnByValue: true },
        sessionId,
      );
      if (r?.result?.value === "complete" || r?.result?.value === "interactive") return;
    } catch {
      // Navigation may temporarily invalidate the execution context.
    }
    await delay(250);
  }
}

function loginInjectionExpression(username: string, password: string): string {
  // Values are serialized only into the server-to-remote-browser CDP command;
  // they are never returned to the caller or logged.
  return `(() => {
    const username = ${JSON.stringify(username)};
    const password = ${JSON.stringify(password)};
    const visible = (el) => !!el && !el.disabled && el.getClientRects().length > 0;
    const q = (selectors) => {
      for (const s of selectors) {
        const el = document.querySelector(s);
        if (visible(el)) return el;
      }
      return null;
    };
    const setInput = (el, value) => {
      if (!el) return;
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(el, value); else el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const user = q([
      'input[autocomplete="username"]', 'input[type="email"]',
      'input[name*="email" i]', 'input[id*="email" i]',
      'input[name*="user" i]', 'input[id*="user" i]',
      'input[name*="login" i]', 'input[id*="login" i]'
    ]);
    const pass = q([
      'input[autocomplete="current-password"]', 'input[type="password"]',
      'input[name*="pass" i]', 'input[id*="pass" i]'
    ]);
    if (user && username) setInput(user, username);
    if (pass && password) setInput(pass, password);

    const controls = Array.from(document.querySelectorAll('button, input[type="submit"], [role="button"]')).filter(visible);
    const text = (el) => String(el.innerText || el.value || el.getAttribute('aria-label') || '').trim().toLowerCase();
    const submit = controls.find((el) => /^(sign in|signin|log in|login|continue|next|submit)$/.test(text(el)))
      || controls.find((el) => /(sign in|log in|login|continue|next)/.test(text(el)));

    let stage = 'filled';
    if (pass) {
      if (submit) { submit.click(); stage = 'submitted'; }
      else if (pass.form?.requestSubmit) { pass.form.requestSubmit(); stage = 'submitted'; }
      else if (pass.form) { pass.form.submit(); stage = 'submitted'; }
    } else if (user && submit) {
      submit.click();
      stage = 'next';
    }
    return { stage, href: location.href, hasUser: !!user, hasPassword: !!pass };
  })()`;
}

async function injectLogin(
  client: CdpClient,
  loginUrl: string,
  username: string,
  password: string,
  sessionId?: string,
  capturedCookies?: Array<{ name: string; value: string }>,
) {
  const {
    detectOtpExpression,
    injectSessionCookiesExpression,
    checkAuthenticationStatusExpression,
  } = await import("@/lib/browser-auth-otp.server");

  await client.send("Page.enable", {}, sessionId);
  await client.send("Runtime.enable", {}, sessionId);

  // If captured cookies are provided, inject them before navigating to login page
  if (capturedCookies && capturedCookies.length > 0) {
    // Set cookies in the CDP session
    for (const cookie of capturedCookies) {
      try {
        await client.send(
          "Network.setCookie",
          {
            name: cookie.name,
            value: cookie.value,
            domain: new URL(loginUrl).hostname,
            path: "/",
            secure: true,
            httpOnly: false,
          },
          sessionId,
        );
      } catch {
        // Cookie may not be valid for this domain/context, continue anyway
      }
    }
  }

  await client.send("Page.navigate", { url: loginUrl }, sessionId);
  await waitForDocument(client, sessionId);
  await delay(500);

  // If we injected cookies, check if already authenticated
  if (capturedCookies && capturedCookies.length > 0) {
    try {
      const authCheck = await client.send(
        "Runtime.evaluate",
        { expression: checkAuthenticationStatusExpression(), returnByValue: true },
        sessionId,
      );
      const authStatus = authCheck?.result?.value as any;
      if (authStatus?.authenticated) {
        return {
          submitted: true,
          stage: "authenticated_via_session",
        };
      }
    } catch {
      // Continue with normal login flow if auth check fails
    }
  }

  let result = await client.send(
    "Runtime.evaluate",
    {
      expression: loginInjectionExpression(username, password),
      returnByValue: true,
      awaitPromise: true,
    },
    sessionId,
  );
  let stage = result?.result?.value?.stage as string | undefined;

  if (stage === "next") {
    await delay(1200);
    await waitForDocument(client, sessionId);
    result = await client.send(
      "Runtime.evaluate",
      {
        expression: loginInjectionExpression(username, password),
        returnByValue: true,
        awaitPromise: true,
      },
      sessionId,
    );
    stage = result?.result?.value?.stage as string | undefined;
  }

  if (stage === "submitted") {
    await delay(1800);
    await waitForDocument(client, sessionId);

    // Check for OTP/2FA requirement after login submission
    const otpCheck = await client
      .send(
        "Runtime.evaluate",
        { expression: detectOtpExpression(), returnByValue: true },
        sessionId,
      )
      .catch(() => ({ result: { value: { detected: false } } }));

    const otpDetected = otpCheck?.result?.value?.detected;
    if (otpDetected) {
      return {
        submitted: true,
        stage: "otp_detected",
        otp_type: otpCheck?.result?.value?.type,
        otp_field_selector: otpCheck?.result?.value?.fieldSelector,
      };
    }
  }

  return { submitted: stage === "submitted", stage: stage ?? "unknown" };
}

async function attachBrowserPage(
  client: CdpClient,
): Promise<{ sessionId: string; targetId: string }> {
  const targets = await client.send("Target.getTargets");
  let targetId = (targets?.targetInfos ?? []).find((t: any) => t.type === "page")?.targetId as
    | string
    | undefined;
  if (!targetId) {
    const created = await client.send("Target.createTarget", { url: "about:blank" });
    targetId = created.targetId as string;
  }
  const attached = await client.send("Target.attachToTarget", { targetId, flatten: true });
  return { sessionId: attached.sessionId as string, targetId };
}

export interface RemoteBrowserLaunch {
  provider: BrowserAuthProvider;
  providerSessionId: string;
  liveUrl: string;
  expiresAt: string;
  automationSubmitted: boolean;
}

export interface RemoteBrowserLaunchWithOtp extends RemoteBrowserLaunch {
  otp_status?: {
    detected: boolean;
    type?: string;
    field_selector?: string;
  };
}

export async function launchBrowserUse(
  admin: any,
  input: {
    loginUrl: string;
    username: string;
    password: string;
    timeoutMinutes: number;
    capturedCookies?: Array<{ name: string; value: string }>;
  },
): Promise<RemoteBrowserLaunchWithOtp> {
  const key = await loadBrowserSecret(admin, "BROWSER_USE_API_KEY");
  if (!key) throw new Error("Browser Use is not configured. Contact Admin.");

  const browser = await fetchJson(`${BROWSER_USE_BASE}/browsers`, {
    method: "POST",
    headers: {
      "X-Browser-Use-API-Key": key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      timeout: input.timeoutMinutes,
      browserScreenWidth: 1440,
      browserScreenHeight: 900,
      allowResizing: false,
      enableRecording: false,
    }),
  });
  if (!browser?.id || !browser?.liveUrl || !browser?.cdpUrl) {
    throw new Error("Browser Use did not return a usable browser session.");
  }

  let cdp: CdpClient | null = null;
  try {
    cdp = await CdpClient.connect(String(browser.cdpUrl));
    const page = await attachBrowserPage(cdp);
    const automation = await injectLogin(
      cdp,
      input.loginUrl,
      input.username,
      input.password,
      page.sessionId,
      input.capturedCookies,
    );
    if (!automation.submitted) {
      throw new Error("Automatic login could not be completed for this tool. Contact Admin.");
    }

    // Check if already authenticated via injected session
    const alreadyAuthenticated = (automation as any).stage === "authenticated_via_session";
    if (alreadyAuthenticated) {
      return {
        provider: "browser_use",
        providerSessionId: String(browser.id),
        liveUrl: String(browser.liveUrl),
        expiresAt: String(
          browser.timeoutAt ?? new Date(Date.now() + input.timeoutMinutes * 60_000).toISOString(),
        ),
        automationSubmitted: true,
      };
    }

    // Check if OTP was detected
    const otpDetected = (automation as any).stage === "otp_detected";
    if (otpDetected) {
      return {
        provider: "browser_use",
        providerSessionId: String(browser.id),
        liveUrl: String(browser.liveUrl),
        expiresAt: String(
          browser.timeoutAt ?? new Date(Date.now() + input.timeoutMinutes * 60_000).toISOString(),
        ),
        automationSubmitted: true,
        otp_status: {
          detected: true,
          type: (automation as any).otp_type,
          field_selector: (automation as any).otp_field_selector,
        },
      };
    }

    return {
      provider: "browser_use",
      providerSessionId: String(browser.id),
      liveUrl: String(browser.liveUrl),
      expiresAt: String(
        browser.timeoutAt ?? new Date(Date.now() + input.timeoutMinutes * 60_000).toISOString(),
      ),
      automationSubmitted: true,
    };
  } catch (err) {
    await stopBrowserUseSession(key, String(browser.id));
    throw err;
  } finally {
    cdp?.close();
  }
}

export async function launchCloudflare(
  admin: any,
  input: {
    loginUrl: string;
    username: string;
    password: string;
    timeoutMinutes: number;
    capturedCookies?: Array<{ name: string; value: string }>;
  },
): Promise<RemoteBrowserLaunchWithOtp> {
  const accountId = await loadBrowserSecret(admin, "CLOUDFLARE_ACCOUNT_ID");
  const token = await loadBrowserSecret(admin, "CLOUDFLARE_BROWSER_RUN_API_TOKEN");
  if (!accountId || !token)
    throw new Error("Cloudflare Browser Run is not configured. Contact Admin.");

  const keepAliveMs = 600_000;
  const json = await fetchJson(
    `${CLOUDFLARE_API}/accounts/${encodeURIComponent(accountId)}/browser-rendering/devtools/browser?keep_alive=${keepAliveMs}&targets=true`,
    { method: "POST", headers: { Authorization: `Bearer ${token}` } },
  );
  if (json?.success === false)
    throw new Error("Cloudflare Browser Run could not create a session.");
  const browser = json?.result ?? json;
  const target =
    (browser?.targets ?? []).find((t: any) => t.type === "page") ?? browser?.targets?.[0];
  if (!browser?.sessionId || !target?.webSocketDebuggerUrl) {
    throw new Error("Cloudflare Browser Run did not return a usable page session.");
  }

  let cdp: CdpClient | null = null;
  try {
    cdp = await CdpClient.connect(String(target.webSocketDebuggerUrl));
    const automation = await injectLogin(
      cdp,
      input.loginUrl,
      input.username,
      input.password,
      undefined,
      input.capturedCookies,
    );
    if (!automation.submitted) {
      throw new Error("Automatic login could not be completed for this tool. Contact Admin.");
    }

    // Check if already authenticated via injected session
    const alreadyAuthenticated = (automation as any).stage === "authenticated_via_session";
    if (alreadyAuthenticated) {
      return {
        provider: "cloudflare",
        providerSessionId: String(browser.sessionId),
        liveUrl: String(target.devtoolsFrontendUrl ?? ""),
        expiresAt: new Date(Date.now() + input.timeoutMinutes * 60_000).toISOString(),
        automationSubmitted: true,
      };
    }

    // Check if OTP was detected
    const otpDetected = (automation as any).stage === "otp_detected";
    if (otpDetected) {
      return {
        provider: "cloudflare",
        providerSessionId: String(browser.sessionId),
        liveUrl: String(target.devtoolsFrontendUrl ?? ""),
        expiresAt: new Date(Date.now() + input.timeoutMinutes * 60_000).toISOString(),
        automationSubmitted: true,
        otp_status: {
          detected: true,
          type: (automation as any).otp_type,
          field_selector: (automation as any).otp_field_selector,
        },
      };
    }

    let liveUrl = String(target.devtoolsFrontendUrl ?? "");
    try {
      const view = await cdp.send("Cloudflare.getLiveView", {
        mode: "tab",
        expiresInMs: Math.min(input.timeoutMinutes * 60_000, 3_600_000),
      });
      if (view?.devtoolsFrontendUrl) liveUrl = String(view.devtoolsFrontendUrl);
    } catch {
      // Target creation may already include a signed hosted Live View URL.
    }
    if (!liveUrl) throw new Error("Cloudflare did not return a Live View URL.");
    return {
      provider: "cloudflare",
      providerSessionId: String(browser.sessionId),
      liveUrl,
      expiresAt: new Date(Date.now() + input.timeoutMinutes * 60_000).toISOString(),
      automationSubmitted: true,
    };
  } catch (err) {
    await closeCloudflareSession(accountId, token, String(browser.sessionId));
    throw err;
  } finally {
    cdp?.close();
  }
}

/**
 * Reconnect to an existing Browser Use session using its session ID.
 * Used to resume paused sessions for OTP submission.
 * Includes exponential backoff retry logic for transient failures.
 */
export async function reconnectBrowserUseSession(
  admin: any,
  sessionId: string,
  maxRetries: number = 3,
): Promise<CdpClient | null> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const key = await loadBrowserSecret(admin, "BROWSER_USE_API_KEY");
      if (!key) return null;

      // Fetch the browser session details to get CDP URL
      const browser = await fetchJson(
        `${BROWSER_USE_BASE}/browsers/${encodeURIComponent(sessionId)}`,
        {
          method: "GET",
          headers: { "X-Browser-Use-API-Key": key },
        },
      );

      if (!browser?.cdpUrl) {
        // Session doesn't exist or has expired
        return null;
      }

      // Connect to existing session
      const cdp = await CdpClient.connect(String(browser.cdpUrl));
      return cdp;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      // Transient errors: retry with exponential backoff
      if (attempt < maxRetries - 1) {
        const backoffMs = Math.min(1000 * Math.pow(2, attempt), 5000);
        await delay(backoffMs);
      }
    }
  }

  // All retries exhausted
  return null;
}

/**
 * Reconnect to an existing Cloudflare Browser Run session using session ID.
 * Used to resume paused sessions for OTP submission.
 * Includes exponential backoff retry logic for transient failures.
 */
export async function reconnectCloudflareSession(
  admin: any,
  sessionId: string,
  maxRetries: number = 3,
): Promise<CdpClient | null> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const accountId = await loadBrowserSecret(admin, "CLOUDFLARE_ACCOUNT_ID");
      const token = await loadBrowserSecret(admin, "CLOUDFLARE_BROWSER_RUN_API_TOKEN");
      if (!accountId || !token) return null;

      // Get session details
      const json = await fetchJson(
        `${CLOUDFLARE_API}/accounts/${encodeURIComponent(accountId)}/browser-rendering/devtools/browser/${encodeURIComponent(sessionId)}`,
        { method: "GET", headers: { Authorization: `Bearer ${token}` } },
      );

      const browser = json?.result ?? json;
      const target = (browser?.targets ?? []).find((t: any) => t.type === "page");

      if (!target?.webSocketDebuggerUrl) {
        // Session doesn't exist or has expired
        return null;
      }

      // Connect to existing session
      const cdp = await CdpClient.connect(String(target.webSocketDebuggerUrl));
      return cdp;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      // Transient errors: retry with exponential backoff
      if (attempt < maxRetries - 1) {
        const backoffMs = Math.min(1000 * Math.pow(2, attempt), 5000);
        await delay(backoffMs);
      }
    }
  }

  // All retries exhausted
  return null;
}
