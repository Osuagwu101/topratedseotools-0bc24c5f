import {test,expect} from "bun:test";
import {inspectClaudeWriterRpc,readClaudeProto,sanitizeClaudeBootstrap,filterClaudeWriterHistory,claudeWriterHasExternalReferences,isolateClaudeWriterPayload} from "../src/lib/claude-writer-policy";
import {claudeBrowserRoutePolicy} from "../src/lib/claude-browser-route-policy";
const conv="11111111-1111-4111-8111-111111111111",human="22222222-2222-4222-8222-222222222222",assistant="33333333-3333-4333-8333-333333333333";
const enc=new TextEncoder();
function vi(n:number){const b=[];do{let v=n%128;n=Math.floor(n/128);b.push(v+(n?128:0));}while(n);return Uint8Array.from(b);}
function cat(...parts:Uint8Array[]){const b=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let i=0;for(const p of parts){b.set(p,i);i+=p.length;}return b;}
function f(n:number,v:string|Uint8Array){const b=typeof v==="string"?enc.encode(v):v;return cat(vi(n*8+2),vi(b.length),b);}
function send(extra=new Uint8Array()){return cat(f(1,f(2,conv)),f(2,cat(f(1,human),f(2,assistant),f(3,"test message"),extra)));}
const path="/claudeai-rpc/anthropic.bard.api.v1alpha.ConversationService/";
test("new text messages identify their conversation and message",()=>{expect(inspectClaudeWriterRpc(path+"PerformAction",send(),"application/proto",null)).toEqual({conversation:conv,messageId:human,kind:"send"});});
test("stream framing identifies conversation and rejects appended frames",()=>{const b=f(1,conv),frame=cat(new Uint8Array([0,0,0,0,b.length]),b);expect(inspectClaudeWriterRpc(path+"StreamTimeline",frame,"application/connect+proto",null).conversation).toBe(conv);expect(()=>inspectClaudeWriterRpc(path+"StreamTimeline",cat(frame,frame),"application/connect+proto",null)).toThrow();});
test("duplicate conversation identifiers fail closed",()=>{expect(()=>inspectClaudeWriterRpc(path+"PerformAction",cat(f(1,cat(f(2,conv),f(2,human))),f(2,cat(f(1,human),f(2,assistant),f(3,"test")))),"application/proto",null)).toThrow();});
test("unknown actions, attachments and compressed messages are rejected",()=>{
 expect(()=>inspectClaudeWriterRpc(path+"PerformAction",cat(f(1,f(2,conv)),f(16,f(1,human))),"application/proto",null)).toThrow();
 expect(()=>inspectClaudeWriterRpc(path+"PerformAction",send(f(4,"other writer file")),"application/proto",null)).toThrow();
 expect(()=>inspectClaudeWriterRpc(path+"PerformAction",send(),"application/proto","gzip")).toThrow();
});
test("forged enabled connector options cannot reach the account",()=>{
 const enabledTool=cat(f(1,"private-tool"),vi(16),vi(1));
 const options=f(8,f(1,f(8,f(1,enabledTool))));
 expect(()=>inspectClaudeWriterRpc(path+"PerformAction",send(options),"application/proto",null)).toThrow();
});
test("truncated and ambiguous protobuf input is rejected",()=>{for(const b of [new Uint8Array([255]),new Uint8Array([10,100,1]),new Uint8Array([0]),new Uint8Array([15])])expect(()=>readClaudeProto(b)).toThrow();});
test("history returns only the current writer's conversations",()=>{
 const list=[{uuid:conv,name:"writer one"},{uuid:human,name:"writer two"}];
 expect(filterClaudeWriterHistory(list,new Set([conv]))).toEqual([list[0]]);
 expect(filterClaudeWriterHistory({conversations:list,next_cursor:"cursor"},new Set([human])).conversations).toEqual([list[1]]);
 expect(filterClaudeWriterHistory({data:list,has_more:false},new Set([conv])).data).toEqual([list[0]]);
 expect(()=>filterClaudeWriterHistory({new_history_shape:list},new Set([conv]))).toThrow();
});
test("bootstrap removes private shared content and connector settings",()=>{
 const value=sanitizeClaudeBootstrap({account:{uuid:conv,invites:[{name:"private"}],settings:{enabled_mcp_tools:{"tool":true},grove_enabled:true,profile_instructions:"private"},email_address:"owner"},intercom_user_jwt:"private",chat_messages:["private"],projects:[{name:"private"}]});
 expect(JSON.stringify(value)).not.toContain("private");
 expect(value.account.settings.enabled_mcp_tools).toEqual({});
 expect(value.account.settings.grove_enabled).toBe(false);
 expect(value.account.invites).toEqual([]);
});
test("untracked API, project, account settings and traversal routes are rejected",()=>{
 for(const p of ["/api/unknown","/api/settings","/edge-api/projects","/api/organizations/"+conv+"/projects","/api/organizations/"+conv+"/chat_conversations/"+human+"/files","/edge-api/../settings"])expect(claudeBrowserRoutePolicy("GET",p)).toBeNull();
 expect(claudeBrowserRoutePolicy("POST",path+"StreamTimeline")?.kind).toBe("rpc");
 expect(claudeBrowserRoutePolicy("POST",path+"GetNewConversationDefaults")).toBeNull();
});

test("empty native attachment defaults are accepted, real references rejected",()=>{
 expect(claudeWriterHasExternalReferences({prompt:'Explain {"file_uuid":"example"}',project_uuid:null,attachments:[],files:[],sync_sources:[]})).toBe(false);
 expect(claudeWriterHasExternalReferences({project_uuid:"foreign"})).toBe(true);
 expect(claudeWriterHasExternalReferences({options:{fileUuid:"foreign"}})).toBe(true);
 expect(claudeWriterHasExternalReferences({attachments:["foreign"]})).toBe(true);
});

test("text messages cannot enable shared memory or connector tools",()=>{
 const out=isolateClaudeWriterPayload({tools:[{type:"memory"}],chat_memory_mode:"enabled",include_conversation_preferences:true,create_conversation_params:{include_conversation_preferences:true,enabled_mcp_tools:{private:true}}});
 expect(out.tools).toEqual([]);expect(out.chat_memory_mode).toBeUndefined();expect(out.include_conversation_preferences).toBeUndefined();expect(out.create_conversation_params.chat_memory_mode).toBe("disabled");expect(out.create_conversation_params.include_conversation_preferences).toBe(false);expect(out.create_conversation_params.enabled_mcp_tools).toBeUndefined();
});
