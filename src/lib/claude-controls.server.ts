import {supabaseAdmin} from "@/integrations/supabase/client.server";
const db=supabaseAdmin as any;
export const CLAUDE_DEFAULT_DAILY_MESSAGES=25;
export function claudeUsageDay(now=new Date()){return new Date(now.getTime()+3600000).toISOString().slice(0,10);}
export function claudeResetAt(now=new Date()){
 const next=new Date(claudeUsageDay(now)+"T23:00:00.000Z");
 if(next.getTime()<=now.getTime())next.setUTCDate(next.getUTCDate()+1);
 return next.toISOString();
}
export async function getClaudeUsage(userId:string){
 const [controls,usage]=await Promise.all([
  db.from("claude_user_controls").select("daily_message_limit").eq("user_id",userId).maybeSingle(),
  db.from("claude_daily_usage").select("messages_used").eq("user_id",userId).eq("usage_date",claudeUsageDay()).maybeSingle()
 ]);
 if(controls.error||usage.error)throw Error("Could not load Claude usage.");
 const limit=controls.data?.daily_message_limit??CLAUDE_DEFAULT_DAILY_MESSAGES,used=usage.data?.messages_used??0;
 return {limit,used,remaining:Math.max(0,limit-used),resets_at:claudeResetAt()};
}
export async function reserveClaudeMessage(userId:string,messageKey:string){
 const {data,error}=await db.rpc("reserve_claude_message",{p_user_id:userId,p_message_key:messageKey});
 if(error||!data)throw Error("Could not check your Claude daily limit.");
 return data as {allowed:boolean;code?:string;limit:number;used:number;remaining:number};
}
export async function releaseClaudeMessage(userId:string,messageKey:string){
 const {error}=await db.rpc("release_claude_message",{p_user_id:userId,p_message_key:messageKey});
 if(error)throw Error("Could not release the Claude message reservation.");
}
