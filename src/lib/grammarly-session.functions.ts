/*
 * Grammarly authorised-session vault — admin only.
 *
 * Phase 2 scope:
 * - Super Admin can paste/replace/revoke authorised first-party session state
 * - raw values are normalised and AES-256-GCM encrypted before storage
 * - the Admin UI receives metadata only; decrypted state is never returned
 * - no writer launch path is exposed in this phase
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { logAdminActivity } from "@/lib/admin-audit.server";
import {
  encryptGrammarlySession,
  normaliseGrammarlySession,
} from "@/lib/grammarly-session.server";

const TOOL_SLUG = "grammarly";
export const GRAMMARLY_SESSION_FORMAT = "grammarly_session_state_json_v2";

async function assertAdmin(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase.rpc("has_role", {
    _user_id: ctx.userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as any;
}

async function assertSuperAdmin(ctx: { supabase: any; userId: string }) {
  const admin = await assertAdmin(ctx);
  const { data, error } = await ctx.supabase.rpc("is_super_admin", {
    _user_id: ctx.userId,
  });
  if (error) throw new Error(error.message);
  if (!data) {
    throw new Error(
      "Only a Super Admin can replace or revoke the Grammarly authorised session.",
    );
  }
  return admin;
}

async function setGrammarlyOneClickEnabled(admin: any, enabled: boolean) {
  const { error } = await admin
    .from("tool_settings")
    .update({ one_click_auth_enabled: enabled })
    .eq("tool_slug", TOOL_SLUG);
  if (error) throw new Error(error.message);
}

const accountInput=z.object({account_key:z.enum(["account_1","account_2"]).default("account_1")});
async function accountMetadata(admin:any,key:string){
 const {data,error}=await admin.from("grammarly_provider_accounts").select("account_key,status,updated_at,verified_at").eq("account_key",key).maybeSingle();
 if(error)throw Error("Could not load Grammarly account.");
 return {account_key:key,status:data?.status??"not_configured",configured:data?.status==="stored",updated_at:data?.updated_at??null,verified_at:data?.verified_at??null};
}
export const adminGetGrammarlySessionStatus=createServerFn({method:"GET"}).middleware([requireSupabaseAuth]).handler(async({context})=>{
 const admin=await assertAdmin(context);const {data}=await context.supabase.rpc("is_super_admin",{_user_id:context.userId});
 return {...await accountMetadata(admin,"account_1"),session_format:GRAMMARLY_SESSION_FORMAT,can_manage:!!data};
});
export const adminListGrammarlyAccounts=createServerFn({method:"GET"}).middleware([requireSupabaseAuth]).handler(async({context})=>{
 const admin=await assertAdmin(context);const {data,error}=await context.supabase.rpc("is_super_admin",{_user_id:context.userId});
 if(error)throw Error("Could not check account permissions.");
 return {can_manage:!!data,accounts:await Promise.all(["account_1","account_2"].map(key=>accountMetadata(admin,key)))};
});
export const adminSaveGrammarlySession=createServerFn({method:"POST"}).middleware([requireSupabaseAuth])
 .inputValidator(input=>accountInput.extend({session_data:z.string().min(2).max(500000)}).parse(input))
 .handler(async({data,context})=>{
 const admin=await assertSuperAdmin(context),now=new Date().toISOString();
 const encrypted=encryptGrammarlySession(normaliseGrammarlySession(data.session_data));
 const payload={encrypted_payload:encrypted,status:"stored",updated_by:context.userId,updated_at:now};
 const result=data.account_key==="account_1"
 ?await admin.from("tool_authorized_sessions").upsert({...payload,tool_slug:TOOL_SLUG,session_format:GRAMMARLY_SESSION_FORMAT},{onConflict:"tool_slug"})
 :await admin.from("grammarly_provider_accounts").update({...payload,verified_at:null}).eq("account_key",data.account_key);
 if(result.error)throw Error("Could not save Grammarly account.");
 const {error}=await admin.from("grammarly_proxy_sessions").update({status:"revoked"}).eq("provider_account_key",data.account_key).in("status",["issued","active"]);
 if(error)throw Error("Session saved; retry to revoke old launches.");
 await logAdminActivity(context,{action:"grammarly.provider_session_replace",area:"tools",target_type:"grammarly_provider_account",target_id:data.account_key,details:"Encrypted session replaced; account launches revoked; secret values not logged."});
 return {ok:true};
});
export const adminRevokeGrammarlySession=createServerFn({method:"POST"}).middleware([requireSupabaseAuth])
 .inputValidator(input=>accountInput.parse(input??{})).handler(async({data,context})=>{
 const admin=await assertSuperAdmin(context);
 const result=data.account_key==="account_1"
 ?await admin.from("tool_authorized_sessions").update({status:"revoked",updated_at:new Date().toISOString()}).eq("tool_slug",TOOL_SLUG)
 :await admin.from("grammarly_provider_accounts").update({status:"revoked",verified_at:null,updated_at:new Date().toISOString()}).eq("account_key",data.account_key);
 if(result.error)throw Error("Could not revoke Grammarly account.");
 const {error}=await admin.from("grammarly_proxy_sessions").update({status:"revoked"}).eq("provider_account_key",data.account_key).in("status",["issued","active"]);
 if(error)throw Error("Account revoked; retry to revoke its launches.");
 await logAdminActivity(context,{action:"grammarly.provider_session_revoke",area:"tools",target_type:"grammarly_provider_account",target_id:data.account_key,details:"Account session revoked."});
 return {ok:true};
});
export const adminVerifyGrammarlyAccount=createServerFn({method:"POST"}).middleware([requireSupabaseAuth])
 .inputValidator(input=>accountInput.parse(input)).handler(async({data,context})=>{
 const admin=await assertSuperAdmin(context);
 const {data:row,error}=await admin.from("grammarly_provider_accounts").select("encrypted_payload,status").eq("account_key",data.account_key).maybeSingle();
 if(error||row?.status!=="stored"||!row.encrypted_payload)throw Error("Save this account's session first.");
 const {verifyGrammarlyAccountSession}=await import("./grammarly-proxy.server");
 let verifiedSnapshot:string;
 try{const check=await verifyGrammarlyAccountSession(row.encrypted_payload,data.account_key);if(!check.ok)return {ok:false,message:"This Grammarly account could not be verified. Refresh its session and retry."};verifiedSnapshot=check.encrypted;}
 catch{return {ok:false,message:"Grammarly could not be reached. Please retry."};}
 const saved=await admin.from("grammarly_provider_accounts").update({verified_at:new Date().toISOString()}).eq("account_key",data.account_key).eq("encrypted_payload",verifiedSnapshot).select("account_key").maybeSingle();
 if(saved.error||!saved.data)throw Error("Session changed during verification. Verify again.");
 await logAdminActivity(context,{action:"grammarly.provider_session_verify",area:"tools",target_type:"grammarly_provider_account",target_id:data.account_key,details:"Upstream authentication verified."});
 return {ok:true,message:"Grammarly account verified."};
});
