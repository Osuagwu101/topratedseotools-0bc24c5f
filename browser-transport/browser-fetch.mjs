import fs from 'node:fs';
import {loadEnvFile} from 'node:process';
loadEnvFile(new URL('../.secrets/browser-relay.env',import.meta.url));
let shellCache=null,shellFlight=null;
export async function browserFetch(target,init={}){
 const shell=new URL(target);
 if(shell.origin==='https://quillbot.com'&&shell.pathname==='/paraphrasing-tool'&&(!init.method||init.method==='GET')){
  if(shellCache&&shellCache.until>Date.now())return new Response(shellCache.text,{status:200,headers:shellCache.headers});
  if(!shellFlight)shellFlight=relayFetch(target,init).then(async response=>{
    const text=await response.text(),headers=Object.fromEntries(response.headers);
    if(response.ok&&!response.headers.has('cf-mitigated'))shellCache={text,headers,until:Date.now()+60000};
    return {text,headers,status:response.status};
  }).finally(()=>{shellFlight=null});
  const data=await shellFlight;return new Response(data.text,{status:data.status,headers:data.headers});
 }
 return relayFetch(target,init);
}
async function relayFetch(target,init={}){
 const u=new URL(target);
 if(['libs.quillbot.com','assets.quillbot.com'].includes(u.hostname)&&u.protocol==='https:'&&u.port===''){
 if(!['GET','HEAD'].includes(init.method||'GET'))return new Response('Static assets only',{status:403});
 return fetch(u,{method:init.method||'GET',redirect:'error',headers:{'accept':'*/*','user-agent':'Mozilla/5.0'},signal:AbortSignal.timeout(30000)});
 }
 if(!['https://quillbot.com','https://media.quillbot.com'].includes(u.origin))throw Error('Unapproved provider');
 const headers={};for(const [k,v] of new Headers(init.headers))if(['accept','accept-language','content-type','platform-type','qb-product','qb-dialect','webapp-version'].includes(k))headers[k]=v;
 const body=init.body?Buffer.from(init.body).toString('base64'):undefined;
 return fetch('http://127.0.0.1:6102/request',{method:'POST',headers:{authorization:'Bearer '+process.env.QUILLBOT_BROWSER_RELAY_KEY,'content-type':'application/json'},body:JSON.stringify({path:(u.hostname==='media.quillbot.com'?'/__host/media.quillbot.com':'')+u.pathname+u.search,method:init.method||'GET',headers,bodyBase64:body}),signal:AbortSignal.timeout(60000)});
}

export async function syncBrowserSession(state,version){
 const r=await fetch('http://127.0.0.1:6102/session',{method:'POST',headers:{authorization:'Bearer '+process.env.QUILLBOT_BROWSER_RELAY_KEY,'content-type':'application/json'},body:JSON.stringify({cookie:state.cookie,firebaseAuth:typeof state.firebase_auth==='string'?state.firebase_auth:undefined,version}),signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw Error('Could not apply the saved QuillBot cookies. Retry after active requests finish.');
 shellCache=null;
}
