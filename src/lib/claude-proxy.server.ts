import {inspectClaudeWriterRpc,sanitizeClaudeBootstrap,filterClaudeWriterHistory,claudeWriterHasExternalReferences,isolateClaudeWriterPayload} from "@/lib/claude-writer-policy";
import {getClaudeUsage,reserveClaudeMessage,releaseClaudeMessage} from "@/lib/claude-controls.server";
import {fetchClaudeProvider,claudeSharedBrowserTransport,claudeBrowserTransportEnabled} from "@/lib/claude-browser-fetch.server";
import {claudeBrowserRoutePolicy} from "@/lib/claude-browser-route-policy";
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
async function vaultSnapshot(): Promise<{ state: ClaudeSessionState; encrypted: string }> {
  const { data, error } = await (supabaseAdmin as any)
    .from("tool_authorized_sessions")
    .select("encrypted_payload,status")
    .eq("tool_slug", TOOL_SLUG)
    .maybeSingle();
  if (error || data?.status !== "stored" || !data.encrypted_payload)
    throw new Error("Claude needs an authorised session from Admin.");
  return {
    state: JSON.parse(decryptClaudeSession(data.encrypted_payload)),
    encrypted: data.encrypted_payload,
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
  await vaultState();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + HANDOFF_TTL_SECONDS * 1000).toISOString();
  const { error } = await (supabaseAdmin as any).from("claude_proxy_sessions").insert({
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
    .select("id, user_id, source_kind, source_id, status, expires_at")
    .eq("token_hash", hash)
    .eq("status", "active")
    .maybeSingle();
  if (!row || new Date(String(row.expires_at)).getTime() <= Date.now()) return null;
  await requireToolEnabled();
  await vaultState();
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
    .select("id, user_id, source_kind, source_id, status, expires_at")
    .eq("token_hash", hash)
    .maybeSingle();
  if (!row || row.status !== "issued" || new Date(row.expires_at).getTime() <= Date.now()) {
    return plain(403, "This Claude link has expired. Launch again from your account.");
  }
  await requireToolEnabled();
  await vaultState();
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

async function ownsConversation(id: string, org: string | undefined, user: string) {
  let query = (supabaseAdmin as any)
    .from("claude_conversation_owners")
    .select("user_id,organization_id")
    .eq("conversation_id", id);
  if (org) query = query.eq("organization_id", org);
  const { data, error } = await query.maybeSingle();
  return !error && data?.user_id === user;
}

async function reserveWriterConversation(id:string,org:string,writer:string) {
 if(!/^[0-9a-f-]{36}$/i.test(org))return false;
 const existing=await (supabaseAdmin as any).from("claude_conversation_owners").select("user_id,organization_id").eq("conversation_id",id).maybeSingle();
 if(existing.error)throw Error("Could not verify conversation ownership");
 if(existing.data)return existing.data.user_id===writer&&existing.data.organization_id===org;
 // A client may propose a fresh UUID, but can never claim an existing provider chat.
 const probe=await fetchClaudeProvider(CLAUDE_APP_ORIGIN+"/api/organizations/"+org+"/chat_conversations/"+id,{signal:AbortSignal.timeout(20000)});
 await probe.body?.cancel();
 if(probe.status!==404)return false;
 const result=await (supabaseAdmin as any).from("claude_conversation_owners").insert({conversation_id:id,organization_id:org,user_id:writer});
 if(result.error)return ownsConversation(id,org,writer);
 return true;
}
function writerBootstrap(writer:string){
 const marker=hashClaudeProxyToken(writer).slice(0,16);
 const code=`(()=>{
 const marker=${JSON.stringify(marker)};
 try{if(localStorage.getItem("trstClaudeWriter")!==marker){localStorage.clear();sessionStorage.clear();localStorage.setItem("trstClaudeWriter",marker)}}catch{}
 function show(d){
  if(d?.code!=="daily_limit"||document.getElementById("trst-claude-daily-limit"))return;
  const e=document.createElement("div");e.id="trst-claude-daily-limit";e.setAttribute("role","alert");
  e.style.cssText="position:fixed;inset:40% 12% auto;z-index:2147483647;padding:24px;background:#b91c1c;color:white;text-align:center;border-radius:12px;font:600 18px system-ui";
  e.textContent="Daily limit reached. Your Claude messages reset at midnight Nigeria time.";
  document.body?.append(e);setTimeout(()=>e.remove(),3000);
 }
 const F=window.fetch;
 window.fetch=async function(...args){const r=await F.apply(this,args);if(r.status===429)r.clone().json().then(show).catch(()=>{});return r};
 const S=XMLHttpRequest.prototype.send;
 XMLHttpRequest.prototype.send=function(){
  this.addEventListener("load",()=>{if(this.status!==429)return;try{show(this.responseType==="json"?this.response:JSON.parse(this.responseText))}catch{}});
  return S.apply(this,arguments);
 };
 async function check(){try{const r=await F.call(window,"/__trst/usage",{credentials:"same-origin"});if(r.ok&&Number((await r.json()).remaining)===0)show({code:"daily_limit"})}catch{}}
 document.addEventListener("click",e=>{const b=e.target instanceof Element?e.target.closest("button"):null;if(b?.getAttribute("aria-label")==="Send message")check()},true);
 document.addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey&&e.target instanceof Element&&e.target.closest("[contenteditable=true]"))check()},true);
 })();`;
 return "<script>"+code+"</script>";
}

import {
  claudeResponseContainsSecret,
  filterClaudeConversationList,
} from "@/lib/claude-proxy-policy";

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
    if(url.pathname==="/__trst/usage"){if(request.method!=="GET")return plain(405,"Method not allowed");return json(200,await getClaudeUsage(String(session.user_id)));}
    const shared = false;
    const browser=claudeBrowserTransportEnabled();
    const route = browser ? claudeBrowserRoutePolicy(request.method, url.pathname) : claudeRoutePolicy(request.method, url.pathname);
    if (!route || url.searchParams.has("_rsc") || request.headers.has("rsc"))
      return json(403, { error: "This Claude feature is not available through OneClick." });
    const rpc=browser && route.kind==="rpc";
    const writer = String(session.user_id);
    if(route.conversation&&!await ownsConversation(route.conversation,route.org,writer)){
      const firstMessage=browser&&request.method==="POST"&&/\/completion$/.test(url.pathname)&&route.org;
      if(!firstMessage||!await reserveWriterConversation(route.conversation,route.org!,writer))return json(404,{error:"Conversation not found"});
    }
    let body: string | ArrayBuffer | undefined;
    let createId: string | undefined;
    let messageKey:string|undefined;
    if (!["GET", "HEAD"].includes(request.method)) {
      if (Number(request.headers.get("content-length") ?? 0) > MAX_REQUEST_BYTES)
        return plain(413, "Request too large");
      const bytes = await request.arrayBuffer();
      if (bytes.byteLength > MAX_REQUEST_BYTES) return plain(413, "Request too large");
      if(rpc){
       let info:ReturnType<typeof inspectClaudeWriterRpc>;
       try{info=inspectClaudeWriterRpc(url.pathname,new Uint8Array(bytes),request.headers.get("content-type")??"",request.headers.get("connect-content-encoding"));}
       catch{return json(403,{error:"This Claude action is not available through writer access."});}
       // RPC writes remain closed until all memory/tool semantics are verified.
       // Fresh writer browser profiles use the supported REST text-chat path.
       if(info.kind!=="read")return json(403,{error:"Refresh Claude from your dashboard to use writer text chat."});
       const org=(request.headers.get("x-organization-uuid")??"").toLowerCase();
       if(!await reserveWriterConversation(info.conversation,org,writer))return json(404,{error:"Conversation not found"});

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
      if(route.kind==="conversation"&&/\/(?:completion|retry_completion)$/.test(url.pathname)){
       const requestId=typeof payload.completion_request_id==="string"&&payload.completion_request_id.length<=128?payload.completion_request_id:crypto.randomUUID();
       messageKey=hashClaudeProxyToken(route.conversation+":"+requestId);
       payload=isolateClaudeWriterPayload(payload);body=JSON.stringify(payload);
      }
      // File/project/integration references require their own ownership tracking.
      if(claudeWriterHasExternalReferences(payload))
        return json(403, { error: "File, project and integration access has not been enabled." });
      if (route.kind === "create" && !shared) {
        payload.chat_memory_mode="disabled";payload.include_conversation_preferences=false;
        // Native clients retain their proposed UUID. Reserve it only after verifying
        // that it is fresh upstream; an existing shared chat can never be claimed.
        if(payload.uuid!==undefined){
          if(typeof payload.uuid!=="string"||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.uuid))return plain(400,"Invalid conversation id");
          createId=payload.uuid.toLowerCase();
          if(!await reserveWriterConversation(createId!,route.org!,writer))return json(404,{error:"Conversation not found"});
        }else{
          createId=crypto.randomUUID();
          const {error}=await (supabaseAdmin as any).from("claude_conversation_owners").insert({conversation_id:createId,organization_id:route.org,user_id:writer});
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
    const snapshot = await vaultSnapshot();
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
    });
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
      if (route.kind !== "asset") return plain(502, "Unexpected Claude response");
      return new Response(upstream.body, { status: upstream.status, headers: out });
    }
    let text = await upstream.text();
    if (claudeResponseContainsSecret(text, state))
      return plain(502, "Claude returned private account state. Contact Admin (CL-06).");
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
          .eq("organization_id", route.org);
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
      text = JSON.stringify(payload);
    }
    if (type.includes("text/html")) {
      // Until native hydration is verified, reject server-rendered chat state.
      // Unknown payload formats must never expose the shared account's history.
      if ((!shared && /chat_conversations|chat_messages|project_uuid|\\\\u0022chat_/i.test(text)) || /["']sessionKey["']\s*:/.test(text))
        return plain(502, "Claude returned embedded private state. Contact Admin (CL-06).");
      text = text.replace(/<head([^>]*)>/i, (m) => m + writerBootstrap(writer) + claudeBootstrapScript());
    }
    return new Response(rewriteClaudeBody(text, url.origin), {
      status: upstream.status,
      headers: out,
    });
  } catch {
    return plain(503, "Claude OneClick is awaiting Admin setup or verification (CL-01).");
  }
}
