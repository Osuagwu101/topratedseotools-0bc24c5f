import {createHash} from 'node:crypto';
import {adaptClient,CLIENT_AUTH_PATH} from '../browser-transport/client-auth-adapter.mjs';
import {bootstrapPrelude} from '../browser-transport/writer-bootstrap.mjs';
import {browserFetch} from '../browser-transport/browser-fetch.mjs';
import {WriterStore} from '../browser-transport/writer-store.mjs';
import http from "node:http";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { createClient } from "@supabase/supabase-js";
import { createQuillBotLaunchService, parseQuillBotCookies, QUILLBOT_APP_DEVICE_COOKIE, QuillBotAccessError, quillBotSessionCookies } from "../src/lib/quillbot-launch.server.ts";
import { quillBotRepository } from "../src/lib/quillbot-repository.server.ts";
import { decryptQuillBotSession, encryptQuillBotSession, normaliseQuillBotSession, quillBotSessionExpiry } from "../src/lib/quillbot-session.server.ts";
import { proxyQuillBotRequest, quillBotResponseHeaders } from "../src/lib/quillbot-proxy.server.ts";
import { quillBotProxyBootstrapResponse } from "../src/lib/quillbot-proxy-bootstrap.server.ts";
import fs from "node:fs";
loadEnvFile(fileURLToPath(new URL("./.env", import.meta.url)));
const BASE = "/__qbtest";
const PUBLIC = process.env.QUILLBOT_BROWSER_PUBLIC || "https://quillbot.topratedseotools.com:4174";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!key || !process.env.SUPABASE_URL) throw new Error("QuillBot server configuration missing.");
const db = createClient(process.env.SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input, init = {}) => {
  const headers = new Headers(init.headers); headers.set("apikey", key);
  if (key.startsWith("sb_secret_") && headers.get("authorization") === "Bearer " + key) headers.delete("authorization");
  return fetch(input, { ...init, headers, signal: init.signal || AbortSignal.timeout(15000) });
} } });
const repository=quillBotRepository(db);
let enabledCache=null;
repository.enabled=async()=>{
 if(process.env.QUILLBOT_TEST_ENABLED!=='1')return false;
 if(enabledCache&&enabledCache.until>Date.now())return enabledCache.value;
 const result=await db.from('tool_settings').select('enabled,one_click_auth_enabled').eq('tool_slug','quillbot').maybeSingle();
 if(result.error)throw Error('QuillBot access settings unavailable');
 enabledCache={value:result.data?.enabled===true&&result.data?.one_click_auth_enabled===true,until:Date.now()+1000};
 return enabledCache.value;
};
repository.providerReady=async account=>account==='account_1'&&(await assignedAccount()).premium;
const launch = createQuillBotLaunchService(repository);
const writerStore=new WriterStore(fileURLToPath(new URL('../.secrets/quillbot-writers.sqlite',import.meta.url)));


let adaptedClient=null,adaptedFlight=null;
async function currentClient(){
 if(adaptedClient&&adaptedClient.until>Date.now())return adaptedClient.text;
 if(adaptedFlight)return adaptedFlight;
 adaptedFlight=(async()=>{const response=await browserFetch('https://libs.quillbot.com'+CLIENT_AUTH_PATH,{method:'GET'});if(!response.ok)throw new QuillBotAccessError('QuillBot is updating. Please contact Admin.',503);const text=adaptClient(await response.text());adaptedClient={text,until:Date.now()+300000};return text;})();
 try{return await adaptedFlight;}catch{throw new QuillBotAccessError('QuillBot is updating. Please contact Admin.',503);}finally{adaptedFlight=null;}
}
const CLIENT_TOKEN='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0b3ByYXRlZC13cml0ZXIiLCJ1c2VyX2lkIjoidG9wcmF0ZWQtd3JpdGVyIiwiZW1haWwiOiJ3cml0ZXJAdG9wcmF0ZWRzZW90b29scy5jb20iLCJlbWFpbF92ZXJpZmllZCI6dHJ1ZSwiaWF0IjoxNzAwMDAwMDAwLCJleHAiOjQxMDI0NDQ4MDB9.dHJzdC1kaXNwbGF5LW9ubHktbm90LXByb3ZpZGVyLWF1dGg';
let accountCached=null,accountFlight=null;
async function assignedAccount(){
 if(accountCached&&accountCached.until>Date.now())return accountCached;
 if(accountFlight)return accountFlight;
 accountFlight=(async()=>{
 const res=await browserFetch('https://quillbot.com/api/auth/get-account-details',{method:'POST',headers:{'content-type':'application/json'},body:Buffer.from('{}')});
 if(!res.ok)throw new QuillBotAccessError('Admin must refresh the QuillBot session.',503);
 const payload=await res.json();const profile=payload.data?.profile;
 if(!profile||profile.premium!==true)throw new QuillBotAccessError('Assigned QuillBot Premium session unavailable.',503);
 await currentClient();
 accountCached={authenticated:true,premium:profile.premium,accepted_premium_modes_tnc:profile.accepted_premium_modes_tnc===true,until:Date.now()+3000};
 return accountCached;
 })();
 try{return await accountFlight;}finally{accountFlight=null;}
}
async function loadProvider(account) {
  const { data, error } = await db.from("quillbot_provider_accounts").select("encrypted_payload,status").eq("account_key", account).maybeSingle();
  if (error || data?.status !== "stored" || !data?.encrypted_payload) throw new QuillBotAccessError("Admin must refresh QuillBot.", 503);
  return { envelope: data.encrypted_payload, state: JSON.parse(normaliseQuillBotSession(decryptQuillBotSession(data.encrypted_payload))) };
}
const startPage = fs.readFileSync(fileURLToPath(new URL("./start.html", import.meta.url)), "utf8").replaceAll('QuillBot Plagiarism Checker','QuillBot OneClick').replaceAll('Open Plagiarism Checker','Open QuillBot').replaceAll('to open the official QuillBot plagiarism checker','to open QuillBot').replace('QuillBot opens on its official website. Sign in with your own QuillBot account there; QuillBot manages the monthly word allowance.','Your assigned Premium session opens after access verification.');
const adminPage = fs.readFileSync(fileURLToPath(new URL("./admin-session.html", import.meta.url)), "utf8");
async function handle(request) {
  let url = new URL(request.url);
  if(!(url.pathname===BASE||url.pathname.startsWith(BASE+"/"))){url.pathname=BASE+url.pathname;request=new Request(url,request);}
  if (!(url.pathname === BASE || url.pathname.startsWith(BASE + "/"))) return new Response("Not found", { status: 404, headers: quillBotResponseHeaders() });
  const path = url.pathname.slice(BASE.length);
  if (path === "/__trst/health") return Response.json({ ok: true }, { headers: quillBotResponseHeaders("application/json") });
  if (path === "/__trst/start" && request.method === "GET") return new Response(startPage, { headers: quillBotResponseHeaders("text/html; charset=utf-8") });

  if(path==='/__trst/admin' && request.method==='GET')return new Response(fs.readFileSync(fileURLToPath(new URL('../browser-transport/admin.html',import.meta.url)),'utf8'),{headers:quillBotResponseHeaders('text/html; charset=utf-8')});
  if(['/__trst/admin/limits','/__trst/admin/writers','/__trst/admin/control'].includes(path) && ['GET','POST'].includes(request.method)){
   const bearer=request.headers.get('authorization');
   if(!bearer?.startsWith('Bearer '))return new Response('Admin sign-in required',{status:401});
   const {data,error}=await db.auth.getUser(bearer.slice(7));
   if(error||!data.user)return new Response('Admin sign-in required',{status:401});
   const roles=await Promise.all([db.rpc('is_super_admin',{_user_id:data.user.id}),db.rpc('has_role',{_user_id:data.user.id,_role:'admin'})]);
   if(!roles.some(r=>!r.error&&r.data===true))return new Response('Admin access required',{status:403});

   if(path==='/__trst/admin/writers'&&request.method==='GET'){
    const [grants,orders,controls]=await Promise.all([
      db.from('tool_access_grants').select('user_id,status,expires_at').eq('tool_slug','quillbot').eq('status','active').limit(1000),
      db.from('tool_orders').select('user_id,status,payment_status,expires_at').eq('tool_slug','quillbot').eq('status','approved').eq('payment_status','successful').limit(1000),
      db.from('quillbot_user_controls').select('user_id,status').limit(1000)
    ]);
    if(grants.error||orders.error||controls.error)throw Error('Writer list unavailable');
    const active=[...(grants.data||[]),...(orders.data||[])].filter(v=>!v.expires_at||Date.parse(v.expires_at)>Date.now()),ids=[...new Set(active.map(v=>v.user_id))];
    if(!ids.length)return Response.json({writers:[]},{headers:quillBotResponseHeaders('application/json')});
    const profiles=await db.from('profiles').select('id,email,full_name').in('id',ids);
    if(profiles.error)throw Error('Writer list unavailable');
    const indexed=new Map((controls.data||[]).map(v=>[v.user_id,v.status]));
    return Response.json({writers:(profiles.data||[]).map(p=>({user_id:p.id,email:p.email,full_name:p.full_name,status:indexed.get(p.id)||'active',...writerStore.status(p.id)}))},{headers:quillBotResponseHeaders('application/json')});
   }
   if(path==='/__trst/admin/control'&&request.method==='POST'){
    if(request.headers.get('origin')!==PUBLIC)return new Response('Cross-site update blocked',{status:403});
    const body=await request.json();
    if(!/^[0-9a-f-]{36}$/i.test(body.user_id||'')||!['active','suspended'].includes(body.status))return new Response('Invalid access setting',{status:400});
    const profile=await db.from('profiles').select('id').eq('id',body.user_id).maybeSingle();
    if(profile.error||!profile.data)return new Response('Writer not found',{status:404});
    const updated=await db.from('quillbot_user_controls').upsert({user_id:body.user_id,status:body.status},{onConflict:'user_id'});
    if(updated.error)throw Error('Writer access update unavailable');
    if(body.status==='suspended'){const revoked=await db.from('quillbot_proxy_sessions').update({status:'revoked'}).eq('user_id',body.user_id);if(revoked.error)throw Error('Session revocation unavailable');}
    console.log(JSON.stringify({layer:'quillbot_admin',action:'access',actor:data.user.id,writer:body.user_id,status:body.status}));
    return Response.json({ok:true,status:body.status},{headers:quillBotResponseHeaders('application/json')});
   }
   if(request.method==='POST'){
    if(request.headers.get('origin')!==PUBLIC)return new Response('Cross-site update blocked',{status:403});
    const body=await request.json();
    const profile=await db.from('profiles').select('id').eq('id',body.user_id).maybeSingle();
    if(profile.error||!profile.data)return new Response('Writer not found',{status:404});
    try{writerStore.setLimit(body.user_id,body.daily_limit)}catch{return new Response('Invalid daily limit',{status:400})}
    return Response.json(writerStore.status(body.user_id),{headers:quillBotResponseHeaders('application/json')});
   }
   const user=url.searchParams.get('user_id');
   if(!/^[0-9a-f-]{36}$/i.test(user||''))return new Response('Writer ID required',{status:400});
   return Response.json(writerStore.status(user),{headers:quillBotResponseHeaders('application/json')});
  }
  if (path === "/__trst/admin/session" && request.method === "GET") return new Response(adminPage, { headers: quillBotResponseHeaders("text/html; charset=utf-8") });
  if (path === "/__trst/admin/session" && request.method === "POST") {
    if (request.headers.get("origin") !== PUBLIC) return new Response("Cross-site session update blocked", { status: 403, headers: quillBotResponseHeaders() });
    const bearer = request.headers.get("authorization");
    if (!bearer?.startsWith("Bearer ")) return new Response("Admin sign-in required.", { status: 401, headers: quillBotResponseHeaders() });
    const { data, error } = await db.auth.getUser(bearer.slice(7));
    if (error || !data.user) return new Response("Admin sign-in required.", { status: 401, headers: quillBotResponseHeaders() });
    const [superAdmin, admin] = await Promise.all([db.rpc("is_super_admin", { _user_id: data.user.id }), db.rpc("has_role", { _user_id: data.user.id, _role: "admin" })]);
    if (!(superAdmin.data === true || admin.data === true)) return new Response("Admin access required.", { status: 403, headers: quillBotResponseHeaders() });
    let plaintext;
    try { plaintext = normaliseQuillBotSession(await request.text()); } catch { return new Response("Select the two-field QuillBot session JSON file.", { status: 400, headers: quillBotResponseHeaders() }); }
    if (quillBotSessionExpiry(JSON.parse(plaintext).useridtoken).expired === true) {
      return new Response("This QuillBot token has expired. Export a fresh session from your signed-in QuillBot browser.", { status: 422, headers: quillBotResponseHeaders() });
    }
    const encrypted = encryptQuillBotSession(plaintext);
    const { error: saveError } = await db.from("quillbot_provider_accounts").update({ encrypted_payload: encrypted, status: "stored", updated_at: new Date().toISOString() }).eq("account_key", "account_1");
    if (saveError) throw new Error("QuillBot session update unavailable.");
    return Response.json({ ok: true, account: "account_1" }, { headers: quillBotResponseHeaders("application/json") });
  }
  if (path === "/__trst/app-login") {
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: quillBotResponseHeaders() });
    if (request.headers.get("origin") !== PUBLIC) return new Response("Cross-site login blocked", { status: 403, headers: quillBotResponseHeaders() });
    const { email, password } = await request.json();
    if (typeof email !== "string" || typeof password !== "string" || email.length > 320 || password.length > 2000) return new Response("Invalid login", { status: 400, headers: quillBotResponseHeaders() });
    const authClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await authClient.auth.signInWithPassword({ email, password });
    if (error || !data.session) return new Response("Could not sign in to your Top Rated SEO Tools account.", { status: 401, headers: quillBotResponseHeaders() });
    return Response.json({ access_token: data.session.access_token }, { headers: quillBotResponseHeaders("application/json") });
  }
  if(path==="/__trst/launch"&&request.method==="OPTIONS")return new Response(null,{status:204,headers:quillBotResponseHeaders()});
  if (path === "/__trst/launch") {
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: quillBotResponseHeaders() });
    const origin = request.headers.get("origin");
    if (origin && origin !== PUBLIC && origin !== "https://topratedseotools.com" && origin !== "https://www.topratedseotools.com") return new Response("Cross-site launch blocked", { status: 403, headers: quillBotResponseHeaders() });
    const bearer = request.headers.get("authorization");
    if (!bearer?.startsWith("Bearer ")) return new Response("Sign in to Top Rated SEO Tools.", { status: 401, headers: quillBotResponseHeaders() });
    const { data, error } = await db.auth.getUser(bearer.slice(7));
    if (error || !data.user) return new Response("Sign in to Top Rated SEO Tools.", { status: 401, headers: quillBotResponseHeaders() });
    const created = await launch.create(data.user.id, parseQuillBotCookies(request).get(QUILLBOT_APP_DEVICE_COOKIE)||parseQuillBotCookies(request).get("trst_qb_device"));
    return Response.json({ launch_url: PUBLIC + BASE + "/__trst/enter?ticket=" + encodeURIComponent(created.token), expires_at: created.expiresAt }, { headers: quillBotResponseHeaders("application/json") });
  }
  if (path === "/__trst/enter") {
    if (request.method !== "GET") return new Response("Method not allowed", { status: 405, headers: quillBotResponseHeaders() });
    const exchanged = await launch.exchange(request, url.searchParams.get("ticket") || "");
    const headers = quillBotResponseHeaders(); headers.set("location", "/paraphrasing-tool");
    for(const pair of ["authenticated=true","premium=true","useridtoken=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0b3ByYXRlZC13cml0ZXIiLCJ1c2VyX2lkIjoidG9wcmF0ZWQtd3JpdGVyIiwiZW1haWwiOiJ3cml0ZXJAdG9wcmF0ZWRzZW90b29scy5jb20iLCJlbWFpbF92ZXJpZmllZCI6dHJ1ZSwiaWF0IjoxNzAwMDAwMDAwLCJleHAiOjQxMDI0NDQ4MDB9.dHJzdC1kaXNwbGF5LW9ubHktbm90LXByb3ZpZGVyLWF1dGg"])headers.append("set-cookie",pair+"; Path=/; Secure; SameSite=Lax");
    for (const cookie of quillBotSessionCookies(exchanged.token, exchanged.fingerprint, exchanged.expiresAt,"/")) headers.append("set-cookie", cookie);
    return new Response(null, { status: 302, headers });
  }
  const asset=path.match(/^\/__host\/(libs\.quillbot\.com|assets\.quillbot\.com)(\/.*)$/);
  if(asset){
   if(!['GET','HEAD'].includes(request.method))return new Response('Static assets only',{status:403});
   const res=await browserFetch('https://'+asset[1]+asset[2]+url.search,{method:request.method});
   const headers=quillBotResponseHeaders(res.headers.get('content-type')||'application/octet-stream');
   if(asset[1]==='libs.quillbot.com'&&asset[2]===CLIENT_AUTH_PATH&&request.method==='GET'&&res.ok)return new Response(await currentClient(),{status:200,headers});
   return new Response(request.method==='HEAD'||[204,304].includes(res.status)?null:await res.arrayBuffer(),{status:res.status,headers});
  }
  const session = await launch.require(request);
  if (!session) return new Response("QuillBot test requires an authorised launch.", { status: 401, headers: quillBotResponseHeaders() });


  if(path==='/__trst/history'){
   if(request.method==='GET'){
    if([...url.searchParams.keys()].length)return new Response('History belongs to the signed-in writer.',{status:403,headers:quillBotResponseHeaders()});
    const items=writerStore.history(session.user_id).map(row=>({id:row.id,created_at:row.created,...JSON.parse(decryptQuillBotSession(row.payload))}));
    return Response.json({items},{headers:quillBotResponseHeaders('application/json')});
   }
   if(request.method==='POST'){
    if(request.headers.get('origin')!==PUBLIC)return new Response('Cross-site update blocked',{status:403});
    const body=await request.json();
    if(typeof body.input!=='string'||typeof body.output!=='string'||!body.input.trim()||!body.output.trim()||body.input.length>100000||body.output.length>200000)return new Response('Invalid result',{status:400});
    const payload=JSON.stringify({input:body.input,output:body.output}),fingerprint=createHash('sha256').update(payload).digest('hex');
    writerStore.saveHistory(session.user_id,encryptQuillBotSession(payload),fingerprint);
    return Response.json({ok:true},{headers:quillBotResponseHeaders('application/json')});
   }
   return new Response('Method not allowed',{status:405});
  }
  if(path==='/__trst/auth-state'){
   const account=await assignedAccount();
   const profile=await db.from('profiles').select('full_name,email').eq('id',session.user_id).maybeSingle();
   if(profile.error)throw Error('Writer profile unavailable');
   return Response.json({...account,until:undefined,uid:session.user_id,email:profile.data?.email||'writer@topratedseotools.com',name:profile.data?.full_name||'TopRated Writer',session_expires_at:session.expires_at,client_token:CLIENT_TOKEN},{headers:quillBotResponseHeaders('application/json')});
  }
  if(path==='/__trst/usage')return Response.json(writerStore.status(session.user_id),{headers:quillBotResponseHeaders('application/json')});
  if (path === "/__trst/bootstrap.js") {
   const native=await quillBotProxyBootstrapResponse("").text();
   return new Response(bootstrapPrelude(session.user_id)+native,{headers:quillBotResponseHeaders('application/javascript')});
  }
  if (path.startsWith("/__trst/")) return new Response("Not found", { status: 404, headers: quillBotResponseHeaders() });


  if(path==='/api/__qbtest/__host/media.quillbot.com/api/auth/token'){
    url.pathname=BASE+'/__host/media.quillbot.com/api/auth/token';
    return handle(new Request(url,request));
  }
  const safePath=path.replace('/__host/media.quillbot.com','');
  if(['/api/auth/get-account-details','/api/auth/issue-token'].includes(safePath))return new Response('Provider account details are private.',{status:403,headers:quillBotResponseHeaders()});

  let operation;
  if(request.method==='POST' && safePath==='/api/utils/sentence-spiltter'){
    const input=await request.clone().json();
    if(typeof input.text!=='string'||input.text.length>100000)return new Response('Invalid input',{status:400});
    operation=writerStore.reserve(session.user_id,input.text);
    if(!operation)return new Response(JSON.stringify({message:'Daily limit reached',error:'Daily limit reached'}),{status:429,headers:quillBotResponseHeaders('application/json')});
  }
  if(request.method==='POST' && /^\/api\/paraphraser\/single-paraphrase\/[0-9]+$/.test(safePath)){
    const input=await request.clone().json();
    if(!writerStore.validate(session.user_id,request.headers.get('x-trst-operation'),input.text,safePath))return new Response('Start a new paraphrase.',{status:403,headers:quillBotResponseHeaders()});
  }
  if(request.method==='POST'&&safePath.startsWith('/api/paraphraser/')&&!writerStore.authorize(session.user_id,request.headers.get('x-trst-operation')))return new Response('Start a new paraphrase.',{status:403,headers:quillBotResponseHeaders()});
  if(request.method==='POST'&&safePath.startsWith('/api/paraphraser/')&&!safePath.includes('/single-paraphrase/')){
   const body=await request.clone().json();
   if(!writerStore.helper(session.user_id,request.headers.get('x-trst-operation'),safePath,body))return new Response('This result does not belong to your active paraphrase.',{status:403,headers:quillBotResponseHeaders()});
  }
  let response;
  try{response=await proxyQuillBotRequest(request,{cookie:'authenticated=true; premium=true',useridtoken:'trst-server-auth'},browserFetch);}catch(e){if(operation)writerStore.refund(session.user_id,operation);throw e;}
  if(response.ok&&safePath.startsWith('/api/paraphraser/')){try{writerStore.recordOutput(session.user_id,request.headers.get('x-trst-operation'),await response.clone().json())}catch{}}
  if(operation){if(!response.ok)writerStore.refund(session.user_id,operation);else response.headers.set('x-trst-operation',operation);}
  response.headers.set('content-security-policy',"default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://libs.quillbot.com https://assets.quillbot.com; connect-src 'self' https://libs.quillbot.com https://assets.quillbot.com; style-src 'self' 'unsafe-inline' https://libs.quillbot.com https://assets.quillbot.com https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com https://assets.quillbot.com https://libs.quillbot.com; img-src 'self' data: blob: https://assets.quillbot.com https://libs.quillbot.com; worker-src 'self' blob: https://assets.quillbot.com https://libs.quillbot.com; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
  // Diagnostics contain paths and status only, never tokens, cookies, query or text.
  console.log(JSON.stringify({ layer: "quillbot_upstream", path, status: response.status, rejected: response.headers.get("x-trst-upstream-status") || undefined, verification_challenge: response.headers.get("cf-mitigated") === "challenge", upstream_ray_present: response.headers.has("cf-ray") }));
  return response;
}
const server = http.createServer(async (req, res) => {
  try {
    const chunks = []; let bytes = 0;
    for await (const chunk of req) { bytes += chunk.length; if (bytes > 5 * 1024 * 1024) { res.writeHead(413, Object.fromEntries(quillBotResponseHeaders())); return res.end("Request too large"); } chunks.push(chunk); }
    const init = { method: req.method, headers: req.headers };
    if (!["GET", "HEAD"].includes(req.method)) init.body = Buffer.concat(chunks);
    const response = await handle(new Request(new URL(req.url, PUBLIC), init));
    const headers = Object.fromEntries(response.headers);
    headers['cache-control']='no-store';
    if(['/__qbtest/__trst/launch','/__trst/launch'].includes(new URL(req.url,PUBLIC).pathname)&&['https://topratedseotools.com','https://www.topratedseotools.com',PUBLIC].includes(req.headers.origin)){
     headers['access-control-allow-origin']=req.headers.origin;headers['access-control-allow-credentials']='true';headers['access-control-allow-methods']='POST, OPTIONS';headers['access-control-allow-headers']='authorization, content-type';headers.vary='Origin';
    }
    const cookies = response.headers.getSetCookie();
    if (cookies.length) headers["set-cookie"] = cookies;
    res.writeHead(response.status, headers);
    if (!response.body || req.method === "HEAD") return res.end();
    Readable.fromWeb(response.body).pipe(res);
  } catch (error) {
    const status = error instanceof QuillBotAccessError ? error.status : 503;
    res.writeHead(status, Object.fromEntries(quillBotResponseHeaders()));
    res.end(error instanceof QuillBotAccessError ? error.message : "QuillBot is temporarily unavailable.");
    console.error(JSON.stringify({ layer: "quillbot_gateway", status, category: error?.name || "Error" }));
  }
});
server.listen(Number(process.env.QUILLBOT_BROWSER_PORT||3022), "127.0.0.1", () => console.log("QB_BROWSER_READY",process.env.QUILLBOT_BROWSER_PORT||3022));
