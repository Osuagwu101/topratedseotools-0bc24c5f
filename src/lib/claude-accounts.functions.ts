import {createServerFn} from "@tanstack/react-start";
import {z} from "zod";
import {requireSupabaseAuth} from "@/integrations/supabase/auth-middleware";
import {logAdminActivity} from "./admin-audit.server";
async function admin(context:any,manage=false){
 const {data,error}=await context.supabase.rpc(manage?"is_super_admin":"has_role",manage?{_user_id:context.userId}:{_user_id:context.userId,_role:"admin"});
 if(error||!data)throw Error("Forbidden");
 return (await import("@/integrations/supabase/client.server")).supabaseAdmin as any;
}
export const adminListClaudeAccounts=createServerFn({method:"GET"}).middleware([requireSupabaseAuth]).handler(async({context})=>{
 const db=await admin(context);
 const {data,error}=await db.from("claude_provider_accounts").select("account_key,status,verified_at").order("account_key");
 if(error)throw Error("Could not load Claude accounts.");
 return data as {account_key:"account_1"|"account_2";status:string;verified_at:string|null}[];
});
export const adminVerifyClaudeAccount=createServerFn({method:"POST"}).middleware([requireSupabaseAuth])
 .inputValidator(input=>z.object({account_key:z.enum(["account_1","account_2"])}).parse(input)).handler(async({data,context})=>{
 const db=await admin(context,true);
 const {fetchClaudeProvider}=await import("./claude-browser-fetch.server");
 let connected=false;
 try{
  const response=await fetchClaudeProvider("https://claude.ai/api/organizations",{headers:{Accept:"application/json"},signal:AbortSignal.timeout(20000)},data.account_key);
  const payload=response.ok&&(response.headers.get("content-type")??"").includes("json")?await response.json():null;
  connected=Array.isArray(payload)&&payload.length>0&&payload.every(o=>typeof o?.uuid==="string");
 }catch{}
 const {error}=await db.from("claude_provider_accounts").update({status:connected?"connected":"needs_login",verified_at:connected?new Date().toISOString():null}).eq("account_key",data.account_key);
 if(error)throw Error("Could not save Claude connection status.");
 await logAdminActivity(context,{action:"claude.account_verify",area:"tools",target_type:"claude_provider_account",target_id:data.account_key,details:connected?"Connection verified":"Account requires sign-in"});
 return {ok:connected,message:connected?"Account connected and verified.":"Sign in to this account's dedicated server browser, then verify again."};
});
export const adminDisableClaudeAccount=createServerFn({method:"POST"}).middleware([requireSupabaseAuth])
 .inputValidator(input=>z.object({account_key:z.enum(["account_1","account_2"])}).parse(input)).handler(async({data,context})=>{
 const db=await admin(context,true);
 const {error}=await db.from("claude_provider_accounts").update({status:"disabled"}).eq("account_key",data.account_key);
 if(error)throw Error("Could not disable Claude account.");
 const {error:revoke}=await db.from("claude_proxy_sessions").update({status:"revoked"}).eq("provider_account_key",data.account_key).in("status",["issued","active"]);
 if(revoke)throw Error("Account disabled; retry to revoke its launches.");
 await logAdminActivity(context,{action:"claude.account_disable",area:"tools",target_type:"claude_provider_account",target_id:data.account_key,details:"Account disabled and launches revoked"});
 return {ok:true};
});
