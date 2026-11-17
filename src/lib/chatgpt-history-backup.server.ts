import {supabaseAdmin} from '@/integrations/supabase/client.server';
import {chatGptAccountSession} from './chatgpt-account-auth.server';
import {decryptChatGptSession} from './chatgpt-session.server';
import {captureConversation,threadForAlias,historyLink,HistoryUpstreamError,historyIssue} from './chatgpt-history.server';
import type {ChatGptProviderAccount} from './chatgpt-account-policy';
/** Idempotent: imports only explicitly owned chats; never claims provider-wide history. */
export async function backupChatGptAccount(account:ChatGptProviderAccount,encrypted:string) {
 const {buildChatGPTCookieHeader}=await import('./chatgpt-proxy.server');
 let cookie='';
 try{cookie=buildChatGPTCookieHeader(decryptChatGptSession(encrypted),'https://chatgpt.com/api/auth/session');}catch{/* An expired login cannot remove saved history. */}
 const headers=new Headers({Cookie:cookie,Accept:'application/json',Origin:'https://chatgpt.com',Referer:'https://chatgpt.com/','User-Agent':'Mozilla/5.0'});
 let session:Awaited<ReturnType<typeof chatGptAccountSession>>|null=null;
 try{if(cookie)session=await chatGptAccountSession(account,encrypted,headers);}catch{/* Saved transcripts remain valid even after an upstream login expires. */}
 if(session?.identity)headers.set('Authorization','Bearer '+session.token);
 let captured=0,alreadySaved=0,unavailable=0,failed=0;
 for(let offset=0;;offset+=100) {
  const {data,error}=await (supabaseAdmin as any).from('chatgpt_conversation_owners').select('user_id,conversation_id').eq('provider_account_key',account).order('conversation_id').range(offset,offset+99);
  if(error)throw Error('Could not load private conversation ownership.');
  for(const row of data??[]) {
   const saved=await threadForAlias(row.user_id,row.conversation_id);
   if(!session?.identity){
    const {data:issue,error}=await (supabaseAdmin as any).from('chatgpt_history_backup_issues').select('status').eq('user_id',row.user_id).eq('provider_account_key',account).eq('conversation_id',row.conversation_id).maybeSingle();
    if(error)throw Error('Could not check the history backup ledger.');
    if(saved)alreadySaved++;else if(issue?.status==='upstream_missing')unavailable++;else failed++;continue;
   }
   const link=await historyLink(row.user_id,row.conversation_id,session.identity);
   // A previous official account's saved chats do not belong to the newly connected login.
   if(saved && !link && saved.latest_provider_identity!==session.identity) {alreadySaved++;continue;}
   try{
    await captureConversation(row.user_id,account,session.identity,row.conversation_id,headers,saved?.id);
    await historyIssue(row.user_id,account,row.conversation_id,'resolved');captured++;
   } catch(error) {
    if(error instanceof HistoryUpstreamError && error.status===404) {
     if(saved)alreadySaved++;
     else {await historyIssue(row.user_id,account,row.conversation_id,'upstream_missing');unavailable++;}
    } else failed++;
   }
  }
  if((data??[]).length<100)break;
 }
 return {account,captured,alreadySaved,unavailable,failed};
}
