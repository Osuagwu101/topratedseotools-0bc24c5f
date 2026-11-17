import {supabaseAdmin} from '@/integrations/supabase/client.server';
import {chatGptAccountSession} from './chatgpt-account-auth.server';
import {decryptChatGptSession} from './chatgpt-session.server';
import {captureConversation,threadForAlias,historyLink} from './chatgpt-history.server';
import type {ChatGptProviderAccount} from './chatgpt-account-policy';
/** Idempotent: imports only explicitly owned chats; never claims provider-wide history. */
export async function backupChatGptAccount(account:ChatGptProviderAccount,encrypted:string) {
 const {buildChatGPTCookieHeader}=await import('./chatgpt-proxy.server');
 const cookie=buildChatGPTCookieHeader(decryptChatGptSession(encrypted),'https://chatgpt.com/api/auth/session');
 const headers=new Headers({Cookie:cookie,Accept:'application/json',Origin:'https://chatgpt.com',Referer:'https://chatgpt.com/','User-Agent':'Mozilla/5.0'});
 const session=await chatGptAccountSession(account,encrypted,headers);
 if(!session.identity) throw Error('Could not identify the official ChatGPT account for backup.');
 headers.set('Authorization','Bearer '+session.token);
 let captured=0,alreadySaved=0,failed=0;
 for(let offset=0;;offset+=100) {
  const {data,error}=await (supabaseAdmin as any).from('chatgpt_conversation_owners').select('user_id,conversation_id').eq('provider_account_key',account).order('conversation_id').range(offset,offset+99);
  if(error)throw Error('Could not load private conversation ownership.');
  for(const row of data??[]) {
   const saved=await threadForAlias(row.user_id,row.conversation_id);
   const link=await historyLink(row.user_id,row.conversation_id,session.identity);
   // A previous official account's saved chats do not belong to the newly connected login.
   if(saved && !link && saved.latest_provider_identity!==session.identity) {alreadySaved++;continue;}
   try{await captureConversation(row.user_id,account,session.identity,row.conversation_id,headers,saved?.id);captured++;}
   catch {failed++;}
  }
  if((data??[]).length<100)break;
 }
 return {account,captured,alreadySaved,failed};
}
