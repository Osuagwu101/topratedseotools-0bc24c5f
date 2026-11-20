import http from 'node:http';
import fs from 'node:fs';
import {SessionRenewalMonitor,tokenExpiry} from './session-renewal.mjs';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const ORIGIN = 'https://quillbot.com';
const BINDING = 'trstRelayData';
export function tokenSubject(token){try{const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString());return typeof claims.sub==='string'?claims.sub:typeof claims.user_id==='string'?claims.user_id:null;}catch{return null;}}
export const NUDGE_INTERVAL_MS=10*60*1000;
export function parseFirebaseAuth(raw){
  let rec;try{rec=typeof raw==="string"?JSON.parse(raw):raw;}catch{throw Error("Invalid sign-in record");}
  if(!rec||typeof rec!=="object"||typeof rec.key!=="string"||!/^firebase:authUser:[A-Za-z0-9_-]{10,80}:\[DEFAULT\]$/.test(rec.key))throw Error("Invalid sign-in record");
  const value=typeof rec.value==="string"?JSON.parse(rec.value):rec.value;
  if(typeof value?.stsTokenManager?.refreshToken!=="string")throw Error("Sign-in record has no refresh token");
  return {store:rec.store==="localStorage"?"localStorage":"indexedDB",key:rec.key,value};
}
export function firebaseSeedScript(record,overwrite){
  return `(async(rec,overwrite)=>{
    if(rec.store==="localStorage"){if(!overwrite&&localStorage.getItem(rec.key))return "present";localStorage.setItem(rec.key,JSON.stringify(rec.value));return "ok";}
    const open=v=>new Promise((res,rej)=>{const r=v?indexedDB.open("firebaseLocalStorageDb",v):indexedDB.open("firebaseLocalStorageDb");r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains("firebaseLocalStorage"))r.result.createObjectStore("firebaseLocalStorage",{keyPath:"fbase_key"});};r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});
    let db=await open();
    if(!db.objectStoreNames.contains("firebaseLocalStorage")){const v=db.version+1;db.close();db=await open(v);}
    const done=await new Promise((res,rej)=>{const tx=db.transaction("firebaseLocalStorage","readwrite");const st=tx.objectStore("firebaseLocalStorage");const g=st.get(rec.key);g.onsuccess=()=>{if(g.result&&!overwrite){res("present");return;}st.put({fbase_key:rec.key,value:rec.value});tx.oncomplete=()=>res("ok");};tx.onerror=()=>rej(tx.error);});
    db.close();return done;
  })(${JSON.stringify(record)},${overwrite?'true':'false'})`;
}
export function sameTokenAccount(nativeToken,importedToken){if(!importedToken)return true;if(nativeToken===importedToken)return true;const subject=tokenSubject(nativeToken);return !!subject&&subject===tokenSubject(importedToken);}

const passHeaders = new Set(["platform-type","qb-product","qb-dialect","webapp-version",'accept','accept-language','content-type','range','if-none-match','if-modified-since','anthropic-client-sha','anthropic-client-version','anthropic-client-platform']);
export function validateRelayRequest(input) {
  if (!input || typeof input.path !== 'string' || input.path.length > 8192 || !input.path.startsWith('/') || input.path.startsWith('//')) throw Error('path');
  const decoded = decodeURIComponent(input.path.split('?')[0]);
  if (/[\\\x00-\x1f]/.test(decoded) || decoded.startsWith('//') || decoded.split('/').some(p=>p==='.'||p==='..')) throw Error('path');
  const mapped=input.path.startsWith('/__host/media.quillbot.com/')?new URL(input.path.slice('/__host/media.quillbot.com'.length),'https://media.quillbot.com'):new URL(input.path,ORIGIN);
  const url = mapped;
  if (!['https://quillbot.com','https://media.quillbot.com'].includes(url.origin) || url.username || url.password || url.hash) throw Error('origin');
  const method=String(input.method??'GET').toUpperCase();
  const read = /^\/(?:$|paraphrasing-tool$|ssrprops$|api\/pageq\/apps\/QBWebapp\/client-contents$|api\/payments\/get-pricing$|api\/utils\/get-ui-config$|worker\/abtest-experiments-info$|locales\/|rebrand\/|_next\/|assets\/|images\/|favicon)/.test(url.pathname);
  const post = /^\/api\/(?:auth\/(?:token|get-account-details|issue-token)|utils\/(?:detect-language|topic-classifier|sentence-spiltter)|paraphraser\/(?:single-paraphrase\/[0-9]+|single-flip|chunker|paraphrase-thesaurus))$/.test(url.pathname);
  if(url.origin==='https://media.quillbot.com' && url.pathname!=='/api/auth/token')throw Error('route');
  if(url.pathname==='/ssrprops' && url.searchParams.get('lib')!=='@quillbot/paraphraser-page')throw Error('route');
  if (!(read && ['GET','HEAD'].includes(method)) && !(post && method==='POST')) throw Error('route');
  const headers={};
  for (const [name,value] of Object.entries(input.headers??{})) {
    if(passHeaders.has(name.toLowerCase()) && typeof value==='string' && value.length<16384 && !/[\r\n]/.test(value)) headers[name.toLowerCase()]=value;
  }
  const body=typeof input.body==='string'?input.body:undefined;
  const bodyBase64=typeof input.bodyBase64==='string'?input.bodyBase64:undefined;
  if(body && bodyBase64)throw Error('body');
  if(body && Buffer.byteLength(body)>25*1024*1024)throw Error('body');
  if(bodyBase64 && (!/^[A-Za-z0-9+/]*={0,2}$/.test(bodyBase64) || bodyBase64.length%4 || Buffer.byteLength(bodyBase64,'base64')>25*1024*1024))throw Error('body');
  if((body||bodyBase64) && ['GET','HEAD'].includes(method))throw Error('body');
  if(url.pathname.startsWith('/claudeai-rpc/') && (method!=='POST' || !/^\/claudeai-rpc\/anthropic\.bard\.api\.v1alpha\.ConversationService\/(GetNewConversationDefaults|StreamTimeline|PerformAction)$/.test(url.pathname)))throw Error('route');
  return {url:url.href,method,headers,body,bodyBase64};
}

export class BrowserConnection {
  constructor({bindingPath=null}={}){this.bindingPath=bindingPath;this.assignedSubject=null;this.importedExpiresAt=null;try{const saved=JSON.parse(fs.readFileSync(bindingPath,'utf8'));this.assignedSubject=typeof saved.subject==='string'?saved.subject:null;this.importedExpiresAt=Number.isFinite(saved.importedExpiresAt)?saved.importedExpiresAt:null;}catch{}}
  async renewalStatus(){await this.ready();const token=await this.browserToken();return {source:this.lastTokenSource,matchesAssignedAccount:!!this.assignedSubject&&tokenSubject(token)===this.assignedSubject,expiresAt:tokenExpiry(token),importedExpiresAt:this.importedExpiresAt};}

  appliedSession=null; importedToken=null; importedSecrets=[]; sessionFlight=null;
  async applySession(input){
    if(this.sessionFlight){await this.sessionFlight;return this.applySession(input);}
    const flight=this.applySessionOnce(input);this.sessionFlight=flight;
    try{return await flight;}finally{if(this.sessionFlight===flight)this.sessionFlight=null;}
  }
  async applySessionOnce(input){
    if(!input || typeof input.version!=="string" || typeof input.cookie!=="string" || input.cookie.length>32000)throw Error("Invalid session");
    if(input.firebaseAuth!==undefined)this.importedFirebase=parseFirebaseAuth(input.firebaseAuth);
    const entry=input.cookie.split(";").map(v=>v.trim()).find(v=>v.startsWith("useridtoken="));
    this.importedSecrets=input.cookie.split(";").map(part=>part.slice(part.indexOf("=")+1)).filter(v=>v.length>=12);
    this.importedToken=entry?decodeURIComponent(entry.slice("useridtoken=".length)):null;
    this.assignedSubject=tokenSubject(this.importedToken);this.importedExpiresAt=tokenExpiry(this.importedToken);
    if(this.bindingPath)fs.writeFileSync(this.bindingPath,JSON.stringify({subject:this.assignedSubject,importedExpiresAt:this.importedExpiresAt}),{mode:0o600});
    if(this.appliedSession===input.version)return;
    await this.ready();
    if(this.jobs.size)throw Error("Workspace busy; retry connection");
    const cookies=input.cookie.split(";").map(p=>{const i=p.indexOf("=");return {name:p.slice(0,i).trim(),value:p.slice(i+1),domain:".quillbot.com",path:"/",secure:true,expires:Math.floor(Date.now()/1000)+30*86400};}).filter(c=>c.name && !["cf_clearance","__cf_bm","_cfuvid"].includes(c.name));
    if(!cookies.some(c=>c.name==="useridtoken"))throw Error("Missing useridtoken");
    const previous=await this.call("Network.getCookies",{urls:[ORIGIN]});
    for(const c of previous.cookies||[])if(!["cf_clearance","__cf_bm","_cfuvid"].includes(c.name))await this.call("Network.deleteCookies",{name:c.name,domain:c.domain,path:c.path});
    await this.call("Storage.clearDataForOrigin",{origin:ORIGIN,storageTypes:"cache_storage,service_workers"});
    await this.call("Network.setCookies",{cookies});
    if(this.importedFirebase)await this.seedFirebase(this.importedFirebase,true);
    await this.call("Page.reload",{ignoreCache:true});this.lastNudge=Date.now();
    this.reset();this.appliedSession=input.version;
  }
  importedFirebase=null; lastNudge=0;
  /* Write QuillBot's Firebase sign-in record into the page's own storage so its auth code can renew useridtoken. */
  async seedFirebase(record,overwrite){
    const r=await this.call("Runtime.evaluate",{expression:firebaseSeedScript(record,overwrite),awaitPromise:true,returnByValue:true});
    if(r?.result?.value!=="ok"&&r?.result?.value!=="present")throw Error("Could not store QuillBot sign-in");
    return r.result.value;
  }
  /* If the token is stale, make sure the sign-in record is still stored and reload so QuillBot renews it. */
  async nudgeRenewal(now=Date.now()){
    if(!this.importedFirebase||this.jobs.size||now-this.lastNudge<NUDGE_INTERVAL_MS)return false;
    this.lastNudge=now;
    await this.ready();
    await this.seedFirebase(this.importedFirebase,false);
    await this.call("Page.reload",{ignoreCache:false});
    this.reset();
    return true;
  }
  pending=new Map(); jobs=new Map(); activeBodyBytes=0; nextId=0; context=null; connecting=null;
  async ready() {
    if(this.context && this.socket?.readyState===WebSocket.OPEN) return;
    if(this.connecting) return this.connecting;
    this.connecting=this.connect();
    try {await this.connecting;} finally {this.connecting=null;}
  }
  async connect() {
    const targets=await fetch('http://127.0.0.1:9226/json/list',{signal:AbortSignal.timeout(5000)}).then(r=>r.json());
    const target=targets.find(t=>t.type==='page' && new URL(t.url).origin===ORIGIN);
    if(!target) throw Error('Sign in to the dedicated QuillBot browser.');
    if(this.socket) this.socket.close();
    const socket=new WebSocket(target.webSocketDebuggerUrl);
    this.socket=socket;
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('browser connection timeout')),5000);
      this.socket.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});
      this.socket.addEventListener('error',()=>{clearTimeout(timer);reject(Error('browser connection failed'));},{once:true});
    });
    this.socket.addEventListener('message',event=>this.message(JSON.parse(String(event.data))));
    this.socket.addEventListener('close',()=>{if(this.socket===socket)this.reset();});
    await this.call('Page.enable');
    await this.call('Runtime.enable');
    const tree=await this.call('Page.getFrameTree');
    if(new URL(tree.frameTree.frame.url).origin!==ORIGIN) throw Error('browser origin');
    const world=await this.call('Page.createIsolatedWorld',{frameId:tree.frameTree.frame.id,worldName:'TopRated internal transport '+randomBytes(4).toString('hex')});
    this.context=world.executionContextId;
    await this.call('Runtime.addBinding',{name:BINDING,executionContextId:this.context});
    await this.call('Runtime.evaluate',{contextId:this.context,expression:`globalThis.trstRelayControllers=new Map();globalThis.trstRelayAcks=new Map();globalThis.trstRelayAck=(id,n)=>{const key=id+':'+n;const fn=trstRelayAcks.get(key);if(fn){trstRelayAcks.delete(key);fn();}};`});
  }
  reset() {
    this.context=null;
    for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(Error('browser disconnected'));}
    this.pending.clear();
    for(const job of this.jobs.values())job.fail();
    this.jobs.clear();
  }
  call(method,params={}) {
    const id=++this.nextId;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('browser command timeout'));},10000);
      this.pending.set(id,{resolve,reject,timer});
      this.socket.send(JSON.stringify({id,method,params}));
    });
  }
  message(message) {
    if(message.id) {
      const p=this.pending.get(message.id);if(!p)return;
      clearTimeout(p.timer);this.pending.delete(message.id);
      return message.error?p.reject(Error('browser command failed')):p.resolve(message.result);
    }
    if(message.method==='Runtime.executionContextDestroyed' && message.params.executionContextId===this.context) return this.reset();
    if(message.method==='Runtime.executionContextsCleared' && this.context)return this.reset();
    if(message.method!=='Runtime.bindingCalled' || message.params.name!==BINDING || message.params.executionContextId!==this.context)return;
    let event;try{event=JSON.parse(message.params.payload);}catch{return;}
    const job=this.jobs.get(event.id);if(job)job.event(event);
  }
  async browserToken() {
    let refreshed;
    try { refreshed=await this.call('Runtime.evaluate',{expression:`(async()=>{const entry=typeof System==='undefined'?null:[...System.entries()].find(([u,m])=>u.includes('/core/')&&u.endsWith('/browser.js')&&typeof m.getRefreshToken==='function');try{if(entry){const token=await Promise.race([entry[1].getRefreshToken(false),new Promise(resolve=>setTimeout(()=>resolve(null),3000))]);if(token)return token;}}catch{}const c=document.cookie.split(';').map(v=>v.trim()).find(v=>v.startsWith('useridtoken='));if(!c)throw Error('Missing token');return decodeURIComponent(c.slice('useridtoken='.length));})()`,awaitPromise:true,returnByValue:true}); } catch { /* The imported token still needs upstream verification. */ }
    const nativeToken=refreshed?.result?.value;
    const usableNative=typeof nativeToken==='string'&&nativeToken.length>=100&&sameTokenAccount(nativeToken,this.importedToken)&&(!this.assignedSubject||tokenSubject(nativeToken)===this.assignedSubject);
    this.lastTokenSource=usableNative?'native':'imported';
    const token=usableNative?nativeToken:this.importedToken;
    if(typeof token!=='string'||token.length<100)throw Error('QuillBot session expired');
    return token;
  }
  async relay(input,req,res) {
    await this.ready();
    input.browserToken=await this.browserToken();
    input.redactionSecrets=this.importedSecrets;
    const bodyBytes=input.bodyBase64?Buffer.byteLength(input.bodyBase64,'base64'):Buffer.byteLength(input.body??'');
    if(this.jobs.size>=16 || this.activeBodyBytes+bodyBytes>64*1024*1024) {res.writeHead(429);res.end('Browser is busy. Try again shortly.');return;}
    this.activeBodyBytes+=bodyBytes;
    const id=randomBytes(16).toString('hex');let bytes=0;
    const finish=()=>{if(!this.jobs.has(id))return;clearTimeout(timer);this.jobs.delete(id);this.activeBodyBytes-=bodyBytes;};
    const fail=()=>{finish();if(!res.headersSent)res.writeHead(503,{'Content-Type':'text/plain','Cache-Control':'no-store'});res.end('QuillBot browser request did not complete.');};
    const timer=setTimeout(fail,600000);
    this.jobs.set(id,{fail,event:event=>{
      if(event.kind==='meta') {
        if(!Number.isInteger(event.status)||event.status<200||event.status>599)return fail();
        const headers={'Cache-Control':'no-store','X-TRST-Browser-Path':event.path};
        for(const [name,value] of Object.entries(event.headers??{})) if(['content-type','etag','last-modified','cf-mitigated','content-range','accept-ranges','connect-content-encoding','connect-accept-encoding','connect-protocol-version','grpc-status','grpc-message'].includes(name.toLowerCase())) headers[name]=value;
        res.writeHead(event.status,headers);
      } else if(event.kind==='chunk') {
        const data=Buffer.from(event.data,'base64');bytes+=data.length;
        if(bytes>64*1024*1024)return fail();
        const ack=()=>this.call('Runtime.evaluate',{contextId:this.context,expression:`trstRelayAck(${JSON.stringify(id)},${event.seq})`}).catch(fail);
        if(res.write(data))ack();else res.once('drain',ack);
      } else if(event.kind==='end'){finish();res.end();}
      else if(event.kind==='error')fail();
    }});
    res.on('close',()=>{
      if(!this.jobs.has(id))return;finish();
      this.call('Runtime.evaluate',{contextId:this.context,expression:`trstRelayControllers.get(${JSON.stringify(id)})?.abort()`}).catch(()=>{});
    });
    const expression=`(async(input,id)=>{
      const send=(event)=>${BINDING}(JSON.stringify({id,...event}));
      const controller=new AbortController();trstRelayControllers.set(id,controller);
      try {
        const cookies=Object.fromEntries(document.cookie.split(';').map(p=>{const i=p.indexOf('=');return [p.slice(0,i).trim(),p.slice(i+1)]}));
        if(!input.browserToken)throw Error('session');
        input.headers.useridtoken=input.browserToken;
        const token=input.headers.useridtoken;
        let claims={};try{claims=JSON.parse(atob(token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')))}catch{}
        const requestPath=new URL(input.url).pathname;
        if(requestPath==='/api/auth/get-account-details'){
          if(!claims.sub||!claims.email)throw Error('session');
          input.bodyBase64=undefined;input.body=JSON.stringify({uid:claims.user_id||claims.sub,email:claims.email,isSubscribedToEmail:true,lang:'en-US'});
        }
        if(requestPath==='/api/auth/issue-token'){
          const data=JSON.parse(input.bodyBase64?atob(input.bodyBase64):input.body||'{}');
          if(typeof data.scope!=='string'||data.scope.length>32)throw Error('scope');
          input.bodyBase64=undefined;input.body=JSON.stringify({token,scope:data.scope});
        }

        const response=await fetch(input.url,{method:input.method,headers:input.headers,body:input.bodyBase64?Uint8Array.from(atob(input.bodyBase64),v=>v.charCodeAt(0)):input.body,credentials:'include',redirect:'follow',cache:'no-store',signal:controller.signal});
        const final=new URL(response.url);if(!['https://quillbot.com','https://media.quillbot.com'].includes(final.origin)||false&&final.origin!==${JSON.stringify(ORIGIN)}||/^\\/(login|logout)(\\/|$)/.test(final.pathname))throw Error('session');
        send({kind:'meta',status:response.status,path:final.pathname,headers:Object.fromEntries(response.headers)});
        const contentType=response.headers.get('content-type')||'';
        if(/json|html/.test(contentType)){
          let text=await response.text();
          const secrets=[...Object.values(cookies),...(input.redactionSecrets||[])].filter(v=>v.length>=12);
          secrets.push(decodeURIComponent(cookies.useridtoken||""),token);
          for(const secret of [...new Set(secrets)].filter(value=>typeof value==='string' && value.length>=12).sort((a,b)=>b.length-a.length)){
            for(const value of [secret,encodeURIComponent(secret)])text=text.split(value).join('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0b3ByYXRlZC13cml0ZXIiLCJ1c2VyX2lkIjoidG9wcmF0ZWQtd3JpdGVyIiwiZW1haWwiOiJ3cml0ZXJAdG9wcmF0ZWRzZW90b29scy5jb20iLCJlbWFpbF92ZXJpZmllZCI6dHJ1ZSwiaWF0IjoxNzAwMDAwMDAwLCJleHAiOjQxMDI0NDQ4MDB9.dHJzdC1kaXNwbGF5LW9ubHktbm90LXByb3ZpZGVyLWF1dGg');
          }
          text=text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}/gi,'writer@topratedseotools.com');
          try{text=JSON.stringify(JSON.parse(text),(k,v)=>/^(?:useridtoken|access_?token|refresh_?token|id_?token|authorization|session_?token|password)$/i.test(k)?'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0b3ByYXRlZC13cml0ZXIiLCJ1c2VyX2lkIjoidG9wcmF0ZWQtd3JpdGVyIiwiZW1haWwiOiJ3cml0ZXJAdG9wcmF0ZWRzZW90b29scy5jb20iLCJlbWFpbF92ZXJpZmllZCI6dHJ1ZSwiaWF0IjoxNzAwMDAwMDAwLCJleHAiOjQxMDI0NDQ4MDB9.dHJzdC1kaXNwbGF5LW9ubHktbm90LXByb3ZpZGVyLWF1dGg':v);}catch{}
          const bytes=new TextEncoder().encode(text);let raw='';for(let i=0;i<bytes.length;i++)raw+=String.fromCharCode(bytes[i]);
          send({kind:'chunk',seq:0,data:btoa(raw)});send({kind:'end'});return;
        }
        if(response.body){const reader=response.body.getReader();let seq=0;while(true){const {done,value}=await reader.read();if(done)break;let raw='';for(let i=0;i<value.length;i++)raw+=String.fromCharCode(value[i]);const n=seq++;await new Promise(resolve=>{trstRelayAcks.set(id+':'+n,resolve);send({kind:'chunk',seq:n,data:btoa(raw)});});}}
        send({kind:'end'});
      }catch{send({kind:'error'});}finally{trstRelayControllers.delete(id);}
    })(${JSON.stringify(input)},${JSON.stringify(id)});void 0`;
    try {
      const result=await this.call('Runtime.evaluate',{contextId:this.context,expression,returnByValue:true});
      if(result.exceptionDetails)fail();
    }catch{fail();}
  }
}

export function startRelay({port=6102,browserConnection=null}={}) {
  const secret=process.env.QUILLBOT_BROWSER_RELAY_KEY;
  if(!secret || secret.length<32)throw Error('Missing relay key');
  const browser=browserConnection||new BrowserConnection({bindingPath:process.env.QUILLBOT_SESSION_BINDING_PATH||'/var/lib/trst-quillbot-browser/session-binding.json'});
  const monitor=new SessionRenewalMonitor(()=>browser.renewalStatus(),{onChange:state=>{console.log(JSON.stringify({layer:'quillbot_session_health',...state}));if(state.status!=='healthy')browser.nudgeRenewal().then(n=>{if(n)console.log(JSON.stringify({layer:'quillbot_session_health',action:'renewal_nudge'}));}).catch(()=>{});}});
  const renewalTimer=setInterval(()=>void monitor.tick(),300000);renewalTimer.unref();
  void monitor.tick();
  return http.createServer(async(req,res)=>{
    if(req.url==='/health' && req.method==='GET'){res.writeHead(200,{'Content-Type':'application/json'});res.end('{"ok":true}');return;}
    const incoming=Buffer.from(String(req.headers.authorization??''));const expected=Buffer.from('Bearer '+secret);
    if(incoming.length!==expected.length || !timingSafeEqual(incoming,expected)){res.writeHead(401);res.end();return;}
    if(req.url==='/status'&&req.method==='GET'){res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(monitor.state));return;}
    if(req.url==='/renew'&&req.method==='POST'){const state=await monitor.tick();res.writeHead(state.status==='healthy'?200:503,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(state));return;}
    if(!['/request','/session'].includes(req.url) || req.method!=='POST'){res.writeHead(404);res.end();return;}
    let input;
    try {
      const chunks=[];let size=0;
      for await(const chunk of req){size+=chunk.length;if(size>36*1024*1024)throw Error('size');chunks.push(chunk);}
      const parsed=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if(req.url==='/session'){await browser.applySession(parsed);res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end('{"ok":true}');return;}
      input=validateRelayRequest(parsed);
    }catch{res.writeHead(400);res.end('Invalid browser transport request.');return;}
    try{await browser.relay(input,req,res);}
    catch{if(!res.headersSent)res.writeHead(503,{'Content-Type':'text/plain','Cache-Control':'no-store'});res.end('QuillBot browser transport is unavailable.');}
  }).listen(port,'127.0.0.1').on('close',()=>clearInterval(renewalTimer));
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)startRelay();
