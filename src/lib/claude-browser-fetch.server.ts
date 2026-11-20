import { isClaudeProviderAccount, type ClaudeProviderAccountKey } from "./claude-account-policy";
/* Browser-owned authentication stays in the private browser profile. */
export const BROWSER_RELAY_URL = "http://127.0.0.1:6101/request";
export function claudeBrowserTransportEnabled() {
  return process.env.CLAUDE_BROWSER_RELAY_URL === BROWSER_RELAY_URL;
}
export function claudeSharedBrowserTransport() {
  return claudeBrowserTransportEnabled() && process.env.CLAUDE_SHARED_BROWSER_TRANSPORT === "true";
}
const allowedHeaders = new Set([
  "anthropic-client-build", "x-organization-uuid", "connect-accept-encoding", "connect-content-encoding", "connect-protocol-version", "connect-timeout-ms",
  "accept", "accept-language", "content-type", "range", "if-none-match", "if-modified-since",
  "anthropic-client-sha", "anthropic-client-version", "anthropic-client-platform",
]);
/** Response from the relay meaning the private browser is on Claude's login page. */
export function claudeBrowserLoggedOut(response: Response) {
  return response.status === 401 || response.headers.get("x-trst-browser-login") === "required";
}

export async function fetchClaudeProvider(target: URL | string, init: RequestInit = {}, account: ClaudeProviderAccountKey = "account_1", options: {autoRestore?: boolean} = {}) {
  const response = await fetchClaudeProviderOnce(target, init, account);
  if (options.autoRestore === false || init.signal?.aborted || !claudeAccountUsesBrowser(account) || !claudeBrowserLoggedOut(response)) return response;
  // The server browser lost its login (e.g. Chrome was restarted after running
  // out of memory). Reload the Admin-saved session once and retry.
  const {restoreClaudeBrowserSession} = await import("./claude-accounts.server");
  let restored = false;
  try { restored = await restoreClaudeBrowserSession(account); } catch { restored = false; }
  if (!restored) return response;
  await response.body?.cancel().catch(() => {});
  return fetchClaudeProviderOnce(target, init, account);
}

async function fetchClaudeProviderOnce(target: URL | string, init: RequestInit, account: ClaudeProviderAccountKey) {
  if(!isClaudeProviderAccount(account))throw Error("Invalid Claude account.");
  const configured = account === "account_1" ? process.env.CLAUDE_BROWSER_RELAY_URL : process.env.CLAUDE_ACCOUNT_2_RELAY_URL;
  const relayUrl = account === "account_1" ? BROWSER_RELAY_URL : "http://127.0.0.1:6112/request";
  if (!configured) { if(account !== "account_1") throw Error("Claude Account 2 is not connected."); return fetch(target, init); }
  const url = new URL(target);
  if (configured !== relayUrl || url.origin !== "https://claude.ai") throw new Error("Invalid Claude browser transport configuration.");
  const key = account === "account_1" ? process.env.CLAUDE_BROWSER_RELAY_KEY : process.env.CLAUDE_ACCOUNT_2_RELAY_KEY;
  if (!key || key.length < 32) throw new Error("Claude browser transport is not configured.");
  let body: string | undefined, bodyBase64: string | undefined;
  if(typeof init.body==="string") body=init.body;
  else if(init.body instanceof ArrayBuffer)bodyBase64=Buffer.from(init.body).toString("base64");
  else if(ArrayBuffer.isView(init.body))bodyBase64=Buffer.from(init.body.buffer,init.body.byteOffset,init.body.byteLength).toString("base64");
  else if(init.body!=null)throw new Error("Unsupported browser transport body.");
  const headers: Record<string,string> = {};
  for (const [name,value] of new Headers(init.headers)) if (allowedHeaders.has(name.toLowerCase())) headers[name]=value;
  return fetch(relayUrl, {
    method: "POST", headers: {Authorization:`Bearer ${key}`,"Content-Type":"application/json"},
    body: JSON.stringify({path:url.pathname+url.search,method:init.method??"GET",headers,body,bodyBase64}),
    signal: init.signal,
  });
}

/** True when the given account is served by its private server browser. */
export function claudeAccountUsesBrowser(account: ClaudeProviderAccountKey) {
  return account === "account_1" ? claudeBrowserTransportEnabled() : !!process.env.CLAUDE_ACCOUNT_2_RELAY_URL;
}

export type ClaudeBrowserCookie = {
  name: string; value: string; domain: string; path: string;
  expires?: number; secure?: boolean; httpOnly?: boolean; sameSite?: string;
};

/**
 * Replace the Claude login inside an account's private server browser with the
 * pasted session cookies. Loopback only, authenticated with that account's
 * relay key; cookie values are never logged or returned.
 */
export async function pushClaudeBrowserSession(account: ClaudeProviderAccountKey, cookies: ClaudeBrowserCookie[]) {
  if (!isClaudeProviderAccount(account)) throw Error("Invalid Claude account.");
  const configured = account === "account_1" ? process.env.CLAUDE_BROWSER_RELAY_URL : process.env.CLAUDE_ACCOUNT_2_RELAY_URL;
  const relayUrl = account === "account_1" ? BROWSER_RELAY_URL : "http://127.0.0.1:6112/request";
  if (configured !== relayUrl) throw Error(`Claude ${account === "account_1" ? "Account 1" : "Account 2"} server browser is not configured.`);
  const key = account === "account_1" ? process.env.CLAUDE_BROWSER_RELAY_KEY : process.env.CLAUDE_ACCOUNT_2_RELAY_KEY;
  if (!key || key.length < 32) throw Error("Claude browser transport is not configured.");
  // Sessions saved before expiries were enforced may hold a sessionKey without
  // one; give it a lasting local expiry so a browser restart does not drop it.
  const fallbackExpiry = Math.floor(Date.now() / 1000) + 30 * 86400;
  const persistent = cookies.map((c) =>
    c.name === "sessionKey" && !(typeof c.expires === "number" && c.expires > 0) ? { ...c, expires: fallbackExpiry } : c,
  );
  const response = await fetch(relayUrl.replace(/\/request$/, "/session"), {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ cookies: persistent }),
    signal: AbortSignal.timeout(45_000),
  });
  if (response.status === 404) throw Error("The server browser relay must be updated before pasted sessions can be activated.");
  if (!response.ok) throw Error("The server browser could not load the pasted Claude session.");
}
