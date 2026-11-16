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
export async function fetchClaudeProvider(target: URL | string, init: RequestInit = {}, account: ClaudeProviderAccountKey = "account_1") {
  if(!isClaudeProviderAccount(account))throw Error("Invalid Claude account.");
  const configured = account === "account_1" ? process.env.CLAUDE_BROWSER_RELAY_URL : process.env.CLAUDE_ACCOUNT_2_RELAY_URL;
  const relayUrl = account === "account_1" ? BROWSER_RELAY_URL : "http://127.0.0.1:6102/request";
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
