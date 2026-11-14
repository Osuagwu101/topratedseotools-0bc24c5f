import {writeFileSync} from "node:fs";
import {getClaudeUsage} from "../../src/lib/claude-controls.server";
import {fetchClaudeProvider} from "../../src/lib/claude-browser-fetch.server";
import {createClaudeProxyLaunch} from "../../src/lib/claude-proxy.server";
import {supabaseAdmin as db0} from "../../src/integrations/supabase/client.server";
import {writeFile} from "node:fs/promises";
const db=db0 as any,origin=process.env.CLAUDE_PROXY_PUBLIC_ORIGIN!;
const grants=await db.from("tool_access_grants").select("user_id,expires_at").eq("tool_slug","claude").eq("status","active");
const users=[...new Set((grants.data??[]).filter((g:any)=>!g.expires_at||Date.parse(g.expires_at)>Date.now()).map((g:any)=>g.user_id))].slice(0,2) as string[];
const version=await fetch("http://127.0.0.1:9226/json/version").then(r=>r.json()) as any;
const ws=new WebSocket(version.webSocketDebuggerUrl);
await new Promise<void>((resolve,reject)=>{ws.addEventListener("open",()=>resolve(),{once:true});ws.addEventListener("error",()=>reject(Error("Browser connection failed")),{once:true});});
let quotaResponseResolve:((value:boolean)=>void)|undefined;
let n=0;const pending=new Map<number,any>(),errors:any[]=[];
ws.addEventListener("message",e=>{const d=JSON.parse(String(e.data));if(d.id&&pending.has(d.id)){const p=pending.get(d.id);pending.delete(d.id);clearTimeout(p.timer);d.error?p.reject(Error(d.error.message)):p.resolve(d.result);}
 if(d.method==="Network.requestWillBeSent"&&d.params.request.method==="POST"&&d.params.request.url.includes("/chat_conversations")){try{const body=JSON.parse(d.params.request.postData??"{}");writeFileSync("/home/ubuntu/qa/claude-browser-transport-20261114/writer-rest-fixture.json",JSON.stringify(body),{mode:0o600});console.log(JSON.stringify({writer_request:new URL(d.params.request.url).pathname,keys:Object.keys(body),configuration:Object.fromEntries(Object.entries(body).filter(([k])=>/tool|mcp|memory|preference|project/.test(k)).map(([k,v])=>[k,Array.isArray(v)?{array:v.length}:v===null?null:typeof v==="boolean"?v:typeof v]))}));}catch{}}
 if(d.method==="Network.responseReceived"&&d.params.response.status===400&&d.params.response.url.includes("/completion")){setTimeout(()=>{call("Network.getResponseBody",{requestId:d.params.requestId},d.sessionId).then(r=>console.log(JSON.stringify({completion_error:r.body?.slice(0,1800)}))).catch(()=>{});},200);}
 if(d.method==="Network.responseReceived"&&d.params.response.status===429&&d.params.response.url.includes("/completion"))quotaResponseResolve?.(true);
 if(d.method==="Network.responseReceived"&&d.params.response.url.includes("/completion"))console.log(JSON.stringify({completion_status:d.params.response.status}));
 if(d.method==="Network.responseReceived"&&d.params.response.status>=400){const u=new URL(d.params.response.url);if(u.origin===origin)errors.push({session:d.sessionId,path:u.pathname,status:d.params.response.status});}
});
function call(method:string,params:any={},sessionId?:string):Promise<any>{return new Promise((resolve,reject)=>{const id=++n,timer=setTimeout(()=>{pending.delete(id);reject(Error("Browser operation timed out: "+method));},20000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});}
const contexts:string[]=[],sessions:string[]=[];
async function evaluate(session:string,expression:string){const r=await call("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true},session);if(r.exceptionDetails)throw Error("Browser test evaluation failed");return r.result?.value;}
try{
 for(let i=0;i<2;i++){
  const c=await call("Target.createBrowserContext",{disposeOnDetach:true});contexts.push(c.browserContextId);
  const t=await call("Target.createTarget",{url:"about:blank",browserContextId:c.browserContextId});
  const s=await call("Target.attachToTarget",{targetId:t.targetId,flatten:true});sessions.push(s.sessionId);
  await call("Page.enable",{},s.sessionId);await call("Runtime.enable",{},s.sessionId);await call("Network.enable",{},s.sessionId);
  const launch=await createClaudeProxyLaunch(users[i]);await call("Page.navigate",{url:launch.launchUrl},s.sessionId);
 }
 await new Promise(r=>setTimeout(r,12000));
 const initial=await Promise.all(sessions.map(async(s,i)=>({writer:i+1,...await evaluate(s,`({path:location.pathname,composer:!!document.querySelector('[contenteditable=true]'),loginForm:!!document.querySelector('input[type=email]'),chatLinks:[...document.querySelectorAll('a[href*="/chat/"]')].map(a=>a.getAttribute('href'))})`)})));
 console.log(JSON.stringify({isolated_browser_entry:initial,blocked_paths:errors.map(({path,status})=>({path,status})).slice(0,30)}));
 if(initial.some(p=>!p.composer||p.loginForm))throw Error("Native writer composer did not load");
 for(let i=0;i<2;i++){
  console.log(JSON.stringify({writer:i+1,stage:"focus"}));
  await evaluate(sessions[i],`(()=>{const e=document.querySelector('[contenteditable=true]');if(e.innerText.trim())throw Error('Test composer was not empty');e.focus();return true})()`);
  console.log(JSON.stringify({writer:i+1,stage:"type"}));
  await call("Input.insertText",{text:"Reply with only LIVE_WRITER_"+(i+1)+"_OK."},sessions[i]);
 }
 await new Promise(r=>setTimeout(r,800));
 const submitted=await Promise.all(sessions.map((s,i)=>evaluate(s,`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')==='Send message');if(!b||b.disabled)return false;b.click();return true})()`)));
 console.log(JSON.stringify({parallel_browser_submissions:submitted}));
 await new Promise(r=>setTimeout(r,20000));
 const results=await Promise.all(sessions.map(async(s,i)=>({writer:i+1,...await evaluate(s,`({path:location.pathname,ownReply:document.body.innerText.split('LIVE_WRITER_${i+1}_OK').length>=3,otherReply:document.body.innerText.includes('LIVE_WRITER_${2-i}_OK'),usageError:document.body.innerText.includes('Daily limit reached')})`)})));
 console.log(JSON.stringify({visible_reply_results:results,blocked_paths:errors.map(({path,status})=>({path,status})).slice(-30)}));
 await writeFile("/home/ubuntu/qa/claude-browser-transport-20261114/writer-browser-validation.json",JSON.stringify({initial,submitted,results,errors:errors.map(({path,status})=>({path,status}))},null,2),{mode:0o600});
 if(results.some(r=>!r.path.startsWith("/chat/")||!r.ownReply||r.otherReply))throw Error("Visible native replies were not verified");
 const organizations=await fetchClaudeProvider("https://claude.ai/api/organizations").then(r=>r.json()) as any[];
 const org=organizations[0].uuid;
 for(let i=0;i<2;i++){
  const id=results[i].path.split("/")[2];
  const conversation=await fetchClaudeProvider("https://claude.ai/api/organizations/"+org+"/chat_conversations/"+id+"?tree=True").then(r=>r.json()) as any;
  if(!conversation.chat_messages?.some((m:any)=>m.sender==="assistant"&&JSON.stringify(m).includes("LIVE_WRITER_"+(i+1)+"_OK")))throw Error("Stored assistant reply missing");
  const history=await evaluate(sessions[i],"(async()=>{const r=await fetch("+JSON.stringify(origin+"/api/organizations/"+org+"/chat_conversations_v2")+");const d=await r.json();return {status:r.status,ids:d.data?.map(r=>r.uuid)}})()");
  if(history.status!==200||!history.ids?.includes(id)||history.ids.includes(results[1-i].path.split("/")[2]))throw Error("Native history isolation failed");
  await call("Page.reload",{},sessions[i]);
 }
 await new Promise(r=>setTimeout(r,12000));
 const reloaded=await Promise.all(sessions.map((s,i)=>evaluate(s,`({ownReply:document.body.innerText.split('LIVE_WRITER_${i+1}_OK').length>=3,otherReply:document.body.innerText.includes('LIVE_WRITER_${2-i}_OK')})`)));
 console.log(JSON.stringify({reloaded,post_reload_errors:errors.slice(-10).map(({path,status})=>({path,status}))}));
 if(reloaded.some(r=>!r.ownReply||r.otherReply))throw Error("History reload did not preserve private replies");
 const baseline=await getClaudeUsage(users[0]);
 try{
  const update=await db.from("claude_user_controls").update({daily_message_limit:baseline.used}).eq("user_id",users[0]);if(update.error)throw Error("Could not prepare quota UI test");
  await call("Page.navigate",{url:origin+"/new"},sessions[0]);await new Promise(r=>setTimeout(r,6000));
  await evaluate(sessions[0],"(()=>{document.querySelector('[contenteditable=true]').focus();return true})()");
  await call("Input.insertText",{text:"Reply with LIMIT_SHOULD_NOT_SEND."},sessions[0]);
  await evaluate(sessions[0],"(()=>{window.__trstLimitObserved=false;const o=new MutationObserver(()=>{const e=document.getElementById(\"trst-claude-daily-limit\");if(e?.textContent.includes(\"Daily limit reached\"))window.__trstLimitObserved=true});o.observe(document.body,{childList:true,subtree:true});return true})()");
  const quotaResponse=new Promise<boolean>(resolve=>{quotaResponseResolve=resolve;setTimeout(()=>resolve(false),10000);});
  await evaluate(sessions[0],"(()=>{[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')==='Send message').click();return true})()");
  if(!await quotaResponse)throw Error("Native quota rejection missing");
  await new Promise(r=>setTimeout(r,300));
  const shown=await evaluate(sessions[0],"window.__trstLimitObserved===true");
  if(!shown)throw Error("Daily limit message was not visible");
  await new Promise(r=>setTimeout(r,3300));
  const dismissed=await evaluate(sessions[0],"!document.getElementById('trst-claude-daily-limit')");
  if(!dismissed)throw Error("Daily limit message did not dismiss");
  if((await getClaudeUsage(users[0])).used!==baseline.used)throw Error("Rejected message changed quota usage");
  console.log(JSON.stringify({native_limit_rejection:true,center_message_visible:shown,auto_dismissed:dismissed,no_extra_charge:true}));
 }finally{await db.from("claude_user_controls").update({daily_message_limit:baseline.limit}).eq("user_id",users[0]);}
 console.log(JSON.stringify({stored_assistant_replies:true,native_history_isolation:true,reload_checks:reloaded,native_browser_acceptance:"passed"}));
}finally{for(const id of contexts)await call("Target.disposeBrowserContext",{browserContextId:id}).catch(()=>{});ws.close();}
