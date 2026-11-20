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

/* Restore attempts are rate-limited per account so a rejected login cannot loop. */
const RESTORE_INTERVAL_MS=60_000;
const lastRestore=new Map<ClaudeProviderAccountKey,number>();
const inFlight=new Map<ClaudeProviderAccountKey,Promise<boolean>>();

async function storedSession(account:ClaudeProviderAccountKey){
 const db=supabaseAdmin as any;
 const {data}=account==="account_1"
  ?await db.from("tool_authorized_sessions").select("encrypted_payload,status").eq("tool_slug","claude").maybeSingle()
  :await db.from("claude_provider_accounts").select("encrypted_payload,status:session_status").eq("account_key",account).maybeSingle();
 if(data?.status!=="stored"||!data.encrypted_payload)return null;
 const {decryptClaudeSession}=await import("./claude-session.server");
 return JSON.parse(decryptClaudeSession(data.encrypted_payload));
}

/**
 * Reload the Admin-saved session into an account's private server browser
 * after it was found on Claude's login page (for example after Chrome was
 * restarted), then record the real connection status. Returns true only when
 * Claude accepts the restored login. Cookie values are never logged.
 */
export async function restoreClaudeBrowserSession(account:ClaudeProviderAccountKey):Promise<boolean>{
 if(!isClaudeProviderAccount(account))return false;
 const running=inFlight.get(account);if(running)return running;
 const now=Date.now();
 if(now-(lastRestore.get(account)??0)<RESTORE_INTERVAL_MS)return false;
 lastRestore.set(account,now);
 const job=(async()=>{
  const {pushClaudeBrowserSession,fetchClaudeProvider}=await import("./claude-browser-fetch.server");
  let connected=false;
  try{
   const state=await storedSession(account);
   if(state?.cookies?.length){
    await pushClaudeBrowserSession(account,state.cookies);
    const res=await fetchClaudeProvider("https://claude.ai/api/organizations",{headers:{Accept:"application/json"},signal:AbortSignal.timeout(20_000)},account,{autoRestore:false});
    const orgs=res.ok&&(res.headers.get("content-type")??"").includes("json")?await res.json():null;
    connected=Array.isArray(orgs)&&orgs.length>0&&orgs.every((o:any)=>typeof o?.uuid==="string");
   }
  }catch{connected=false;}
  await (supabaseAdmin as any).from("claude_provider_accounts")
   .update({status:connected?"connected":"needs_login",verified_at:connected?new Date().toISOString():null})
   .eq("account_key",account).neq("status","disabled");
  console.warn(`[claude] ${account} browser was logged out; restore from saved session ${connected?"succeeded":"failed"}.`);
  return connected;
 })();
 inFlight.set(account,job);
 try{return await job;}finally{inFlight.delete(account);}
}
