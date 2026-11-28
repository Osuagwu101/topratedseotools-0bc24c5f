import {strict as assert} from "node:assert";
import {mock} from "bun:test";
import {encryptChatGptSession,decryptChatGptSession,normaliseChatGptSession} from "../src/lib/chatgpt-session.server";
process.env.CHATGPT_SESSION_ENCRYPTION_KEY="11".repeat(32);
process.env.CHATGPT_PROXY_PUBLIC_ORIGIN="https://chatgpt.topratedseotools.com";
const origin=process.env.CHATGPT_PROXY_PUBLIC_ORIGIN;
const sessions=["writer-one","writer-two"].map((user_id,i)=>({id:"session"+i,user_id,source_kind:"grant",source_id:"grant"+i,status:"active",token_hash:"",device_fingerprint:String(i+1).repeat(32),expires_at:new Date(Date.now()+100000).toISOString(),provider_account_key:"account_"+(i+1)}));
const controls=sessions.map(s=>({user_id:s.user_id,status:"active",device_limit:2,provider_account_key:s.provider_account_key}));
const accounts=[1,2].map(n=>({account_key:"account_"+n,status:"stored",verified_at:new Date().toISOString(),encrypted_payload:encryptChatGptSession(normaliseChatGptSession(JSON.stringify({cookies:[{name:"__Secure-next-auth.session-token",value:"test-session-account-"+n,domain:".chatgpt.com",path:"/"}]})))}));
const owners:any[]=[];
let dbError=false;
const tables:any={chatgpt_proxy_sessions:sessions,chatgpt_user_controls:controls,chatgpt_provider_accounts:accounts,chatgpt_conversation_owners:owners,chatgpt_devices:sessions.map(s=>({id:"dev"+s.id,user_id:s.user_id,device_fingerprint:s.device_fingerprint})),tool_settings:[{tool_slug:"chatgpt",enabled:true,one_click_auth_enabled:true}],tool_authorized_sessions:[{tool_slug:"chatgpt",status:"stored",encrypted_payload:accounts[0].encrypted_payload}],tool_access_grants:sessions.map(s=>({id:s.source_id,user_id:s.user_id,tool_slug:"chatgpt",status:"active",expires_at:null}))};
mock.module("../src/integrations/supabase/client.server",()=>({supabaseAdmin:{from(table:string){
 const filters:any={};let patch:any,insert:any;
 const result=()=>{if(dbError&&table==="chatgpt_conversation_owners")return {data:null,error:{message:"database unavailable"}};let rows=(tables[table]??[]).filter((r:any)=>Object.entries(filters).every(([k,v])=>(Array.isArray(v)?v.includes(r[k]):r[k]===v)));
 if(patch)rows.forEach((r:any)=>Object.assign(r,patch));
 if(insert){const a=insert;const target=tables[table]??(tables[table]=[]);if(!target.some((o:any)=>o.provider_account_key===a.provider_account_key&&(a.project_id?o.project_id===a.project_id:o.conversation_id===a.conversation_id)))target.push({...a});rows=[a];}
 return {data:rows,error:null};};
 const q:any={select(){return q},eq(k:string,v:any){filters[k]=v;return q},in(k:string,v:any){filters[k]=v;return q},order(){return q},limit(){return q},update(p:any){patch=p;return q},upsert(p:any){insert=p;return q},async maybeSingle(){const r=result();return {...r,data:r.data?.[0]??null}},then(fn:any){return Promise.resolve(result()).then(fn)}};return q;
}}}));
const {handleChatGPTProxyRequest:handle,hashChatGPTProxyToken,persistRotatedChatGPTCookies}=await import("../src/lib/chatgpt-proxy.server");
const {ownerOfConversation,claimConversation}=await import("../src/lib/chatgpt-isolation.server");
sessions.forEach((s,i)=>s.token_hash=hashChatGPTProxyToken(String(i+1).repeat(43)));
const P1="g-p-"+"a".repeat(32),P2="g-p-"+"b".repeat(32),P3="g-p-"+"c".repeat(32);
tables.chatgpt_project_grants=[{provider_account_key:"account_1",project_id:P1,user_id:"writer-one"}];
const {forgetProjectGrantCache,rememberCreatedProject}=await import("../src/lib/chatgpt-isolation.server");
const calls:any[]=[];const realFetch=globalThis.fetch;
globalThis.fetch=(async(input:any,init:any)=>{
 const path=new URL(String(input)).pathname;calls.push(path);
 if(path==="/api/auth/session")return Response.json({accessToken:"test-server-token"});
 if(path==="/backend-api/gizmos"&&init.method==="POST")return Response.json({gizmo:{gizmo:{id:P3,display:{name:"Created by writer"}}}});
 if(path.includes("/gizmos/"))return Response.json({items:[P1,P2,P3].map(id=>({gizmo:{gizmo:{id,display:{name:id===P2?"Private upstream project":"Permitted project"}}}}))});
 return Response.json({items:[]});
}) as typeof fetch;
function req(i:number,path:string,body?:object){return new Request(origin+path,{method:body?"POST":"GET",headers:{Cookie:"trst_cg_proxy="+String(i+1).repeat(43)+"; trst_cg_device="+String(i+1).repeat(32),Origin:origin,Accept:"application/json","Content-Type":"application/json"},body:body?JSON.stringify(body):undefined});}
try {
 const sidebar="/backend-api/gizmos/snorlax/sidebar";
 const first=await handle(req(0,sidebar));assert.equal(first.status,200);const view=await first.json();
 assert.deepEqual(view.items.map((x:any)=>x.gizmo.gizmo.id),[P1]);assert(!JSON.stringify(view).includes("Private upstream"));
 const second=await handle(req(1,sidebar));assert.equal(second.status,200);assert.deepEqual((await second.json()).items,[]);
 let before=calls.length;
 assert.equal((await handle(req(0,`/backend-api/gizmos/${P2}`))).status,404);
 assert.equal((await handle(req(1,`/backend-api/gizmos/${P1}/conversations`))).status,404);
 assert.equal((await handle(req(0,"/backend-api/f/conversation",{gizmo_id:P2}))).status,404);
 assert.equal(calls.length,before);
 const created=await handle(req(0,"/backend-api/gizmos",{name:"My new project",type:"snorlax"}));assert.equal(created.status,200);
 assert.equal((await created.json()).gizmo.gizmo.id,P3);
 assert(tables.chatgpt_project_grants.some((x:any)=>x.project_id===P3&&x.user_id==="writer-one"&&x.provider_account_key==="account_1"));
 await assert.rejects(()=>rememberCreatedProject(P1,"writer-two","account_1"));
 const after=await handle(req(0,sidebar));assert.deepEqual((await after.json()).items.map((x:any)=>x.gizmo.gizmo.id),[P1,P3]);
 tables.chatgpt_project_grants=[];forgetProjectGrantCache();
 assert.deepEqual((await (await handle(req(0,sidebar))).json()).items,[]);
 console.log("Project isolation handler: upstream lists filtered, unknown direct links and messages denied, assigned projects preserved, creation ownership and conflicts verified across accounts.");
} finally {globalThis.fetch=realFetch;mock.restore();}
