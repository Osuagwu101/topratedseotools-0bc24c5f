/** AWS Phrasly extension contracts: isolated backend adapter, server only.
 * No route enables the extension; Phase 4 is responsible for UI distribution.
 */
import { createHash, randomBytes } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { issueAwsHandoff, issueAwsRecordToken, verifyAwsToken, secondsUntilWatReset, watUsageDay } from "@/lib/phrasly-extension/protocol.server";
import { decryptPhraslySession, type PhraslySessionState } from "@/lib/phrasly-session.server";

const TOOL = "phrasly";
const EXT_ORIGIN = "chrome-extension://lpgnjkafilbopdojcfnagooojifkccek";
const FEATURES = ["humanizer", "ai_detector", "default"] as const;
type Feature = typeof FEATURES[number];
const db = supabaseAdmin as any;

function enabled() {
  if (process.env.PHRASLY_EXTENSION_ENABLED !== "true") throw new OneclickError("service_unavailable",503);
}
function secret() {
  const v = process.env.PHRASLY_AWS_EXTENSION_GATE_SECRET || "";
  if (Buffer.byteLength(v) < 32) throw new Error("handoff_secret_required");
  return v;
}
function feature(raw: unknown): Feature {
  if (typeof raw === "string" && FEATURES.includes(raw as Feature)) return raw as Feature;
  throw new OneclickError("no_access",403);
}
export class OneclickError extends Error {
  constructor(public code: string,public status = 403) { super(code); }
}
export function oneclickJson(body: unknown, status=200, extension=false) {
  return new Response(JSON.stringify(body),{status,headers:{
    "Content-Type":"application/json",
    "Cache-Control":"no-store",
    "X-Content-Type-Options":"nosniff",
    ...(extension ? {"Access-Control-Allow-Origin":EXT_ORIGIN,"Vary":"Origin"} : {})
  }});
}
export function oneclickFailure(err: unknown, extension=false) {
  const e = err instanceof OneclickError ? err : new OneclickError("service_unavailable",503);
  return oneclickJson({ok:false,error:e.code},e.status,extension);
}
export async function verifiedWriter(request: Request) {
  const bearer = request.headers.get("authorization");
  if (!bearer?.startsWith("Bearer ")) throw new OneclickError("not_signed_in",401);
  const {data,error} = await db.auth.getUser(bearer.slice(7));
  if (error || !data.user) throw new OneclickError("not_signed_in",401);
  await activeWriter(data.user.id);
  return data.user.id as string;
}
async function activeWriter(uid: string) {
  const {data,error} = await db.from("profiles").select("account_status").eq("id",uid).maybeSingle();
  if(error || !data || data.account_status === "suspended") throw new OneclickError("account_inactive",403);
}
async function activeTopRatedAccess(uid:string) {
  const {data:grants,error:grantError}=await db.from("tool_access_grants")
    .select("status,expires_at").eq("user_id",uid).eq("tool_slug",TOOL).eq("status","active").limit(20);
  if(grantError) throw new OneclickError("service_unavailable",503);
  const now=Date.now();
  const granted=(grants||[]).some((g:any)=>g.status==="active" && (!g.expires_at || Date.parse(g.expires_at)>now));
  if(granted) return;
  const {data:orders,error:orderError}=await db.from("tool_orders")
    .select("status,payment_status,expires_at,access_type,fulfilment_status")
    .eq("user_id",uid).eq("tool_slug",TOOL).eq("status","approved").limit(20);
  if(orderError) throw new OneclickError("service_unavailable",503);
  const paid=(orders||[]).some((o:any)=>o.status==="approved" && o.payment_status==="successful" &&
    (!o.expires_at || Date.parse(o.expires_at)>now) &&
    (o.access_type!=="private" || o.fulfilment_status==="active"));
  if(!paid) throw new OneclickError("no_access",403);
}

async function allowedFeature(uid: string, f: Feature) {
  await activeWriter(uid);
  await activeTopRatedAccess(uid);
  const {data,error}=await db.from("phrasly_oneclick_feature_grants")
    .select("daily_limit,enabled").eq("user_id",uid).eq("tool_id",TOOL).eq("feature_key",f).maybeSingle();
  if(error) throw new OneclickError("service_unavailable",503);
  if(!data?.enabled || !Number.isInteger(data.daily_limit) || data.daily_limit < 1) throw new OneclickError("no_access",403);
  return data.daily_limit as number;
}
async function usage(uid:string,f:Feature) {
  const day=watUsageDay(Math.floor(Date.now()/1000));
  const {data,error}=await db.from("phrasly_oneclick_daily_usage").select("used")
    .eq("user_id",uid).eq("tool_id",TOOL).eq("feature_key",f).eq("day",day).maybeSingle();
  if(error) throw new OneclickError("service_unavailable",503);
  return Number(data?.used||0);
}
async function audit(uid:string,event:string,f?:Feature) {
  await db.from("phrasly_oneclick_activity").insert({user_id:uid,event_type:event,feature_key:f||null});
}
export async function handoff(request:Request) {
  enabled();
  const uid=await verifiedWriter(request);
  const f=feature(new URL(request.url).searchParams.get("feature")||"default");
  const toolId=new URL(request.url).searchParams.get("tool_id")||TOOL;
  if(toolId!==TOOL) throw new OneclickError("tool_not_found",404);
  await allowedFeature(uid,f);
  const token=issueAwsHandoff(uid,TOOL,f,Math.floor(Date.now()/1000),secret());
  await audit(uid,"ext_access_requested",f);
  return oneclickJson({ok:true,...token});
}
function decode(payload:string,sig:string,kind:"handoff"|"record") {
  try {return verifyAwsToken(payload,sig,kind,Math.floor(Date.now()/1000),secret());}
  catch(e) {
    const code=e instanceof Error ? e.message : "bad_token";
    throw new OneclickError(code === "token_expired" ? "token_expired" : code === "bad_signature" ? "bad_signature":"bad_token",code==="bad_token"?400:403);
  }
}
export async function fulfill(request:Request) {
  enabled();
  const params=new URL(request.url).searchParams;
  const payload=params.get("payload")||"",signature=params.get("signature")||"";
  if(!payload||!signature) throw new OneclickError("missing_token",400);
  const claims=decode(payload,signature,"handoff");
  if(claims.tool_id!==TOOL || typeof claims.uid!=="string") throw new OneclickError("bad_token",400);
  const uid=claims.uid,f=feature(claims.feature||"default");
  const limit=await allowedFeature(uid,f), used=await usage(uid,f);
  if(used>=limit) return oneclickJson({ok:false,error:"limit_reached",limit,resets_in:secondsUntilWatReset(Math.floor(Date.now()/1000))},429,true);
  const {data:settings,error:settingsError}=await db.from("phrasly_oneclick_tool_config")
    .select("enabled,feature_urls,block_paths").eq("tool_id",TOOL).maybeSingle();
  if(settingsError || !settings?.enabled) throw new OneclickError("tool_not_found",404);
  const {data:assigned,error:assignError}=await db.rpc("phrasly_oneclick_assign_account",{p_user:uid});
  if(assignError) throw new OneclickError("service_unavailable",503);
  if(!assigned) throw new OneclickError("no_accounts_available",503);
  const {data:account,error:accountError}=await db.from("phrasly_oneclick_accounts")
    .select("target_url,encrypted_cookies,enabled").eq("id",assigned).eq("tool_id",TOOL).maybeSingle();
  if(accountError || !account?.enabled) throw new OneclickError("no_accounts_available",503);
  const plain=decryptPhraslySession(account.encrypted_cookies);
  const state=JSON.parse(plain) as PhraslySessionState;
  // Domain is restricted by the existing encrypted-vault normalizer.
  const cookies=state.authenticated_cookies;
  await audit(uid,"ext_fulfilled",f);
  const url=typeof settings.feature_urls?.[f]==="string"?settings.feature_urls[f]:account.target_url;
  if(!/^https:\/\/(?:[a-z0-9-]+\.)?phrasly\.ai(?:\/|$)/i.test(url)) throw new OneclickError("tool_not_found",404);
  const blockPaths=Array.isArray(settings.block_paths)?settings.block_paths.filter((p:unknown)=>typeof p==="string" && p.startsWith("/")):[];
  return oneclickJson({ok:true,url,cookies,block_paths:blockPaths,
    used,limit,record_token:issueAwsRecordToken(uid,TOOL,Math.floor(Date.now()/1000),secret())},200,true);
}
export async function checkUsage(request:Request) {
  enabled();
  const raw=await request.text();
  if(raw.length>8_192) throw new OneclickError("bad_request",400);
  const form=new URLSearchParams(raw),token=form.get("record_token")||"";
  const f=feature(form.get("feature"));
  const index=token.lastIndexOf(".");
  if(index<1) throw new OneclickError("bad_request",400);
  const claims=decode(token.slice(0,index),token.slice(index+1),"record");
  if(claims.tool_id!==TOOL||typeof claims.uid!=="string") throw new OneclickError("bad_token",400);
  const uid=claims.uid;
  await allowedFeature(uid,f);
  const {data,error}=await db.rpc("phrasly_oneclick_count_attempt",{p_user:uid,p_feature:f});
  if(error||!Array.isArray(data)||!data[0]) throw new OneclickError("service_unavailable",503);
  const count=data[0];
  return oneclickJson({ok:true,allowed:count.allowed,used:count.used,limit:count.daily_limit,resets_in:count.resets_in},200,true);
}
function hash(value:string) {return createHash("sha256").update(value).digest("hex");}
export async function createPopupSession(request:Request) {
  enabled();
  const uid=await verifiedWriter(request);
  const token=randomBytes(32).toString("base64url");
  const {error}=await db.from("phrasly_oneclick_popup_sessions").insert({
    token_hash:hash(token),user_id:uid,expires_at:new Date(Date.now()+12*3600_000).toISOString()
  });
  if(error) throw new OneclickError("service_unavailable",503);
  return new Response(JSON.stringify({ok:true}),{status:200,headers:{
    "Content-Type":"application/json","Cache-Control":"no-store",
    "Set-Cookie":`PHPSESSID=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200`
  }});
}
export async function whoami(request:Request) {
  enabled();
  const token=request.headers.get("x-ext-session")||"";
  if(!/^[A-Za-z0-9_-]{32,128}$/.test(token)) return oneclickJson({ok:false,error:"not_signed_in"},200,true);
  const {data,error}=await db.from("phrasly_oneclick_popup_sessions")
    .select("user_id,expires_at,revoked_at").eq("token_hash",hash(token)).maybeSingle();
  if(error || !data || data.revoked_at || Date.parse(data.expires_at)<=Date.now())
    return oneclickJson({ok:false,error:"not_signed_in"},200,true);
  const uid=data.user_id as string;
  try {await activeWriter(uid);await activeTopRatedAccess(uid);} catch {return oneclickJson({ok:false,error:"not_signed_in"},200,true);}
  const {data:grants,error:grantsError}=await db.from("phrasly_oneclick_feature_grants")
    .select("feature_key,daily_limit").eq("user_id",uid).eq("tool_id",TOOL).eq("enabled",true);
  if(grantsError) throw new OneclickError("service_unavailable",503);
  const {data:user}=await db.auth.admin.getUserById(uid);
  const now=Math.floor(Date.now()/1000),features=[];
  for(const g of grants||[]) {
    const f=feature(g.feature_key),used=await usage(uid,f),maxed=used>=g.daily_limit;
    features.push({key:f,label:f==="humanizer"?"Humanizer":f==="ai_detector"?"AI Detector":"Access",
      used,limit:g.daily_limit,maxed,
      ...(!maxed?issueAwsHandoff(uid,TOOL,f,now,secret()):{})});
  }
  return oneclickJson({ok:true,email:user?.user?.email||"",full_name:user?.user?.user_metadata?.full_name||"",
    subscription_end:null,tools:[{id:TOOL,name:"Phrasly",type:"cookie_extension",active:true,
      resets_in:secondsUntilWatReset(now),features}]},200,true);
}
