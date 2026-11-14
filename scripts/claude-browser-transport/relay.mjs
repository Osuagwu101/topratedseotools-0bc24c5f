import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const ORIGIN = 'https://claude.ai';
const BINDING = 'trstRelayData';
const passHeaders = new Set(["anthropic-client-build", "x-organization-uuid", "connect-accept-encoding", "connect-content-encoding", "connect-protocol-version", "connect-timeout-ms",'accept','accept-language','content-type','range','if-none-match','if-modified-since','anthropic-client-sha','anthropic-client-version','anthropic-client-platform']);
export function validateRelayRequest(input) {
  if (!input || typeof input.path !== 'string' || input.path.length > 8192 || !input.path.startsWith('/') || input.path.startsWith('//')) throw Error('path');
  const decoded = decodeURIComponent(input.path.split('?')[0]);
  if (/[\\\x00-\x1f]/.test(decoded) || decoded.startsWith('//') || decoded.split('/').some(p=>p==='.'||p==='..')) throw Error('path');
  const url = new URL(input.path,ORIGIN);
  if (url.origin !== ORIGIN || url.username || url.password || url.hash) throw Error('origin');
  if (/^\/(?:cdn-cgi|login|logout|settings|__host|__browser)(?:\/|$)/.test(url.pathname) || /^\/(?:api|edge-api)\/(?:auth|logout|session)(?:\/|$)/.test(url.pathname)) throw Error('route');
  const method=String(input.method??'GET').toUpperCase();
  if (!['GET','HEAD','POST','PUT'].includes(method)) throw Error('method');
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

class BrowserConnection {
  pending=new Map(); jobs=new Map(); activeBodyBytes=0; nextId=0; context=null; connecting=null;
  async ready() {
    if(this.context && this.socket?.readyState===WebSocket.OPEN) return;
    if(this.connecting) return this.connecting;
    this.connecting=this.connect();
    try {await this.connecting;} finally {this.connecting=null;}
  }
  async connect() {
    const targets=await fetch('http://127.0.0.1:9225/json/list',{signal:AbortSignal.timeout(5000)}).then(r=>r.json());
    const target=targets.find(t=>t.type==='page' && new URL(t.url).origin===ORIGIN);
    if(!target) throw Error('Sign in to the dedicated Claude browser.');
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
  async relay(input,req,res) {
    await this.ready();
    const bodyBytes=input.bodyBase64?Buffer.byteLength(input.bodyBase64,'base64'):Buffer.byteLength(input.body??'');
    if(this.jobs.size>=16 || this.activeBodyBytes+bodyBytes>64*1024*1024) {res.writeHead(429);res.end('Browser is busy. Try again shortly.');return;}
    this.activeBodyBytes+=bodyBytes;
    const id=randomBytes(16).toString('hex');let bytes=0;
    const finish=()=>{if(!this.jobs.has(id))return;clearTimeout(timer);this.jobs.delete(id);this.activeBodyBytes-=bodyBytes;};
    const fail=()=>{finish();if(!res.headersSent)res.writeHead(503,{'Content-Type':'text/plain','Cache-Control':'no-store'});res.end('Claude browser request did not complete.');};
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
        const response=await fetch(input.url,{method:input.method,headers:input.headers,body:input.bodyBase64?Uint8Array.from(atob(input.bodyBase64),v=>v.charCodeAt(0)):input.body,credentials:'include',redirect:'follow',cache:'no-store',signal:controller.signal});
        const final=new URL(response.url);if(final.origin!==${JSON.stringify(ORIGIN)}||/^\\/(login|logout)(\\/|$)/.test(final.pathname))throw Error('session');
        send({kind:'meta',status:response.status,path:final.pathname,headers:Object.fromEntries(response.headers)});
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

export function startRelay({port=6101}={}) {
  const secret=process.env.CLAUDE_BROWSER_RELAY_KEY;
  if(!secret || secret.length<32)throw Error('Missing relay key');
  const browser=new BrowserConnection();
  return http.createServer(async(req,res)=>{
    if(req.url==='/health' && req.method==='GET'){res.writeHead(200,{'Content-Type':'application/json'});res.end('{"ok":true}');return;}
    const incoming=Buffer.from(String(req.headers.authorization??''));const expected=Buffer.from('Bearer '+secret);
    if(incoming.length!==expected.length || !timingSafeEqual(incoming,expected)){res.writeHead(401);res.end();return;}
    if(req.url!=='/request' || req.method!=='POST'){res.writeHead(404);res.end();return;}
    let input;
    try {
      const chunks=[];let size=0;
      for await(const chunk of req){size+=chunk.length;if(size>36*1024*1024)throw Error('size');chunks.push(chunk);}
      input=validateRelayRequest(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    }catch{res.writeHead(400);res.end('Invalid browser transport request.');return;}
    try{await browser.relay(input,req,res);}
    catch{if(!res.headersSent)res.writeHead(503,{'Content-Type':'text/plain','Cache-Control':'no-store'});res.end('Claude browser transport is unavailable.');}
  }).listen(port,'127.0.0.1');
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)startRelay();
