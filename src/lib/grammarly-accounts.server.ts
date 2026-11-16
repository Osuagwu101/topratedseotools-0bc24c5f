import {supabaseAdmin} from "@/integrations/supabase/client.server";
import {isGrammarlyProviderAccount,type GrammarlyProviderAccount} from "./grammarly-account-policy";
export async function assignedGrammarlyAccount(userId:string):Promise<GrammarlyProviderAccount>{
 const {data,error}=await (supabaseAdmin as any).from("grammarly_user_controls").select("provider_account_key").eq("user_id",userId).maybeSingle();
 if(error)throw Error("Could not load Grammarly account assignment.");
 const account=data?.provider_account_key??"account_1";
 if(!isGrammarlyProviderAccount(account))throw Error("Invalid Grammarly account assignment.");return account;
}
