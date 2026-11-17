import {createHash,randomBytes} from 'node:crypto';
import {supabaseAdmin} from '@/integrations/supabase/client.server';
import {encryptChatGptSession,decryptChatGptSession} from './chatgpt-session.server';
import {historyMessages,isHistoryId,mergeSnapshots,validSnapshot,type HistorySnapshot} from './chatgpt-history-model';
import {rewriteStreamHandoffEvent,conversationIdFromStreamText} from './chatgpt-isolation.server';
import type {ChatGptProviderAccount} from './chatgpt-account-policy';
export class HistoryUpstreamError extends Error {constructor(public status:number){super('Could not back up the conversation (HTTP '+status+').');}}
export const durableHistoryEnabled = () => process.env.CHATGPT_DURABLE_HISTORY === '1';
export const historyHash = (s:string) => createHash('sha256').update(s).digest('hex');
const db = () => supabaseAdmin as any;
const fail = (error: any) => { if(error) throw Error('Saved chat history is temporarily unavailable.'); };
export async function savedThread(userId:string,id:string) {
 if(!isHistoryId(id)) return null;
 const {data,error} = await db().from('chatgpt_history_threads').select('*').eq('user_id',userId).eq('id',id).maybeSingle(); fail(error);
 if(!data) return null;
 const envelope = JSON.parse(decryptChatGptSession(data.encrypted_snapshot));
 if(envelope.kind !== 'chatgpt-history-v1' || envelope.user_id !== userId || envelope.id !== data.id) throw Error('Invalid saved chat.');
 return {...data,snapshot:envelope.snapshot as HistorySnapshot};
}
export async function threadForAlias(userId:string,upstreamId:string) {
 const direct = await savedThread(userId,upstreamId); if(direct) return direct;
 const {data,error} = await db().from('chatgpt_history_links').select('thread_id').eq('user_id',userId).eq('upstream_id',upstreamId).limit(1); fail(error);
 return data?.[0] ? savedThread(userId,data[0].thread_id) : null;
}
export async function historyLink(userId:string,upstreamId:string,identity:string) {
 const {data,error} = await db().from('chatgpt_history_links').select('*').eq('user_id',userId).eq('upstream_id',upstreamId).eq('provider_identity',identity).maybeSingle(); fail(error); return data;
}
export async function saveSnapshot(userId:string,account:ChatGptProviderAccount,identity:string,upstreamId:string,snapshot:HistorySnapshot,threadId=upstreamId) {
 if(!isHistoryId(upstreamId)||!isHistoryId(threadId)||!validSnapshot(snapshot,upstreamId)) throw Error('Invalid conversation snapshot.');
 const {data:owner,error:ownerError}=await db().from('chatgpt_conversation_owners').select('user_id').eq('conversation_id',upstreamId).eq('provider_account_key',account).maybeSingle(); fail(ownerError);
 if(owner?.user_id!==userId) throw Error('Conversation ownership mismatch.');
 for(let retry=0;retry<4;retry++) {
  const old = await savedThread(userId,threadId);
  const merged = mergeSnapshots(old?.snapshot ?? null,snapshot,threadId);
  const latest=merged.current_node===snapshot.current_node;
  const title = String(merged.title || 'New chat').slice(0,500);
  const payload = {id:threadId,user_id:userId,title,encrypted_snapshot:encryptChatGptSession(JSON.stringify({kind:'chatgpt-history-v1',id:threadId,user_id:userId,snapshot:merged})),version:(old?.version ?? 0)+1,latest_provider_identity:latest?identity:old.latest_provider_identity,latest_upstream_id:latest?upstreamId:old.latest_upstream_id,updated_at:Number(merged.update_time)>0?new Date(Number(merged.update_time)*1000).toISOString():new Date().toISOString(),...(!old&&Number(merged.create_time)>0?{created_at:new Date(Number(merged.create_time)*1000).toISOString()}:{})};
  const result = old
   ? await db().from('chatgpt_history_threads').update(payload).eq('id',threadId).eq('user_id',userId).eq('version',old.version).select('id')
   : await db().from('chatgpt_history_threads').insert(payload).select('id');
  if(result.error?.code==='23505') {if(retry===3) fail(result.error); continue;}
  fail(result.error); if(!result.data?.length) {if(retry===3) throw Error('Saved chat changed concurrently; retry.'); continue;}
  const {error} = await db().from('chatgpt_history_links').upsert({provider_identity:identity,upstream_id:upstreamId,provider_account_key:account,thread_id:threadId,user_id:userId},{onConflict:'provider_identity,upstream_id',ignoreDuplicates:true}); fail(error);
  const link=await historyLink(userId,upstreamId,identity); if(link?.thread_id!==threadId) throw Error('Saved chat ownership conflict.');
  return;
 }
 throw Error('Could not save chat history.');
}
export async function savedHistoryItems(userId:string,identity?:string) {
 const rows:any[]=[];
 // Explicit pagination avoids the database's 1,000-row response cap.
 for(let offset=0;;offset+=500) {
  const {data,error}=await db().from('chatgpt_history_threads').select('id,title,created_at,updated_at,latest_provider_identity,latest_upstream_id').eq('user_id',userId).order('updated_at',{ascending:false}).order('id').range(offset,offset+499); fail(error);
  rows.push(...(data??[])); if((data??[]).length<500) break;
 }
 return rows.map(row=>({id:identity && row.latest_provider_identity===identity?row.latest_upstream_id:row.id,title:row.title,create_time:row.created_at,update_time:row.updated_at,is_archived:false,is_starred:false}));
}
export async function createHistoryResume(userId:string,threadId:string,sessionId:string) {
 const thread=await savedThread(userId,threadId); if(!thread) throw Error('Conversation not found.');
 const token=randomBytes(32).toString('base64url');
 const {error}=await db().from('chatgpt_history_resumes').insert({token_hash:historyHash(token),user_id:userId,thread_id:threadId,proxy_session_id:sessionId,expires_at:new Date(Date.now()+15*60000).toISOString()}); fail(error); return token;
}
export async function historyResume(userId:string,sessionId:string,token:string) {
 if(!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
 const {data,error}=await db().from('chatgpt_history_resumes').select('*').eq('token_hash',historyHash(token)).eq('user_id',userId).eq('proxy_session_id',sessionId).gt('expires_at',new Date().toISOString()).maybeSingle(); fail(error); return data;
}
export async function claimHistoryResume(userId:string,sessionId:string,token:string) {
 const {data,error}=await db().from('chatgpt_history_resumes').update({started_at:new Date().toISOString()}).eq('token_hash',historyHash(token)).eq('user_id',userId).eq('proxy_session_id',sessionId).gt('expires_at',new Date().toISOString()).is('started_at',null).select('thread_id').maybeSingle();fail(error);return data;
}
export async function finishHistoryResume(token:string,upstreamId:string) {
 const {error}=await db().from('chatgpt_history_resumes').update({upstream_id:upstreamId}).eq('token_hash',historyHash(token)).is('upstream_id',null); fail(error);
}
/** Fetch authoritative mapping rather than trying to interpret changing token delta formats. */
export async function captureConversation(userId:string,account:ChatGptProviderAccount,identity:string,upstreamId:string,headers:Headers,threadId?:string,originalMessages?:any[]) {
 const clean=new Headers(headers); clean.set('Accept','application/json'); clean.delete('content-type'); clean.delete('content-length');
 const response=await fetch('https://chatgpt.com/backend-api/conversation/'+upstreamId,{headers:clean,redirect:'manual',signal:AbortSignal.timeout(20000)});
 if(!response.ok) throw new HistoryUpstreamError(response.status);
 const snapshot=await response.json();
 if(originalMessages && snapshot?.mapping) {
  const originals=new Map(originalMessages.map((m:any)=>[m.id,m]));
  for(const node of Object.values(snapshot.mapping) as any[]) if(node.message && originals.has(node.message.id)) {node.message.content=structuredClone(originals.get(node.message.id).content);node.message.metadata={...node.message.metadata,trst_original_content:true};}
 }
 await saveSnapshot(userId,account,identity,upstreamId,snapshot,threadId);
}
/** Durable capture runs even if the browser disconnects after a reply starts. */
export function captureHistoryStream(body:ReadableStream<Uint8Array>,onId:(id:string)=>Promise<void>,onEnd:(id:string)=>Promise<void>) {
 const reader=body.getReader(),decoder=new TextDecoder(),encoder=new TextEncoder(); let pending='',id:string|null=null,done=false;
 const process=async(event:string)=>{const found=conversationIdFromStreamText(event); if(found&&!id){id=found;await onId(found);} return rewriteStreamHandoffEvent(event);};
 const finish=async()=>{if(done)return;done=true;if(id)await onEnd(id);};
 return new ReadableStream<Uint8Array>({
  async pull(controller) {
   try {
    while(true) {
     const next=await reader.read();
     if(next.done){pending+=decoder.decode();if(pending)controller.enqueue(encoder.encode(await process(pending)));await finish();controller.close();return;}
     pending+=decoder.decode(next.value,{stream:true});
     let cut:number,emitted=false;
     while((cut=pending.search(/\r?\n\r?\n/))>=0){const sep=pending.slice(cut).startsWith('\r\n')?4:2;const event=pending.slice(0,cut+sep);pending=pending.slice(cut+sep);controller.enqueue(encoder.encode(await process(event)));emitted=true;}
     if(emitted)return;
    }
   }catch(error){try{await finish();}catch{console.error('[chatgpt-history] interrupted reply backup failed');}controller.error(error);}
  },
  async cancel(reason){await reader.cancel(reason);try{await finish();}catch{console.error('[chatgpt-history] cancelled reply backup failed');}}
 });
}
export function historySnippet(thread:any) {
 return historyMessages(thread.snapshot).map(m=>({role:m.author.role,text:(m.content?.parts??[]).filter((p:any)=>typeof p==='string').join('\n')}));
}

export async function historyIssue(userId:string,account:ChatGptProviderAccount,id:string,status:'upstream_missing'|'resolved') {
 const {error}=await db().from('chatgpt_history_backup_issues').upsert({provider_account_key:account,conversation_id:id,user_id:userId,status,checked_at:new Date().toISOString()},{onConflict:'provider_account_key,conversation_id'});fail(error);
}
export async function unresolvedHistoryCount(userId:string) {
 const {count,error}=await db().from('chatgpt_history_backup_issues').select('*',{count:'exact',head:true}).eq('user_id',userId).eq('status','upstream_missing');fail(error);return count??0;
}
