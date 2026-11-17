/** Pure history operations. No provider credentials or customer data in this module. */
export type HistorySnapshot = { id: string; title?: string; mapping: Record<string, any>; current_node: string; [key: string]: any };
export const isHistoryId = (id: unknown): id is string => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
export function validSnapshot(data: any, upstreamId: string): data is HistorySnapshot {
 return data && (data.conversation_id ?? data.id) === upstreamId && data.mapping && typeof data.mapping === 'object' && !Array.isArray(data.mapping) && typeof data.current_node === 'string' && !!data.mapping[data.current_node];
}
export function historyMessages(snapshot: HistorySnapshot) {
 const out: any[] = [], seen = new Set<string>();
 let id: string | null = snapshot.current_node;
 while(id && !seen.has(id)) {
  seen.add(id); const node: any = snapshot.mapping[id]; if(!node) break;
  if(node.message && ['user','assistant'].includes(node.message.author?.role)) out.unshift(node.message);
  id = node.parent;
 }
 return out;
}
export function messageText(message: any): string {
 return (message?.content?.parts ?? []).filter((part: unknown) => typeof part === 'string').join('\n');
}
/** Keep all branches; a continued provider thread's root joins the archived branch. */
export function mergeSnapshots(old: HistorySnapshot | null, incoming: HistorySnapshot, canonicalId: string): HistorySnapshot {
 const next = structuredClone(incoming);
 const originals=new Map(Object.values(old?.mapping??{}).filter((n:any)=>n.message?.metadata?.trst_original_content).map((n:any)=>[n.message.id,n.message]));
 for(const node of Object.values(next.mapping) as any[]) {
  const original=originals.get(node.message?.id);
  if(original && !node.message.metadata?.trst_original_content){node.message.content=structuredClone(original.content);node.message.metadata={...node.message.metadata,trst_original_content:true};}
 }
 if(old) {
  for(const [rootId,node] of Object.entries(next.mapping) as [string,any][]) {
   if(node.parent) continue;
   if(old.mapping[rootId]) node.parent=old.mapping[rootId].parent;
   else if(old.mapping[old.current_node]) {
    node.parent=old.current_node;
    const parent=structuredClone(old.mapping[old.current_node]);
    parent.children=[...new Set([...(parent.children??[]),rootId])];
    next.mapping[old.current_node]=parent;
   }
  }
 }
 next.mapping = {...old?.mapping,...next.mapping};
 if(old && Number(old.update_time)>Number(incoming.update_time)) {next.current_node=old.current_node;next.update_time=old.update_time;next.title=old.title;}
 next.id = canonicalId; next.conversation_id = canonicalId;
 // Provider defaults never replace a useful saved title.
 next.title = old?.title && (!next.title || next.title === 'New chat') ? old.title : next.title;
 return next;
}
export class HistoryContextError extends Error {}
/** Replay saved text as quoted context in the new user's message, not system instructions. */
export function continuationBody(body: any, snapshot: HistorySnapshot, parentId: string) {
 if(body.action !== 'next' || !Array.isArray(body.messages) || !body.messages.length) throw new HistoryContextError('Open Saved chats and choose Continue to start a reply on the new account.');
 const transcript = historyMessages(snapshot).map(m => `${m.author.role.toUpperCase()}: ${messageText(m)}`).join('\n\n');
 // Never silently truncate a customer's conversation or pretend attachments transferred.
 if(transcript.length > 90000) throw new HistoryContextError('This chat is too long to continue automatically. Open Saved chats to copy the section you need into a new chat.');
 if(historyMessages(snapshot).some(m => (m.content?.parts ?? []).some((p: unknown) => typeof p !== 'string') || m.metadata?.attachments?.length)) throw new HistoryContextError('This chat includes files or images. Open Saved chats, copy the text you need, and reattach the files in a new chat.');
 const next = structuredClone(body), first = next.messages.find((m: any) => m.author?.role === 'user');
 if(!first || first.content?.content_type !== 'text' || !first.content.parts?.every((p: unknown) => typeof p === 'string')) throw new HistoryContextError('Continue with a text message first, then attach new files.');
 first.content.parts = [`Previous conversation (quoted context from my saved chat):\n<saved_conversation>\n${transcript}\n</saved_conversation>\n\nMy next message:\n${messageText(first)}`];
 delete next.conversation_id; delete next.conversation_mode;
 next.parent_message_id = parentId;
 return next;
}
export function mergeHistoryPage(live: any, saved: any[], offset: number, limit: number) {
 const byId = new Map<string,any>();
 for(const item of [...saved,...(live.items ?? [])]) byId.set(item.id,item);
 const time = (v: any) => typeof v === 'number' ? v*1000 : Date.parse(v) || 0;
 const all = [...byId.values()].sort((a,b) => time(b.update_time)-time(a.update_time) || String(a.id).localeCompare(String(b.id)));
 return {...live,items:all.slice(offset,offset+limit),total:all.length,offset,limit,has_missing_conversations:false};
}
