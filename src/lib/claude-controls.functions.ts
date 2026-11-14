import {createServerFn} from "@tanstack/react-start";
import {z} from "zod";
import {requireSupabaseAuth} from "@/integrations/supabase/auth-middleware";
import {logAdminActivity} from "@/lib/admin-audit.server";
const userInput=z.object({userId:z.string().uuid()});
async function admin(context:any){
 const {data,error}=await context.supabase.rpc("has_role",{_user_id:context.userId,_role:"admin"});
 if(error||!data)throw Error("Forbidden");
 return (await import("@/integrations/supabase/client.server")).supabaseAdmin as any;
}
export const adminGetClaudeControls=createServerFn({method:"GET"}).middleware([requireSupabaseAuth])
 .inputValidator(input=>userInput.parse(input)).handler(async({data,context})=>{
  await admin(context);return (await import("./claude-controls.server")).getClaudeUsage(data.userId);
 });
export const adminUpdateClaudeControls=createServerFn({method:"POST"}).middleware([requireSupabaseAuth])
 .inputValidator(input=>userInput.extend({daily_message_limit:z.number().int().min(0).max(10000)}).parse(input))
 .handler(async({data,context})=>{
  const db=await admin(context);
  const {error}=await db.from("claude_user_controls").upsert({user_id:data.userId,daily_message_limit:data.daily_message_limit,updated_at:new Date().toISOString()},{onConflict:"user_id"});
  if(error)throw Error("Could not save Claude daily limit.");
  await logAdminActivity(context,{action:"claude.customer_limit_update",area:"customers",target_type:"user",target_id:data.userId,details:"Claude daily messages="+data.daily_message_limit});
  return {ok:true};
 });
export const getMyClaudeUsage=createServerFn({method:"GET"}).middleware([requireSupabaseAuth])
 .handler(async({context})=>(await import("./claude-controls.server")).getClaudeUsage(context.userId));
