import { getStealthWriterUserLabel } from "./stealthwriter-controls.server";
import {assignedClaudeAccount,requireClaudeAccount} from "./claude-accounts.server";
import {claudeSessionMatchesAccount,type ClaudeProviderAccountKey} from "./claude-account-policy";
import {inspectClaudeWriterRpc,sanitizeClaudeBootstrap,filterClaudeWriterHistory,claudeWriterReferences,claudeUploadedFileIds,isolateClaudeWriterPayload,withoutBlockedConnectors,BLOCKED_CONNECTOR_RE,blockedConnectorIds} from "@/lib/claude-writer-policy";
import {getClaudeUsage,reserveClaudeMessage,releaseClaudeMessage} from "@/lib/claude-controls.server";
import {fetchClaudeProvider,claudeSharedBrowserTransport,claudeBrowserTransportEnabled} from "@/lib/claude-browser-fetch.server";
import {claudeBrowserRoutePolicy} from "@/lib/claude-browser-route-policy";
import {isDisabledClaudeModel,applyClaudeWriterModelPolicy,requestUsesDisabledModel,applyClaudeNewConversationDefaults,clampClaudeRequestEffort} from "@/lib/claude-model-policy";
/* Claude native OneClick, based on Grammarly's encrypted-vault and ticket setup.
 * Launch remains gated until real authenticated compatibility/isolation checks pass.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash, randomBytes } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  decryptClaudeSession,
  encryptClaudeSession,
  normaliseClaudeSession,
  type ClaudeSessionState,
} from "@/lib/claude-session.server";
import {
  claudeRoutePolicy,
  rewriteClaudeBody,
  claudeBootstrapScript,
  claudeCookieHeader,
} from "@/lib/claude-proxy-policy";
export {
  claudeRoutePolicy,
  rewriteClaudeBody,
  claudeBootstrapScript,
  claudeCookieHeader,
} from "@/lib/claude-proxy-policy";
import { claudeUpstreamHeaders, applyClaudeResponseCookies } from "@/lib/claude-upstream-policy";
export const CLAUDE_APP_ORIGIN = "https://claude.ai";
export const CLAUDE_PROXY_COOKIE = "trst_claude_proxy";
const TOOL_SLUG = "claude";
const HANDOFF_TTL_SECONDS = 60;
const SESSION_HOURS = 12;
const MAX_REQUEST_BYTES = 25 * 1024 * 1024;
export function claudeProxyPublicOrigin() {
  try {
    const u = new URL(String(process.env.CLAUDE_PROXY_PUBLIC_ORIGIN ?? ""));
    return u.protocol === "https:" && !u.username && !u.password ? u.origin : null;
  } catch {
    return null;
  }
}
export function isDedicatedClaudeProxyRequest(request: Request) {
  return new URL(request.url).origin === claudeProxyPublicOrigin();
}
/** generation changes whenever Admin replaces the account session, so writers drop cached state from the previous login. */
async function vaultSnapshot(account:ClaudeProviderAccountKey="account_1"): Promise<{ state: ClaudeSessionState; encrypted: string; generation: string }> {
  if(account==="account_2"){
    // Account 2 authentication lives in its browser profile. A pasted session
    // JSON (if any) is pushed into that profile on save; it is optional here.
    const {data}=await (supabaseAdmin as any).from("claude_provider_accounts").select("encrypted_payload,session_status,session_updated_at").eq("account_key","account_2").maybeSingle();
    if(data?.session_status==="stored"&&data.encrypted_payload){
      try{return {state:JSON.parse(decryptClaudeSession(data.encrypted_payload)),encrypted:data.encrypted_payload,generation:String(data.session_updated_at??"")};}catch{}
    }
    return {state:{version:2,cookies:[],session_tokens:{storage:{localStorage:{},sessionStorage:{}}}},encrypted:"",generation:String(data?.session_updated_at??"")};
  }
  const { data, error } = await (supabaseAdmin as any)
    .from("tool_authorized_sessions")
    .select("encrypted_payload,status,updated_at")
    .eq("tool_slug", TOOL_SLUG)
    .maybeSingle();
  if (error || data?.status !== "stored" || !data.encrypted_payload)
    throw new Error("Claude needs an authorised session from Admin.");
  return {
    state: JSON.parse(decryptClaudeSession(data.encrypted_payload)),
    encrypted: data.encrypted_payload,
    generation: String(data.updated_at ?? ""),
  };
}
async function vaultState(): Promise<ClaudeSessionState> {
  return (await vaultSnapshot()).state;
}
async function persistClaudeResponseCookies(
  snapshot: { state: ClaudeSessionState; encrypted: string },
  response: Response,
  path: string,
) {
  const rotated = applyClaudeResponseCookies(snapshot.state, response, path);
  if (!rotated.changed) return snapshot.state;
  const clean = normaliseClaudeSession(JSON.stringify(rotated.state));
  const { error } = await (supabaseAdmin as any)
    .from("tool_authorized_sessions")
    .update({
      encrypted_payload: encryptClaudeSession(clean),
      rotated_at: new Date().toISOString(),
    })
    .eq("tool_slug", TOOL_SLUG)
    .eq("status", "stored")
    .eq("encrypted_payload", snapshot.encrypted);
  if (error) throw new Error("Could not preserve the Claude session update.");
  // Check bodies for both previous and newly rotated credentials.
  return { ...snapshot.state, cookies: [...snapshot.state.cookies, ...rotated.state.cookies] };
}
function plain(status: number, message: string) {
  return new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
function json(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
// --------------------------------------------------------------- access

const unexpired = (v: string | null | undefined) => !v || new Date(v).getTime() > Date.now();

function isActiveOrder(o: any) {
  return (
    o.status === "approved" &&
    String(o.payment_status ?? "") === "successful" &&
    unexpired(o.expires_at) &&
    (String(o.access_type ?? "shared") !== "private" ||
      String(o.fulfilment_status ?? "") === "active")
  );
}

type Source = { kind: "order" | "grant"; id: string };

async function findActiveAccess(userId: string): Promise<Source | null> {
  const { data: orders } = await (supabaseAdmin as any)
    .from("tool_orders")
    .select("id, expires_at, access_type, fulfilment_status, payment_status, status")
    .eq("user_id", userId)
    .eq("tool_slug", TOOL_SLUG)
    .eq("status", "approved")
    .order("created_at", { ascending: false })
    .limit(20);
  const order = ((orders ?? []) as any[]).find(isActiveOrder);
  if (order) return { kind: "order", id: String(order.id) };
  const { data: grants } = await (supabaseAdmin as any)
    .from("tool_access_grants")
    .select("id, expires_at, status")
    .eq("user_id", userId)
    .eq("tool_slug", TOOL_SLUG)
    .eq("status", "active")
    .order("granted_at", { ascending: false })
    .limit(20);
  const grant = ((grants ?? []) as any[]).find((g) => unexpired(g.expires_at));
  return grant ? { kind: "grant", id: String(grant.id) } : null;
}

async function sourceStillActive(userId: string, source: Source) {
  if (source.kind === "order") {
    const { data } = await (supabaseAdmin as any)
      .from("tool_orders")
      .select("expires_at, access_type, fulfilment_status, payment_status, status")
      .eq("id", source.id)
      .eq("user_id", userId)
      .maybeSingle();
    return !!(data && isActiveOrder(data));
  }
  const { data } = await (supabaseAdmin as any)
    .from("tool_access_grants")
    .select("expires_at, status")
    .eq("id", source.id)
    .eq("user_id", userId)
    .maybeSingle();
  return !!(data && data.status === "active" && unexpired(data.expires_at));
}

async function requireToolEnabled() {
  const { data } = await (supabaseAdmin as any)
    .from("tool_settings")
    .select("enabled, one_click_auth_enabled")
    .eq("tool_slug", TOOL_SLUG)
    .maybeSingle();
  if (
    process.env.CLAUDE_PROXY_VERIFIED !== "true" ||
    !data ||
    data.enabled === false ||
    !data.one_click_auth_enabled
  ) {
    throw new Error(
      "Claude OneClick on claude.topratedseotools.com is awaiting server verification (CL-01).",
    );
  }
}

export const hashClaudeProxyToken = (token: string) =>
  createHash("sha256").update(token, "utf8").digest("hex");

export async function createClaudeProxyLaunch(userId: string) {
  const origin = claudeProxyPublicOrigin();
  if (!origin) throw new Error("Claude is not configured on this server yet.");
  await requireToolEnabled();
  const source = await findActiveAccess(userId);
  if (!source)
    throw new Error("An active Claude subscription or grant is required for One-Click Login.");
  const account = await assignedClaudeAccount(userId);
  await requireClaudeAccount(account);
  await vaultSnapshot(account);
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + HANDOFF_TTL_SECONDS * 1000).toISOString();
  const { error } = await (supabaseAdmin as any).from("claude_proxy_sessions").insert({
    provider_account_key: account,
    token_hash: hashClaudeProxyToken(token),
    user_id: userId,
    source_kind: source.kind,
    source_id: source.id,
    status: "issued",
    expires_at: expiresAt,
  });
  if (error) throw new Error("Could not start Claude. Please try again.");
  await (supabaseAdmin as any).from("tool_usage").insert({ tool_slug: TOOL_SLUG, user_id: userId });
  return {
    launchUrl: `${origin}/__trst/enter?ticket=${encodeURIComponent(token)}`,
    proxyPublicOrigin: origin,
    handoffExpiresAt: expiresAt,
  };
}

function parseCookies(request: Request) {
  const out = new Map<string, string>();
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out.set(part.slice(0, i).trim(), part.slice(i + 1).trim());
  }
  return out;
}

async function requireProxySession(request: Request) {
  const token = parseCookies(request).get(CLAUDE_PROXY_COOKIE);
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const hash = hashClaudeProxyToken(token);
  const { data: row } = await (supabaseAdmin as any)
    .from("claude_proxy_sessions")
    .select("id, user_id, source_kind, source_id, status, expires_at, provider_account_key")
    .eq("token_hash", hash)
    .eq("status", "active")
    .maybeSingle();
  if (!row || new Date(String(row.expires_at)).getTime() <= Date.now()) return null;
  await requireToolEnabled();
  const assigned = await assignedClaudeAccount(String(row.user_id));
  if(!claudeSessionMatchesAccount(assigned,row.provider_account_key)) {
    await (supabaseAdmin as any).from("claude_proxy_sessions").update({status:"revoked"}).eq("id",row.id);
    throw Error("Claude account changed. Launch again from your dashboard.");
  }
  await requireClaudeAccount(assigned);
  await vaultSnapshot(assigned);
  const ok = await sourceStillActive(String(row.user_id), {
    kind: row.source_kind,
    id: String(row.source_id),
  });
  if (!ok) {
    await (supabaseAdmin as any)
      .from("claude_proxy_sessions")
      .update({ status: "revoked" })
      .eq("id", row.id);
    return null;
  }
  await (supabaseAdmin as any)
    .from("claude_proxy_sessions")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", row.id);
  return row;
}

async function exchangeTicket(ticket: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(ticket))
    return plain(403, "This Claude link is invalid. Launch again from your account.");
  const hash = hashClaudeProxyToken(ticket);
  const { data: row } = await (supabaseAdmin as any)
    .from("claude_proxy_sessions")
    .select("id, user_id, source_kind, source_id, status, expires_at, provider_account_key")
    .eq("token_hash", hash)
    .maybeSingle();
  if (!row || row.status !== "issued" || new Date(row.expires_at).getTime() <= Date.now()) {
    return plain(403, "This Claude link has expired. Launch again from your account.");
  }
  await requireToolEnabled();
  const assigned = await assignedClaudeAccount(String(row.user_id));
  if(!claudeSessionMatchesAccount(assigned,row.provider_account_key)) {
    await (supabaseAdmin as any).from("claude_proxy_sessions").update({status:"revoked"}).eq("id",row.id);
    throw Error("Claude account changed. Launch again from your dashboard.");
  }
  await requireClaudeAccount(assigned);
  await vaultSnapshot(assigned);
  if (
    !(await sourceStillActive(String(row.user_id), {
      kind: row.source_kind,
      id: String(row.source_id),
    }))
  ) {
    return plain(403, "Your Claude access has expired. Return to your dashboard.");
  }
  const sessionToken = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 3600_000).toISOString();
  const { data: activated, error } = await (supabaseAdmin as any)
    .from("claude_proxy_sessions")
    .update({
      token_hash: hashClaudeProxyToken(sessionToken),
      status: "active",
      activated_at: new Date().toISOString(),
      expires_at: expiresAt,
    })
    .eq("id", row.id)
    .eq("status", "issued")
    .select("id")
    .maybeSingle();
  if (error || !activated)
    return plain(503, "Claude is temporarily unavailable. Please try again.");
  const h = new Headers({
    Location: "/new",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
  });
  h.append(
    "Set-Cookie",
    `${CLAUDE_PROXY_COOKIE}=${sessionToken}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${SESSION_HOURS * 3600}`,
  );
  return new Response(null, { status: 302, headers: h });
}

/** Returns metadata only; never return account/session values to the admin browser. */
export async function testClaudeUpstream(request?: Request) {
  let state: ClaudeSessionState;
  try {
    state = await vaultState();
  } catch {
    return { ok: false, code: "CL-01", message: "Save an authorised Claude session first." };
  }
  try {
    const response = await fetchClaudeProvider(`${CLAUDE_APP_ORIGIN}/api/organizations`, {
      headers: (() => {
        const incoming =
          request ??
          new Request(
            (claudeProxyPublicOrigin() ?? "https://claude.topratedseotools.com") + "/new",
          );
        const headers = claudeUpstreamHeaders(
          incoming,
          claudeCookieHeader(state, "/api/organizations"),
        );
        headers.set("Accept", "application/json");
        return headers;
      })(),
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
    });
    if (response.headers.get("cf-mitigated") === "challenge")
      return {
        ok: false,
        code: "CL-02",
        message:
          "Claude requires browser verification from this server. OneClick remains disabled.",
      };
    if ([401, 403].includes(response.status) || (response.status >= 300 && response.status < 400))
      return {
        ok: false,
        code: "CL-03",
        message: "Claude rejected the authorised session. Refresh it in Admin.",
      };
    if (!response.ok || !(response.headers.get("content-type") ?? "").includes("json"))
      return { ok: false, code: "CL-04", message: "Claude returned an unsupported response." };
    const payload = await response.json();
    if (
      !Array.isArray(payload) ||
      !payload.length ||
      !payload.every((o) => typeof o?.uuid === "string")
    )
      return { ok: false, code: "CL-04", message: "Claude organisation verification failed." };
    return {
      ok: true,
      code: "CL-00",
      message:
        "Session accepted. Native chat and writer isolation still require verification before launch is enabled.",
    };
  } catch {
    return { ok: false, code: "CL-05", message: "Could not reach Claude. Try again later." };
  }
}

async function ownsConversation(id: string, org: string | undefined, user: string, account:ClaudeProviderAccountKey) {
  let query = (supabaseAdmin as any)
    .from("claude_conversation_owners")
    .select("user_id,organization_id")
    .eq("conversation_id", id).eq("provider_account_key",account);
  if (org) query = query.eq("organization_id", org);
  const { data, error } = await query.maybeSingle();
  return !error && data?.user_id === user;
}

async function reserveWriterConversation(id:string,org:string,writer:string,account:ClaudeProviderAccountKey) {
 if(!/^[0-9a-f-]{36}$/i.test(org))return false;
 const existing=await (supabaseAdmin as any).from("claude_conversation_owners").select("user_id,organization_id").eq("conversation_id",id).eq("provider_account_key",account).maybeSingle();
 if(existing.error)throw Error("Could not verify conversation ownership");
 if(existing.data)return existing.data.user_id===writer&&existing.data.organization_id===org;
 // A client may propose a fresh UUID, but can never claim an existing provider chat.
 const probe=await fetchClaudeProvider(CLAUDE_APP_ORIGIN+"/api/organizations/"+org+"/chat_conversations/"+id,{signal:AbortSignal.timeout(20000)},account);
 await probe.body?.cancel();
 if(probe.status!==404)return false;
 const result=await (supabaseAdmin as any).from("claude_conversation_owners").insert({conversation_id:id,organization_id:org,user_id:writer,provider_account_key:account});
 if(result.error)return ownsConversation(id,org,writer,account);
 return true;
}
/** True when every provider file id belongs to this writer on this account. */
async function ownsFiles(ids:string[],writer:string,account:ClaudeProviderAccountKey,org?:string){
 if(!ids.length)return true;
 let query=(supabaseAdmin as any).from("claude_file_owners").select("file_id,user_id,organization_id").eq("provider_account_key",account).in("file_id",ids);
 const {data,error}=await query;
 if(error)throw Error("Could not verify file ownership");
 const mine=new Set((data??[]).filter((r:any)=>r.user_id===writer&&(!org||r.organization_id===org)).map((r:any)=>String(r.file_id)));
 return ids.every(id=>mine.has(id));
}
async function registerWriterFiles(ids:string[],org:string,writer:string,account:ClaudeProviderAccountKey,conversation?:string){
 if(!ids.length)return true;
 const rows=ids.map(file_id=>({file_id,organization_id:org,user_id:writer,provider_account_key:account,conversation_id:conversation??null}));
 const {error}=await (supabaseAdmin as any).from("claude_file_owners").upsert(rows,{onConflict:"provider_account_key,file_id",ignoreDuplicates:true});
 if(error)return false;
 // A provider id already claimed by someone else must never become visible to this writer.
 return ownsFiles(ids,writer,account,org);
}
function filterClaudeModelCatalog(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.filter(entry => !isDisabledClaudeModel(entry) &&
      ![entry?.id, entry?.name, entry?.model, entry?.model_id, entry?.display_name].some(isDisabledClaudeModel))
      .map(filterClaudeModelCatalog);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .filter(([key, entry]) => !isDisabledClaudeModel(key) && !isDisabledClaudeModel(entry))
      .map(([key, entry]) => [key, filterClaudeModelCatalog(entry)]));
  }
  return value;
}

function writerBootstrap(writer:string){
 const marker=hashClaudeProxyToken(writer).slice(0,16);
 const code=`(()=>{
 const marker=${JSON.stringify(marker)};
 try{if(localStorage.getItem("trstClaudeWriter")!==marker){localStorage.clear();sessionStorage.clear();for(const c of document.cookie.split(";")){const n=c.split("=")[0].trim();if(n)document.cookie=n+"=; Max-Age=0; Path=/"}try{indexedDB.databases?.().then(l=>l.forEach(d=>d.name&&indexedDB.deleteDatabase(d.name))).catch(()=>{})}catch{}localStorage.setItem("trstClaudeWriter",marker)}}catch{}
 function show(d){
  if(d?.code!=="daily_limit"||document.getElementById("trst-claude-daily-limit"))return;
  const e=document.createElement("div");e.id="trst-claude-daily-limit";e.setAttribute("role","alert");
  e.style.cssText="position:fixed;inset:40% 12% auto;z-index:2147483647;padding:24px;background:#b91c1c;color:white;text-align:center;border-radius:12px;font:600 18px system-ui";
  e.textContent="Daily limit reached. Your Claude messages reset at midnight Nigeria time.";
  document.body?.append(e);setTimeout(()=>e.remove(),3000);
 }
 const F=window.fetch;
 window.fetch=async function(...args){const r=await F.apply(this,args);if(r.status===429)r.clone().json().then(show).catch(()=>{});if(r.status===429||r.headers.has("X-TRST-Messages-Remaining"))refreshUsage();return r};
 const S=XMLHttpRequest.prototype.send;
 XMLHttpRequest.prototype.send=function(){
  this.addEventListener("load",()=>{if(this.status===429||this.getResponseHeader("X-TRST-Messages-Remaining")!==null)refreshUsage();if(this.status!==429)return;try{show(this.responseType==="json"?this.response:JSON.parse(this.responseText))}catch{}});
  return S.apply(this,arguments);
 };
 let usage, panel, pill, label, count, reset, pending, accountTag;
 const preference="trst_claude_usage_collapsed";
 function element(tag,text,style){
  const node=document.createElement(tag);
  node.textContent=text;
  node.style.cssText=style;
  return node;
 }
 function setCollapsed(collapsed){
  panel.style.display=collapsed?"none":"block";
  pill.style.display=collapsed?"flex":"none";
  try{localStorage.setItem(preference,collapsed?"1":"0")}catch{}
 }
 function renderUsage(){
  if(!usage||!document.body)return;
  if(!panel){
   const corner="position:fixed;bottom:20px;right:20px;z-index:2147483647;background:#0f172a;color:white;border:1px solid #3f7fd1;box-shadow:0 8px 30px rgba(0,0,0,.3);";
   panel=element("div","",corner+"min-width:235px;max-width:min(310px,calc(100vw - 40px));border-radius:12px;padding:12px 14px;font:12px/1.45 system-ui,-apple-system,sans-serif");
   panel.id="trst-claude-usage";
   const title=element("div","", "display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:4px");
   title.append(element("div","Top Rated SEO Tools","font-weight:800;color:#60a5fa;font-size:13px"));
   accountTag=element("div","","font-size:10px;font-weight:600;color:#94a3b8;white-space:nowrap");
   const close=element("button","\u00d7","margin-left:2px;width:22px;height:22px;border:0;border-radius:6px;background:rgba(255,255,255,.08);color:#e2e8f0;font:700 15px/22px system-ui;cursor:pointer;padding:0;flex:none");
   close.type="button";
   close.id="trst-claude-usage-close";
   close.title="Hide";
   close.setAttribute("aria-label","Hide Top Rated SEO Tools panel");
   close.onclick=e=>{e.stopPropagation();setCollapsed(true)};
   const tools=element("div","","display:flex;align-items:center;gap:6px");
   tools.append(accountTag,close);
   title.append(tools);
   label=element("div","","font-size:11px;color:#cbd5e1;margin-bottom:10px;overflow-wrap:anywhere");
   const row=element("div","","display:flex;justify-content:space-between;gap:14px;margin:4px 0");
   count=element("strong","","");
   row.append(element("span","Claude messages",""),count);
   reset=element("div","","margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,.14);color:#cbd5e1");
   panel.append(title,label,row,reset);
   pill=element("button","\\u2039","position:fixed;top:50%;right:0;transform:translateY(-50%);z-index:2147483647;width:18px;height:44px;padding:0;border:1px solid #3f7fd1;border-right:0;border-radius:8px 0 0 8px;background:#0f172a;color:#60a5fa;opacity:.75;align-items:center;justify-content:center;font:700 16px system-ui;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.25)");
   pill.title="Show Top Rated SEO Tools usage";
   pill.id="trst-claude-usage-pill";
   pill.type="button";
   pill.setAttribute("aria-label","Show Top Rated SEO Tools usage");
   pill.onclick=()=>setCollapsed(false);
   document.body.append(panel,pill);
   let collapsed=false;
   try{collapsed=localStorage.getItem(preference)==="1"}catch{}
   setCollapsed(collapsed);
  }
  label.textContent=usage.user_label||"Customer";
  accountTag.textContent=usage.account_label||"";
  count.textContent=usage.used+" / "+usage.limit+" used";
  const seconds=Math.max(0,Math.ceil((Date.parse(usage.resets_at)-Date.now())/1000));
  reset.textContent="Resets in "+Math.floor(seconds/3600)+"h "+Math.floor(seconds%3600/60)+"m "+seconds%60+"s";
 }
 function refreshUsage(){
  if(!pending){
   pending=(async()=>{
    try{
     const response=await F.call(window,"/__trst/usage",{credentials:"same-origin",cache:"no-store"});
     if(response.ok){usage=await response.json();renderUsage();return usage}
    }catch{}
   })().finally(()=>{pending=undefined});
  }
  return pending;
 }
 function startUsage(){
  refreshUsage();
  setInterval(renderUsage,1000);
  setInterval(refreshUsage,15000);
  window.addEventListener("focus",refreshUsage);
 }
 if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",startUsage,{once:true});
 else startUsage();
 async function check(){const current=await refreshUsage();if(current?.remaining===0)show({code:"daily_limit"})}
 document.addEventListener("click",e=>{const b=e.target instanceof Element?e.target.closest("button"):null;if(b?.getAttribute("aria-label")==="Send message")check()},true);
 document.addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey&&e.target instanceof Element&&e.target.closest("[contenteditable=true]"))check()},true);
 })();`;
 return "<script>"+code+"</script>";
}

import {
  claudeResponseContainsSecret,
  filterClaudeConversationList,
} from "@/lib/claude-proxy-policy";

/** Owned file previews/downloads: no script execution on the proxy origin. */
function applyFileHeaders(out: Headers, upstream: Response, type: string) {
  out.set("Content-Security-Policy", "sandbox; default-src 'none'; img-src 'self' data: blob:; style-src 'unsafe-inline'; media-src 'self'");
  const disposition = upstream.headers.get("content-disposition");
  if (/html|svg|xml|javascript/i.test(type)) out.set("Content-Disposition", disposition?.replace(/^\s*inline/i, "attachment") || "attachment");
  else if (disposition && !/[\r\n]/.test(disposition)) out.set("Content-Disposition", disposition);
}

export async function handleClaudeProxyRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  try {
    if (url.pathname === "/__trst/enter") {
      if (request.method !== "GET") return plain(405, "Method not allowed");
      return exchangeTicket(url.searchParams.get("ticket") ?? "");
    }
    const session = await requireProxySession(request);
    if (!session) return plain(401, "Open Claude from your Top Rated SEO Tools account.");
    if (!["GET", "HEAD"].includes(request.method) && request.headers.get("origin") !== url.origin)
      return plain(403, "Invalid request origin");
    if (url.pathname === "/__trst/usage") {
      if (request.method !== "GET") return plain(405, "Method not allowed");
      const userId = String(session.user_id);
      const [usage, userLabel] = await Promise.all([getClaudeUsage(userId), getStealthWriterUserLabel(userId)]);
      return json(200, { ...usage, user_label: userLabel, account_label: session.provider_account_key === "account_2" ? "Account 2" : "Account 1" });
    }
    const shared = false;
    const browser=claudeBrowserTransportEnabled();
    const route = browser ? claudeBrowserRoutePolicy(request.method, url.pathname) : claudeRoutePolicy(request.method, url.pathname);
    if (!route || url.searchParams.has("_rsc") || request.headers.has("rsc"))
      return json(403, { error: "This Claude feature is not available through OneClick." });
    if(route.kind==="integration"){const lower=(url.pathname+url.search).toLowerCase();if([...blockedConnectorIds].some(id=>lower.includes(id)))return json(403,{error:"GitHub and Supabase connectors are not available on Claude OneClick."});}
    const rpc=browser && route.kind==="rpc";
    const writer = String(session.user_id);
    const account:ClaudeProviderAccountKey = session.provider_account_key;
    if(route.conversation&&!await ownsConversation(route.conversation,route.org,writer,account)){
      const firstMessage=((browser&&request.method==="POST"&&/\/completion$/.test(url.pathname))||(route.kind==="upload"&&route.upload==="wiggle"))&&route.org;
      if(!firstMessage||!await reserveWriterConversation(route.conversation,route.org!,writer,account))return json(404,{error:"Conversation not found"});
    }
    if(route.kind==="file"&&route.file&&!await ownsFiles([route.file],writer,account,route.org))
      return json(404,{error:"File not found"});
    let body: string | ArrayBuffer | undefined;
    let createId: string | undefined;
    let messageKey:string|undefined;
    if (!["GET", "HEAD"].includes(request.method)) {
      if (Number(request.headers.get("content-length") ?? 0) > MAX_REQUEST_BYTES)
        return plain(413, "Request too large");
      const bytes = await request.arrayBuffer();
      if (bytes.byteLength > MAX_REQUEST_BYTES) return plain(413, "Request too large");
      if(route.kind==="integration"&&!(request.headers.get("content-type")??"").includes("application/json")){
       // Plugin packages and connector forms may be multipart or empty; names are still checked.
       const sample=new TextDecoder().decode(bytes.slice(0,65536));
       if(BLOCKED_CONNECTOR_RE.test(sample)||[...blockedConnectorIds].some(id=>sample.toLowerCase().includes(id)))
        return json(403,{error:"GitHub and Supabase connectors are not available on Claude OneClick."});
       body=bytes;
      }
      else if(route.kind==="upload"){
       const type=request.headers.get("content-type")??"";
       if(!/^multipart\/form-data;\s*boundary=/i.test(type))return plain(415,"File upload required");
       body=bytes;
      }
      else if(rpc){
       let info:ReturnType<typeof inspectClaudeWriterRpc>;
       try{info=inspectClaudeWriterRpc(url.pathname,new Uint8Array(bytes),request.headers.get("content-type")??"",request.headers.get("connect-content-encoding"));}
       catch{return json(403,{error:"This Claude action is not available through writer access."});}
       // RPC writes remain closed until all memory/tool semantics are verified.
       // Fresh writer browser profiles use the supported REST text-chat path.
       if(info.kind!=="read")return json(403,{error:"Refresh Claude from your dashboard to use writer text chat."});
       const org=(request.headers.get("x-organization-uuid")??"").toLowerCase();
       if(!await reserveWriterConversation(info.conversation,org,writer,account))return json(404,{error:"Conversation not found"});

       body=bytes;
      }
      else {
      if (!(request.headers.get("content-type") ?? "").includes("application/json"))
        return plain(415, "JSON required");
      body = new TextDecoder().decode(bytes);
      let payload: any;
      try {
        payload = JSON.parse(body);
      } catch {
        return plain(400, "Invalid JSON");
      }
      if (!payload || typeof payload !== "object" || Array.isArray(payload))
        return plain(400, "Invalid JSON object");
      if (route.kind === "integration" && JSON.stringify(withoutBlockedConnectors({x:[payload]})) !== JSON.stringify({x:[payload]}))
        return json(403, { error: "GitHub and Supabase connectors are not available on Claude OneClick." });
      if (requestUsesDisabledModel(payload))
        return json(403, { error: "Fable and Opus are unavailable on Claude OneClick. Choose Sonnet or Haiku." });
      if (clampClaudeRequestEffort(payload)) body = JSON.stringify(payload);
      if(route.kind==="conversation"&&/\/(?:completion|retry_completion)$/.test(url.pathname)){
       const requestId=typeof payload.completion_request_id==="string"&&payload.completion_request_id.length<=128?payload.completion_request_id:crypto.randomUUID();
       messageKey=hashClaudeProxyToken(route.conversation+":"+requestId);
       payload=isolateClaudeWriterPayload(payload);body=JSON.stringify(payload);
      }
      // Writers may attach only their own uploads; projects and connectors stay closed.
      // Connector/plugin management bodies are checked for blocked providers above, not as message attachments.
      const refs=route.kind==="integration"?{fileIds:[],blocked:null}:claudeWriterReferences(payload);
      if(refs.blocked){
        console.warn("[claude-proxy] refused reference shape",refs.blocked,url.pathname.replace(/[0-9a-f-]{36}/gi,":id"));
        return json(403, { error: "Projects, connectors and shared files are not available on Claude OneClick. Upload the file again in this chat." });
      }
      if(!await ownsFiles(refs.fileIds,writer,account,route.org))
        return json(404, { error: "File not found. Upload it again in this chat." });
      if (route.kind === "create" && !shared) {
        applyClaudeNewConversationDefaults(payload);
        payload.chat_memory_mode="disabled";payload.include_conversation_preferences=false;
        // Native clients retain their proposed UUID. Reserve it only after verifying
        // that it is fresh upstream; an existing shared chat can never be claimed.
        if(payload.uuid!==undefined){
          if(typeof payload.uuid!=="string"||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.uuid))return plain(400,"Invalid conversation id");
          createId=payload.uuid.toLowerCase();
          if(!await reserveWriterConversation(createId!,route.org!,writer,account))return json(404,{error:"Conversation not found"});
        }else{
          createId=crypto.randomUUID();
          const {error}=await (supabaseAdmin as any).from("claude_conversation_owners").insert({conversation_id:createId,organization_id:route.org,user_id:writer,provider_account_key:account});
          if(error)return plain(503,"Could not reserve the conversation. Try again.");
        }
        payload.uuid=createId;
        body=JSON.stringify(payload);
      }
      }
    }
    let quota:Awaited<ReturnType<typeof reserveClaudeMessage>>|undefined;
    if(messageKey){
     quota=await reserveClaudeMessage(writer,messageKey);
     if(!quota.allowed)return json(quota.code==="duplicate"?409:429,{error:quota.code==="duplicate"?"This message was already submitted. Reload to see its reply.":"Daily limit reached. Your Claude messages reset at midnight Nigeria time.",...quota});
    }
    const snapshot = await vaultSnapshot(account);
    let state = snapshot.state;
    // Serve a neutral SPA shell on owned chat pages. Provider chat HTML can
    // preload account-wide state; the client loads the owned transcript via API.
    const target = new URL(route.kind==="page"&&route.conversation?"/new":url.pathname+url.search,CLAUDE_APP_ORIGIN);
    const headers = claudeUpstreamHeaders(request, claudeCookieHeader(state, target.pathname));
    const upstream = await fetchClaudeProvider(target, {
      method: request.method,
      headers,
      body,
      redirect: "manual",
      signal: request.signal,
    }, account);
    if(messageKey&&!upstream.ok)await releaseClaudeMessage(writer,messageKey);
    if (upstream.headers.get("cf-mitigated") === "challenge")
      return plain(503, "Claude requires browser verification. Please contact Admin (CL-02).");
    if ([401, 403].includes(upstream.status))
      return plain(503, "Claude needs to be refreshed by Admin (CL-03).");
    if (!claudeBrowserTransportEnabled()) state = await persistClaudeResponseCookies(snapshot, upstream, target.pathname);
    if (upstream.status >= 300 && upstream.status < 400) {
      const dest = new URL(upstream.headers.get("location") ?? "/new", target);
      if (dest.origin !== CLAUDE_APP_ORIGIN || !claudeRoutePolicy("GET", dest.pathname))
        return plain(503, "Claude requires an Admin session refresh (CL-03).");
      if (route.conversation && dest.pathname !== url.pathname)
        return plain(403, "Redirect refused");
      return new Response(null, {
        status: upstream.status,
        headers: {
          Location: dest.pathname + dest.search,
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
        },
      });
    }
    const type = upstream.headers.get("content-type") ?? "application/octet-stream";
    const out = new Headers({
      "Content-Type": type,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex, nofollow",
      "X-Content-Type-Options": "nosniff",
    });
    out.set("Content-Security-Policy","connect-src 'self' https://assets-proxy.anthropic.com; form-action 'self'; object-src 'none'; base-uri 'self'");
    if(quota)out.set("X-TRST-Messages-Remaining",String(quota.remaining));
    if(rpc) {
      for(const name of ["connect-content-encoding","connect-accept-encoding","connect-protocol-version","grpc-status","grpc-message"]){const value=upstream.headers.get(name);if(value)out.set(name,value);}
      return new Response(upstream.body,{status:upstream.status,headers:out});
    }
    // Stream tokens without buffering the completion; only owned conversation routes reach here.
    if (type.includes("text/event-stream")) {
      if (route.kind !== "conversation") return plain(502, "Unexpected Claude stream");
      return new Response(upstream.body, { status: upstream.status, headers: out });
    }
    if ([204, 205, 304].includes(upstream.status) || request.method === "HEAD")
      return new Response(null, { status: upstream.status, headers: out });
    if (!/text\/|javascript|json|xml|svg/i.test(type)) {
      if (route.kind === "file") { applyFileHeaders(out, upstream, type); return new Response(upstream.body, { status: upstream.status, headers: out }); }
      if (route.kind === "integration") { applyFileHeaders(out, upstream, type); return new Response(upstream.body, { status: upstream.status, headers: out }); }
      if (route.kind !== "asset") return plain(502, "Unexpected Claude response");
      return new Response(upstream.body, { status: upstream.status, headers: out });
    }
    let text = await upstream.text();
    if (claudeResponseContainsSecret(text, state))
      return plain(502, "Claude returned private account state. Contact Admin (CL-06).");
    // Writer file contents are returned byte-for-byte, never rewritten or rendered on this origin.
    if (route.kind === "file") { applyFileHeaders(out, upstream, type); return new Response(text, { status: upstream.status, headers: out }); }
    if (route.kind === "upload" && upstream.ok && route.org && type.includes("json")) {
      let uploaded: any;
      try { uploaded = JSON.parse(text); } catch { return plain(502, "Invalid Claude upload response"); }
      if (!await registerWriterFiles(claudeUploadedFileIds(uploaded), route.org, writer, account, route.conversation))
        return plain(503, "Could not save your file privately. Try again.");
    }
    if (type.includes("json")) {
      let payload: any;
      try {
        payload = JSON.parse(text);
      } catch {
        return plain(502, "Invalid Claude response");
      }
      if (route.kind === "list" && !shared) {
        const { data, error } = await (supabaseAdmin as any)
          .from("claude_conversation_owners")
          .select("conversation_id")
          .eq("user_id", writer)
          .eq("organization_id", route.org).eq("provider_account_key",account);
        if (error) return plain(503, "Could not load your chat history");
        try {
          payload = filterClaudeWriterHistory(
            payload,
            new Set((data ?? []).map((r: any) => String(r.conversation_id))),
          );
        } catch {
          return plain(502, "Claude history format changed. Contact Admin (CL-06).");
        }
      }
      if (createId && upstream.ok && payload?.uuid !== createId)
        return plain(502, "Claude conversation could not be verified (CL-06).");
      if(route.kind==="bootstrap")payload=sanitizeClaudeBootstrap(payload);
      if(route.kind==="integration")payload=withoutBlockedConnectors(payload);
      if (upstream.ok && /\/(?:models|model_configs)$/.test(url.pathname))
        payload = filterClaudeModelCatalog(payload);
      payload = applyClaudeWriterModelPolicy(payload);
      text = JSON.stringify(payload);
    }
    if (type.includes("text/html")) {
      // Until native hydration is verified, reject server-rendered chat state.
      // Unknown payload formats must never expose the shared account's history.
      // The client builds this list URL in an inline script. Ignore only the URL token.
      const stateCheck = text.replace(/(["'])\/chat_conversations_v2(?=\?limit=)/gi, "$1/");
      if ((!shared && /chat_conversations|chat_messages|project_uuid|\\\\u0022chat_/i.test(stateCheck)) || /["']sessionKey["']\s*:/.test(text))
        return plain(502, "Claude returned embedded private state. Contact Admin (CL-06).");
      text = text.replace(/<head([^>]*)>/i, (m) => m + writerBootstrap(writer+":"+account+":"+snapshot.generation) + claudeBootstrapScript());
    }
    return new Response(rewriteClaudeBody(text, url.origin), {
      status: upstream.status,
      headers: out,
    });
  } catch {
    return plain(503, "Claude OneClick is awaiting Admin setup or verification (CL-01).");
  }
}
