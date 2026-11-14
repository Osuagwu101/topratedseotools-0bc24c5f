import {strict as assert} from "node:assert";
import {randomUUID,createHash} from "node:crypto";
import {supabaseAdmin as db0} from "../../src/integrations/supabase/client.server";
import {createClaudeProxyLaunch,handleClaudeProxyRequest as handle} from "../../src/lib/claude-proxy.server";
import {fetchClaudeProvider} from "../../src/lib/claude-browser-fetch.server";
import {getClaudeUsage,reserveClaudeMessage,releaseClaudeMessage} from "../../src/lib/claude-controls.server";
const db=db0 as any,origin=process.env.CLAUDE_PROXY_PUBLIC_ORIGIN!;
const grants=await db.from("tool_access_grants").select("user_id,expires_at").eq("tool_slug","claude").eq("status","active");if(grants.error)throw Error(grants.error.message);
const users=[...new Set((grants.data??[]).filter((g:any)=>!g.expires_at||Date.parse(g.expires_at)>Date.now()).map((g:any)=>g.user_id))].slice(0,2) as string[];assert.equal(users.length,2);
const cookies:string[]=[];
for(const id of users){const launch=await createClaudeProxyLaunch(id);const enter=await handle(new Request(launch.launchUrl));assert.equal(enter.status,302);cookies.push(enter.headers.get("set-cookie")!.split(";")[0]);}
assert.notEqual(cookies[0],cookies[1]);console.log(JSON.stringify({independent_writer_sessions:true}));
function request(i:number,path:string,method="GET",body?:string|Uint8Array,type="application/json"){
 return handle(new Request(origin+path,{method,headers:{Cookie:cookies[i],Origin:origin,"Content-Type":type,"x-organization-uuid":org},body,signal:AbortSignal.timeout(45000)}));
}
const orgs=await fetchClaudeProvider("https://claude.ai/api/organizations").then(r=>r.json()) as any[];const org=orgs[0].uuid;
console.log(JSON.stringify({parallel_pages:await Promise.all([0,1].map(async i=>{const r=await request(i,"/new");const t=await r.text();return {writer:i+1,status:r.status,native:t.includes("assets-proxy.anthropic.com")};}))}));
for(let i=0;i<2;i++){const r=await request(i,"/api/bootstrap");const raw=await r.text();assert.equal(r.status,200);assert(!JSON.parse(raw).intercom_user_jwt);console.log(JSON.stringify({writer:i+1,bootstrap_status:r.status,private_jwt_removed:true}));}
const conversations:string[]=[];
for(let i=0;i<2;i++){
 const r=await request(i,"/api/organizations/"+org+"/chat_conversations","POST",JSON.stringify({name:"Writer "+(i+1)+" isolation acceptance"}));
 const d=await r.json() as any;console.log(JSON.stringify({writer:i+1,create_status:r.status,has_conversation_id:!!d.uuid}));
 assert(r.ok);assert(d.uuid);conversations.push(d.uuid);
}
const enc=new TextEncoder();
function vi(n:number){const a=[];do{let b=n%128;n=Math.floor(n/128);a.push(b+(n?128:0));}while(n);return Uint8Array.from(a);}
function cat(...parts:Uint8Array[]){const b=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let i=0;for(const p of parts){b.set(p,i);i+=p.length;}return b;}
function f(n:number,v:string|Uint8Array){const b=typeof v==="string"?enc.encode(v):v;return cat(vi(n*8+2),vi(b.length),b);}
const rpc="/claudeai-rpc/anthropic.bard.api.v1alpha.ConversationService/";
function send(i:number,id=conversations[i]){
 const header=cat(f(1,cat(f(1,"sess_trst_"+randomUUID().replaceAll("-","").slice(0,16)),vi(16),vi(1))),f(2,id),vi(24),vi(3));
 const action=cat(f(1,randomUUID()),f(2,randomUUID()),f(3,"Reply with only WRITER_"+(i+1)+"_PRIVATE_OK."),f(7,f(2,"claude-opus-5-5")),f(8,f(1,new Uint8Array())));
 return cat(f(1,header),f(2,action));
}
for(let i=0;i<2;i++){
 const other=conversations[1-i];
 assert.equal((await request(i,"/chat/"+other)).status,404);
 assert.equal((await request(i,"/api/organizations/"+org+"/chat_conversations/"+other)).status,404);
 const b=f(1,other),stream=cat(new Uint8Array([0,0,0,0,b.length]),b);
 assert.equal((await request(i,rpc+"StreamTimeline","POST",stream,"application/connect+proto")).status,404);
 assert([403,404].includes((await request(i,rpc+"PerformAction","POST",send(i,other),"application/proto")).status));
}
console.log(JSON.stringify({cross_writer_page_rest_rpc_access:"blocked"}));
const results=await Promise.all([0,1].map(async i=>{const r=await request(i,"/api/organizations/"+org+"/chat_conversations/"+conversations[i]+"/completion","POST",JSON.stringify({prompt:"Reply with only WRITER_"+(i+1)+"_PRIVATE_OK.",model:"claude-opus-5-5",attachments:[],files:[],sync_sources:[],tools:[]}));const t=await r.arrayBuffer();return {writer:i+1,status:r.status,bytes:t.byteLength,remaining:r.headers.get("x-trst-messages-remaining")};}));
console.log(JSON.stringify({parallel_messages:results}));assert(results.every(r=>r.status===200));
for(let i=0;i<2;i++){
 const r=await request(i,"/api/organizations/"+org+"/chat_conversations");const d=await r.json() as any;
 const rows=Array.isArray(d)?d:d.conversations;assert.equal(r.status,200);assert(Array.isArray(rows));
 assert(rows.some((r:any)=>r.uuid===conversations[i]));assert(!rows.some((r:any)=>r.uuid===conversations[1-i]));
 console.log(JSON.stringify({writer:i+1,private_history:true,usage:await getClaudeUsage(users[i])}));
}
console.log(JSON.stringify({backend_acceptance:"passed",conversations}));
