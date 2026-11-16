import {supabaseAdmin} from "@/integrations/supabase/client.server";
import {isClaudeProviderAccount, type ClaudeProviderAccountKey} from "./claude-account-policy";
export async function assignedClaudeAccount(userId:string):Promise<ClaudeProviderAccountKey>{
 const {data,error}=await (supabaseAdmin as any).from("claude_user_controls").select("provider_account_key").eq("user_id",userId).maybeSingle();
 if(error)throw Error("Could not load Claude account assignment.");
 const key=data?.provider_account_key??"account_1";
 if(!isClaudeProviderAccount(key))throw Error("Invalid Claude account assignment.");
 return key;
}
export async function requireClaudeAccount(key:ClaudeProviderAccountKey){
 const {data,error}=await (supabaseAdmin as any).from("claude_provider_accounts").select("status").eq("account_key",key).maybeSingle();
 if(error||data?.status!=="connected")throw Error("Your assigned Claude account needs an Admin connection refresh.");
}
