/* Verified text-chat wire shapes only. Unknown fields/actions fail closed. */
export type ProtoField={number:number;wire:number;value:Uint8Array;raw:Uint8Array};
export function readClaudeProto(bytes:Uint8Array):ProtoField[]{
 if(bytes.length>2*1024*1024)throw Error("Request too large");
 let pos=0;const out:ProtoField[]=[];
 const v=()=>{let n=0,m=1;for(let i=0;i<8;i++){if(pos>=bytes.length)throw Error("Truncated protobuf");const b=bytes[pos++];n+=(b&127)*m;if(!(b&128)){if(!Number.isSafeInteger(n))throw Error("Invalid protobuf integer");return n;}m*=128;}throw Error("Invalid protobuf integer");};
 while(pos<bytes.length){const start=pos,key=v(),number=Math.floor(key/8),wire=key%8;if(!number||number>536870911)throw Error("Invalid protobuf field");
 let begin=pos,end:number;
 if(wire===0){v();end=pos;}else if(wire===1){end=pos+8;}else if(wire===5){end=pos+4;}else if(wire===2){const len=v();begin=pos;end=pos+len;}else throw Error("Unsupported protobuf field");
 if(end>bytes.length)throw Error("Truncated protobuf");pos=end;
 out.push({number,wire,value:bytes.slice(begin,end),raw:bytes.slice(start,end)});if(out.length>10000)throw Error("Too many protobuf fields");
 }return out;
}
function one(fields:ProtoField[],number:number,required=true){const found=fields.filter(f=>f.number===number);if(found.length>1||required&&!found.length)throw Error("Ambiguous protobuf field");return found[0];}
function str(field:ProtoField|undefined){if(!field||field.wire!==2)throw Error("Missing protobuf string");return new TextDecoder("utf-8",{fatal:true}).decode(field.value);}
function allow(fields:ProtoField[],numbers:number[]){if(fields.some(f=>!numbers.includes(f.number)))throw Error("Unsupported Claude feature");}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function uuid(f:ProtoField|undefined){const s=str(f);if(!UUID.test(s))throw Error("Invalid conversation or message id");return s.toLowerCase();}
export function inspectClaudeWriterRpc(path:string,body:Uint8Array,contentType:string,encoding:string|null){
 if(encoding&&encoding!=="identity")throw Error("Compressed requests are unavailable");
 if(path.endsWith("/StreamTimeline")){
  if(!contentType.startsWith("application/connect+proto")||body.length<5||body[0]!==0)throw Error("Invalid stream frame");
  const length=new DataView(body.buffer,body.byteOffset,body.byteLength).getUint32(1);
  if(length!==body.length-5)throw Error("Invalid stream frame");
  const fields=readClaudeProto(body.subarray(5));allow(fields,[1,2,3,4,5,6,8]);
  return {conversation:uuid(one(fields,1)),messageId:undefined,kind:"read" as const};
 }
 if(!path.endsWith("/PerformAction")||contentType.split(";")[0]!=="application/proto")throw Error("Unsupported Claude RPC");
 const fields=readClaudeProto(body);allow(fields,[1,2,15]);
 const header=one(fields,1);if(header.wire!==2)throw Error("Invalid action header");
 const h=readClaudeProto(header.value);allow(h,[1,2,3,7,14,15]);
 const conversation=uuid(one(h,2)),send=one(fields,2,false),configure=one(fields,15,false);
 if(Number(!!send)+Number(!!configure)!==1)throw Error("Unsupported Claude action");
 const action=send??configure!;if(action.wire!==2)throw Error("Invalid action");
 if(send){
  const a=readClaudeProto(send.value);allow(a,[1,2,3,7,8,12,13,18,21,38,54]);
  const messageId=uuid(one(a,1));uuid(one(a,2));
  if(!str(one(a,3)).trim())throw Error("Empty message");
  verifyModel(one(a,7,false));
  verifyTextOptions(one(a,8,false));
  return {conversation,messageId,kind:"send" as const};
 }
 const config=readClaudeProto(configure!.value);allow(config,[1]);
 const settings=readClaudeProto(one(config,1).value);allow(settings,[7,8]);
 verifyModel(one(settings,7,false));
 verifyTextOptions(one(settings,8,false));
 return {conversation,messageId:undefined,kind:"configure" as const};
}
function verifyModel(field:ProtoField|undefined){if(!field)return;const m=readClaudeProto(field.value);allow(m,[2]);if(!/^claude-[a-z0-9-]+$/.test(str(one(m,2))))throw Error("Invalid model configuration");}
function verifyTextOptions(field:ProtoField|undefined){
 if(!field)return;
 const wrappers=readClaudeProto(field.value);allow(wrappers,[1]);
 for(const f of wrappers){if(f.wire!==2)throw Error("Invalid chat options");const options=readClaudeProto(f.value);allow(options,[1,7,8,10,14]);
  // Enabled connector tools are never accepted from a writer, including forged binary requests.
  for(const tools of options.filter(f=>f.number===8)){
   const entries=readClaudeProto(tools.value);
   for(const entry of entries){if(entry.number!==1||entry.wire!==2)throw Error("Unsupported connector options");
    const tool=readClaudeProto(entry.value);allow(tool,[1,2]);
    const enabled=one(tool,2,false);if(!enabled||enabled.wire!==0||enabled.value.some(v=>v!==0))throw Error("Account connectors are not enabled for writers");
   }
  }
 }
}
export function sanitizeClaudeBootstrap(value:any):any{
 if(Array.isArray(value))return value.map(sanitizeClaudeBootstrap);
 if(!value||typeof value!=="object")return value;
 const out:any={};
 for(const [key,item] of Object.entries(value)){
  if(/intercom|jwt|secret|password|verified_phone|invites|instructions|preferences|artifact_pins|browser_extension|session_state|share_notices|(?:access|refresh|session)_token/i.test(key)){out[key]=Array.isArray(item)?[]:item===null?null:typeof item==="object"?{}:typeof item==="string"?"":typeof item==="boolean"?false:0;continue;}
  // Connectors/plugins are shared with writers (owner decision 23 Nov 2026), minus blocked providers.
  if(/^(?:enabled_mcp_tools|mcp_tools|connectors|integrations|mcp_servers|remote_servers|plugins|skills)$/i.test(key)){out[key]=withoutBlockedConnectors(sanitizeClaudeBootstrap(item));continue;}
  if(/^(?:projects|artifacts|files|recent_artifacts|pinned_conversations)$/i.test(key)){out[key]=Array.isArray(item)?[]:{};continue;}
  if(/^(?:grove_enabled|personalized_drafts)$/i.test(key)){out[key]=false;continue;}
  if(/(?:chat_conversations|chat_messages|conversation_history)/i.test(key)){out[key]=[];continue;}
  out[key]=sanitizeClaudeBootstrap(item);
 }
 return out;
}
export function filterClaudeWriterHistory(payload:any,ids:Set<string>){
 const filter=(rows:any[])=>rows.filter(r=>r&&typeof r.uuid==="string"&&ids.has(r.uuid.toLowerCase()));
 if(Array.isArray(payload))return filter(payload);
 if(payload&&typeof payload==="object"&&Array.isArray(payload.data))return {...payload,data:filter(payload.data)};
 if(payload&&typeof payload==="object"&&Array.isArray(payload.conversations))return {...payload,conversations:filter(payload.conversations)};
 throw Error("Unrecognised history response");
}

export function claudeWriterHasExternalReferences(value:any,depth=0):boolean{
 if(depth>32)return true;
 if(!value||typeof value!=="object")return false;
 if(Array.isArray(value))return value.some(v=>claudeWriterHasExternalReferences(v,depth+1));
 for(const [key,item] of Object.entries(value)){
  if(/^(?:project_?(?:uuid|id)|file_?(?:uuid|id)|attachment_?uuid|sync_?source|integration_?id)$/i.test(key)&&item!=null&&item!=="")return true;
  if(["attachments","files","sync_sources"].includes(key)&&item!=null&&(!Array.isArray(item)||item.length))return true;
  if(claudeWriterHasExternalReferences(item,depth+1))return true;
 }
 return false;
}

/** GitHub and Supabase connectors are never available to writers. */
export const BLOCKED_CONNECTOR_RE=/github|supabase/i;
/** Tools that read the shared account's memory or other writers' chats. */
const SHARED_MEMORY_TOOL_RE=/memory|conversation_search|recent_chats|past_chats|chat_search|search_chats/i;
/** Ids of blocked connectors seen in listings, so opaque ids in later requests are refused too. */
export const blockedConnectorIds=new Set<string>();
function mentionsBlocked(value:any){
 let text="";try{text=JSON.stringify(value)??""}catch{return true}
 if(BLOCKED_CONNECTOR_RE.test(text))return true;
 for(const id of blockedConnectorIds)if(text.includes(id))return true;
 return false;
}
function rememberBlocked(value:any){
 if(!value||typeof value!=="object")return;
 for(const k of ["uuid","id","server_id","server_uuid","plugin_id","connector_id"]){const v=value[k];if(typeof v==="string"&&v.length>=6)blockedConnectorIds.add(v.toLowerCase())}
}
/** Remove GitHub/Supabase entries from connector, plugin and tool listings (arrays or id-keyed maps). */
export function withoutBlockedConnectors(value:any,depth=0):any{
 if(depth>12||!value||typeof value!=="object")return value;
 if(Array.isArray(value))return value.filter(v=>{if(v&&typeof v==="object"&&mentionsBlocked(v)){rememberBlocked(v);return false}return !(typeof v==="string"&&BLOCKED_CONNECTOR_RE.test(v))}).map(v=>withoutBlockedConnectors(v,depth+1));
 const out:any={};
 for(const [k,v] of Object.entries(value)){
  if(BLOCKED_CONNECTOR_RE.test(k)||[...blockedConnectorIds].some(id=>k.toLowerCase().includes(id)))continue;
  if(v&&typeof v==="object"&&!Array.isArray(v)&&depth>0&&BLOCKED_CONNECTOR_RE.test(String((v as any).name??(v as any).url??(v as any).display_name??""))){rememberBlocked(v);continue}
  out[k]=withoutBlockedConnectors(v,depth+1);
 }
 return out;
}
function writerTools(tools:any){
 if(!Array.isArray(tools))return [];
 return tools.filter(t=>{let text="";try{text=JSON.stringify(t)??""}catch{return false}return !SHARED_MEMORY_TOOL_RE.test(text)&&!mentionsBlocked(t)});
}
/** Writer messages: connector/plugin tools allowed; shared memory, past-chat search, GitHub and Supabase removed. */
export function isolateClaudeWriterPayload(payload:any){
 const out:any={...payload,tools:writerTools(payload.tools)};
 if(payload.enabled_mcp_tools&&typeof payload.enabled_mcp_tools==="object")out.enabled_mcp_tools=withoutBlockedConnectors(payload.enabled_mcp_tools);
 // These flags belong to the conversation-creation object, not Completion.
 delete out.chat_memory_mode;delete out.include_conversation_preferences;delete out.personalized_styles;
 if(payload.create_conversation_params&&typeof payload.create_conversation_params==="object"){
  out.create_conversation_params={...payload.create_conversation_params,chat_memory_mode:"disabled",include_conversation_preferences:false};
  if(out.create_conversation_params.enabled_mcp_tools&&typeof out.create_conversation_params.enabled_mcp_tools==="object")out.create_conversation_params.enabled_mcp_tools=withoutBlockedConnectors(out.create_conversation_params.enabled_mcp_tools);
  else delete out.create_conversation_params.enabled_mcp_tools;
 }
 return out;
}

export type ClaudeWriterReferences = {
  /** Provider file ids the message attaches; each must be owned by the writer. */
  fileIds: string[];
  /** Project, connector, sync-source or unrecognised file references. Always refused. */
  blocked: string | null;
};
const FILE_ID_RE = /^[A-Za-z0-9_-]{8,128}$/;
const SANDBOX_PATH_RE = /^\/mnt\/(?:user-data|data)\/[^\x00-\x1f]{1,1000}$/;
function fileRefId(item: any): string | null | undefined {
  if (typeof item === "string") return FILE_ID_RE.test(item) ? item.toLowerCase() : null;
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  for (const k of ["file_uuid", "fileUuid", "file_id", "fileId", "uuid", "id"]) {
    const v = item[k];
    if (v != null && v !== "") return typeof v === "string" && FILE_ID_RE.test(v) ? v.toLowerCase() : null;
  }
  return undefined; // no id at all
}
/**
 * Writer messages may carry their own uploads: inline extracted text, files the
 * writer uploaded (checked by id against claude_file_owners), or files in the
 * writer's own conversation sandbox (by /mnt path). Projects, connectors, sync
 * sources and any unrecognised reference shape still fail closed.
 */
export function claudeWriterReferences(value: any): ClaudeWriterReferences {
  const ids = new Set<string>();
  let blocked: string | null = null;
  const walk = (v: any, depth: number) => {
    if (blocked) return;
    if (depth > 32) { blocked = "depth"; return; }
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1); return; }
    for (const [key, item] of Object.entries(v)) {
      if (blocked) return;
      if (/^project_?(?:uuid|id)$/i.test(key)) {
        if (item != null && item !== "") blocked = key;
        continue;
      }
      if (/^(?:sync_?sources?|integration_?ids?)$/i.test(key)) {
        if (item != null && mentionsBlocked(item)) blocked = key;
        continue;
      }
      if (key === "files" || key === "attachments") {
        if (item == null) continue;
        if (!Array.isArray(item)) { blocked = key; return; }
        for (const entry of item) {
          // Inline text attachments carry their content; any local id on them is not a provider file.
          if (key === "attachments" && typeof entry?.extracted_content === "string") continue;
          const id = fileRefId(entry);
          if (id) { ids.add(id); continue; }
          if (id === null) { blocked = key; return; }
          // No id: inline text attachment, or a file in the conversation's own sandbox.
          const inline = typeof entry?.extracted_content === "string";
          const sandbox = typeof entry?.path === "string" && SANDBOX_PATH_RE.test(entry.path) && !entry.path.split("/").includes("..");
          if (!inline && !sandbox) { blocked = key; return; }
        }
        continue;
      }
      if (/^(?:file_?(?:uuid|id)|attachment_?uuid)$/i.test(key)) {
        if (item == null || item === "") continue;
        if (typeof item === "string" && FILE_ID_RE.test(item)) ids.add(item.toLowerCase());
        else blocked = key;
        continue;
      }
      walk(item, depth + 1);
    }
  };
  walk(value, 0);
  return { fileIds: [...ids], blocked };
}

/** Provider file ids returned by an upload response, for ownership registration. */
export function claudeUploadedFileIds(payload: any): string[] {
  const ids = new Set<string>();
  const take = (o: any) => {
    if (!o || typeof o !== "object" || Array.isArray(o)) return;
    for (const k of ["file_uuid", "fileUuid", "file_id", "uuid"]) {
      const v = o[k];
      if (typeof v === "string" && FILE_ID_RE.test(v)) ids.add(v.toLowerCase());
    }
  };
  take(payload);
  if (payload && typeof payload === "object") {
    take(payload.file);
    for (const k of ["files", "data"]) if (Array.isArray(payload[k])) payload[k].forEach(take);
  }
  return [...ids];
}
