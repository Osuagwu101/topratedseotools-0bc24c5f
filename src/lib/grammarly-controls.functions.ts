import {createServerFn} from "@tanstack/react-start";
import {z} from "zod";
import {requireSupabaseAuth} from "@/integrations/supabase/auth-middleware";
import {logAdminActivity} from "./admin-audit.server";
const input=z.object({userId:z.string().uuid()});
async function admin(context:any){
 const {data,error}=await context.supabase.rpc("has_role",{_user_id:context.userId,_role:"admin"});
 if(error||!data)throw Error("Forbidden");return (await import("@/integrations/supabase/client.server")).supabaseAdmin as any;
}
export const adminGetGrammarlyControls=createServerFn({method:"GET"}).middleware([requireSupabaseAuth])
.inputValidator(value=>input.parse(value)).handler(async({data,context})=>{
 await admin(context);const {assignedGrammarlyAccount}=await import("./grammarly-accounts.server");
 return {provider_account_key:await assignedGrammarlyAccount(data.userId)};
});
export const adminUpdateGrammarlyControls=createServerFn({method:"POST"}).middleware([requireSupabaseAuth])
.inputValidator(value=>input.extend({provider_account_key:z.enum(["account_1","account_2"])}).parse(value)).handler(async({data,context})=>{
 const db=await admin(context);const {loadEncryptedSession}=await import("./grammarly-proxy.server");
 await loadEncryptedSession(data.provider_account_key);
 const {error}=await db.from("grammarly_user_controls").upsert({user_id:data.userId,provider_account_key:data.provider_account_key,updated_at:new Date().toISOString()},{onConflict:"user_id"});
 if(error)throw Error("Could not save Grammarly account assignment.");
 await logAdminActivity(context,{action:"grammarly.customer_account_update",area:"customers",target_type:"user",target_id:data.userId,details:"Grammarly provider account="+data.provider_account_key});
 return {ok:true};
});
