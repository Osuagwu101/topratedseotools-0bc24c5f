/*
 * Claude provider accounts — admin only.
 *
 * Each account card (Account 1, Account 2) works like StealthWriter's: a
 * Super Admin pastes that account's authorised session JSON, the server
 * normalises and encrypts it, loads it into that account's private server
 * browser, verifies it against Claude and marks the account connected.
 * Decrypted values are never returned to the admin browser or logged.
 *
 * Account 1 keeps the legacy single vault (tool_authorized_sessions) as its
 * source of truth so existing writers, rotation and rollback are unchanged.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import {createServerFn} from "@tanstack/react-start";
import {z} from "zod";
import {requireSupabaseAuth} from "@/integrations/supabase/auth-middleware";
import {logAdminActivity} from "./admin-audit.server";
import type {ClaudeProviderAccountKey} from "./claude-account-policy";

const TOOL_SLUG = "claude";
const SESSION_FORMAT = "claude_session_state_json_v2";
const accountInput = z.object({account_key: z.enum(["account_1", "account_2"])});
const label = (key: ClaudeProviderAccountKey) => (key === "account_1" ? "Account 1" : "Account 2");

async function admin(context:any,manage=false){
 const {data,error}=await context.supabase.rpc(manage?"is_super_admin":"has_role",manage?{_user_id:context.userId}:{_user_id:context.userId,_role:"admin"});
 if(error||!data)throw Error(manage?"Only a Super Admin can manage Claude account sessions.":"Forbidden");
 return (await import("@/integrations/supabase/client.server")).supabaseAdmin as any;
}

async function revokeLaunches(db:any,account:ClaudeProviderAccountKey){
 const {error}=await db.from("claude_proxy_sessions").update({status:"revoked"}).eq("provider_account_key",account).in("status",["issued","active"]);
 if(error)throw Error("Could not revoke existing Claude launches.");
}

/** Live organisations check through the account's own transport. */
async function verifyAccount(db:any,account:ClaudeProviderAccountKey,cookieHeader?:string){
 const {fetchClaudeProvider}=await import("./claude-browser-fetch.server");
 let connected=false;
 try{
  const headers=new Headers({Accept:"application/json"});
  if(cookieHeader)headers.set("Cookie",cookieHeader);
  const response=await fetchClaudeProvider("https://claude.ai/api/organizations",{headers,redirect:"manual",signal:AbortSignal.timeout(20000)},account);
  const payload=response.ok&&(response.headers.get("content-type")??"").includes("json")?await response.json():null;
  connected=Array.isArray(payload)&&payload.length>0&&payload.every((o:any)=>typeof o?.uuid==="string");
 }catch{}
 const {error}=await db.from("claude_provider_accounts").update({status:connected?"connected":"needs_login",verified_at:connected?new Date().toISOString():null}).eq("account_key",account);
 if(error)throw Error("Could not save Claude connection status.");
 return connected;
}

/** Cookie header from the stored vault, used only when no server browser serves the account. */
async function storedCookieHeader(db:any,account:ClaudeProviderAccountKey){
 const {claudeAccountUsesBrowser}=await import("./claude-browser-fetch.server");
 if(claudeAccountUsesBrowser(account))return undefined;
 const {decryptClaudeSession}=await import("./claude-session.server");
 const {claudeCookieHeader}=await import("./claude-proxy-policy");
 const {data}=account==="account_1"
  ?await db.from("tool_authorized_sessions").select("encrypted_payload,status").eq("tool_slug",TOOL_SLUG).maybeSingle()
  :await db.from("claude_provider_accounts").select("encrypted_payload,status:session_status").eq("account_key",account).maybeSingle();
 if(data?.status!=="stored"||!data.encrypted_payload)return undefined;
 try{return claudeCookieHeader(JSON.parse(decryptClaudeSession(data.encrypted_payload)),"/api/organizations");}catch{return undefined;}
}

export type ClaudeAccountView = {
 account_key: ClaudeProviderAccountKey;
 display_name: string;
 status: string;
 verified_at: string | null;
 session_configured: boolean;
 session_status: string;
 session_updated_at: string | null;
 rotated_at: string | null;
};

export const adminListClaudeAccounts=createServerFn({method:"GET"}).middleware([requireSupabaseAuth]).handler(async({context})=>{
 const db=await admin(context);
 const [{data,error},{data:legacy,error:legacyError},{data:isSuper}]=await Promise.all([
  db.from("claude_provider_accounts").select("account_key,status,verified_at,session_status,session_updated_at,rotated_at").order("account_key"),
  db.from("tool_authorized_sessions").select("status,updated_at,rotated_at").eq("tool_slug",TOOL_SLUG).maybeSingle(),
  context.supabase.rpc("is_super_admin",{_user_id:context.userId}),
 ]);
 if(error||legacyError)throw Error("Could not load Claude accounts.");
 const accounts:ClaudeAccountView[]=(data??[]).map((a:any)=>{
  const one=a.account_key==="account_1";
  const sessionStatus=one?(legacy?.status??"not_configured"):(a.session_status??"not_configured");
  return {
   account_key:a.account_key,
   display_name:label(a.account_key),
   status:a.status,
   verified_at:a.verified_at??null,
   session_configured:sessionStatus==="stored",
   session_status:sessionStatus,
   session_updated_at:(one?legacy?.updated_at:a.session_updated_at)??null,
   rotated_at:(one?legacy?.rotated_at:a.rotated_at)??null,
  };
 });
 return {accounts,can_manage:!!isSuper};
});

export const adminSaveClaudeAccountSession=createServerFn({method:"POST"}).middleware([requireSupabaseAuth])
 .inputValidator(input=>accountInput.extend({session_data:z.string().min(2).max(500000)}).parse(input))
 .handler(async({data,context})=>{
 const db=await admin(context,true);
 const account=data.account_key;
 const {normaliseClaudeSession,encryptClaudeSession}=await import("./claude-session.server");
 const normalised=normaliseClaudeSession(data.session_data);
 const state=JSON.parse(normalised);
 const encrypted=encryptClaudeSession(normalised);
 const now=new Date().toISOString();

 if(account==="account_1"){
  const {error}=await db.from("tool_authorized_sessions").upsert({tool_slug:TOOL_SLUG,encrypted_payload:encrypted,session_format:SESSION_FORMAT,status:"stored",updated_by:context.userId,updated_at:now},{onConflict:"tool_slug"});
  if(error)throw Error("Could not save the Account 1 session.");
 }else{
  const {error}=await db.from("claude_provider_accounts").update({encrypted_payload:encrypted,session_format:SESSION_FORMAT,session_status:"stored",session_updated_at:now,session_updated_by:context.userId}).eq("account_key",account);
  if(error)throw Error("Could not save the Account 2 session.");
 }
 await revokeLaunches(db,account);

 // Activate: load the pasted login into this account's private server browser.
 const {claudeAccountUsesBrowser,pushClaudeBrowserSession}=await import("./claude-browser-fetch.server");
 let activationError:string|null=null;
 if(claudeAccountUsesBrowser(account)){
  try{await pushClaudeBrowserSession(account,state.cookies);}
  catch(e){activationError=e instanceof Error?e.message:"The server browser could not load the session.";}
 }
 let connected=false;
 if(!activationError){
  const {claudeCookieHeader}=await import("./claude-proxy-policy");
  connected=await verifyAccount(db,account,claudeAccountUsesBrowser(account)?undefined:claudeCookieHeader(state,"/api/organizations"));
 }else{
  await db.from("claude_provider_accounts").update({status:"needs_login",verified_at:null}).eq("account_key",account);
 }

 await logAdminActivity(context,{action:"claude.account_session_replace",area:"tools",target_type:"claude_provider_account",target_id:account,
  details:`${label(account)} session replaced; ${connected?"activated and verified":"activation pending"}. Cookie/storage values were not logged.`});

 return {
  ok:connected,
  message:connected
   ?`${label(account)} session saved and activated. Writers assigned to ${label(account)} now use it.`
   :activationError
    ?`${label(account)} session saved, but activation failed: ${activationError}`
    :`${label(account)} session saved, but Claude did not accept it. Paste a fresh session JSON for ${label(account)}.`,
 };
});

export const adminVerifyClaudeAccount=createServerFn({method:"POST"}).middleware([requireSupabaseAuth])
 .inputValidator(input=>accountInput.parse(input)).handler(async({data,context})=>{
 const db=await admin(context,true);
 const connected=await verifyAccount(db,data.account_key,await storedCookieHeader(db,data.account_key));
 await logAdminActivity(context,{action:"claude.account_verify",area:"tools",target_type:"claude_provider_account",target_id:data.account_key,details:connected?"Connection verified":"Account requires a fresh session"});
 return {ok:connected,message:connected?`${label(data.account_key)} connected and verified.`:`${label(data.account_key)} is not signed in. Paste a fresh session JSON on its card.`};
});

export const adminRevokeClaudeAccountSession=createServerFn({method:"POST"}).middleware([requireSupabaseAuth])
 .inputValidator(input=>accountInput.parse(input)).handler(async({data,context})=>{
 const db=await admin(context,true);
 const account=data.account_key;
 const now=new Date().toISOString();
 const {error}=account==="account_1"
  ?await db.from("tool_authorized_sessions").update({status:"revoked",updated_by:context.userId,updated_at:now}).eq("tool_slug",TOOL_SLUG)
  :await db.from("claude_provider_accounts").update({session_status:"revoked",encrypted_payload:null,session_updated_at:now,session_updated_by:context.userId}).eq("account_key",account);
 if(error)throw Error("Could not revoke the Claude session.");
 const {error:statusError}=await db.from("claude_provider_accounts").update({status:"needs_login",verified_at:null}).eq("account_key",account);
 if(statusError)throw Error("Could not update Claude account status.");
 await revokeLaunches(db,account);
 await logAdminActivity(context,{action:"claude.account_session_revoke",area:"tools",target_type:"claude_provider_account",target_id:account,details:`${label(account)} session revoked; secret values were not logged.`});
 return {ok:true};
});

export const adminDisableClaudeAccount=createServerFn({method:"POST"}).middleware([requireSupabaseAuth])
 .inputValidator(input=>accountInput.parse(input)).handler(async({data,context})=>{
 const db=await admin(context,true);
 const {error}=await db.from("claude_provider_accounts").update({status:"disabled"}).eq("account_key",data.account_key);
 if(error)throw Error("Could not disable Claude account.");
 const {error:revoke}=await db.from("claude_proxy_sessions").update({status:"revoked"}).eq("provider_account_key",data.account_key).in("status",["issued","active"]);
 if(revoke)throw Error("Account disabled; retry to revoke its launches.");
 await logAdminActivity(context,{action:"claude.account_disable",area:"tools",target_type:"claude_provider_account",target_id:data.account_key,details:"Account disabled and launches revoked"});
 return {ok:true};
});
