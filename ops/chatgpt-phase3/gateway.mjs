import http from 'node:http';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, open, unlink, chmod } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { Phase4PolicyError, classifyGatewayRequest, assertRequestSize } from '../chatgpt-phase4/transport.mjs';
import { Phase5SessionError, proxyWithSingleChatGptSession } from '../chatgpt-phase5/session-adapter.mjs';
export const ORIGIN = 'https://chatgpt.topratedseotools.com';
const DASHBOARD_ORIGINS = new Set(['https://topratedseotools.com', 'https://www.topratedseotools.com']);
const STATE = process.env.CHATGPT_PHASE3_STATE_DIR || '/home/ubuntu/state/chatgpt-phase3';
const DEVICE = '__Host-trst_cg_device_v3', PROOF = '__Host-trst_cg_launch_v3', SESSION = '__Host-trst_cg_gateway_v3';
const TTL = 60_000;
const hash = v => createHash('sha256').update(v).digest('hex');
const random = () => randomBytes(32).toString('base64url');
const validToken = v => typeof v === 'string' && /^[A-Za-z0-9_-]{43}$/.test(v);
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const safeCodes = new Set(['missing_ticket','invalid_ticket','expired_ticket','reused_ticket','missing_entitlement','device_session_mismatch','missing_chatgpt_session_source','local_gateway_failure','unauthenticated','invalid_origin','tool_disabled','rate_limited','account_unavailable']);
export class GateError extends Error {
  constructor(code, status = 403) { super(code); this.code = safeCodes.has(code) ? code : 'local_gateway_failure'; this.status = status; }
}
const fail = (code, status) => { throw new GateError(code, status); };
const file = (kind, id) => path.join(STATE, kind + '-' + id + '.json');
async function init() { await mkdir(STATE, { recursive: true, mode: 0o700 }); await chmod(STATE, 0o700); }
async function save(kind, id, value, exclusive = false) {
  await init();
  if (exclusive) return writeFile(file(kind, id), JSON.stringify(value), { mode: 0o600, flag: 'wx' });
  const tmp = file(kind, id) + '.' + randomUUID();
  await writeFile(tmp, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
  await rename(tmp, file(kind, id));
}
async function load(kind, id) {
  try { return JSON.parse(await readFile(file(kind, id), 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
async function locked(id, fn) {
  await init(); let lock;
  try { lock = await open(path.join(STATE, 'lock-' + id), 'wx', 0o600); }
  catch (e) { if (e.code === 'EEXIST') fail('reused_ticket'); throw e; }
  try { return await fn(); }
  finally { await lock.close(); await unlink(path.join(STATE, 'lock-' + id)); }
}
function headers(origin) {
  const h = new Headers({
    'Cache-Control': 'no-store, max-age=0', 'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, nofollow, noarchive',
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  });
  if (DASHBOARD_ORIGINS.has(origin)) {
    h.set('Access-Control-Allow-Origin', origin); h.set('Access-Control-Allow-Credentials', 'true');
    h.set('Access-Control-Allow-Headers', 'Authorization, Content-Type'); h.set('Access-Control-Allow-Methods', 'POST, OPTIONS'); h.set('Vary', 'Origin');
  }
  return h;
}
const cookie = (name, value, seconds) => name+'='+value+'; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age='+seconds;
function cookies(req) {
  const out = new Map();
  for (const part of (req.headers.get('cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) {
      const key = part.slice(0, i).trim();
      if (out.has(key)) fail('device_session_mismatch');
      out.set(key, part.slice(i + 1).trim());
    }
  }
  return out;
}
async function api(endpoint, { method = 'GET', body, bearer } = {}) {
  const base = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) fail('local_gateway_failure', 503);
  const h = { apikey: key, 'Content-Type': 'application/json', Prefer: 'return=representation' };
  if (bearer) h.Authorization = 'Bearer ' + bearer;
  else if (!key.startsWith('sb_secret_')) h.Authorization = 'Bearer ' + key;
  let res;
  try { res = await fetch(base + endpoint, { method, headers: h, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10_000) }); }
  catch { fail('local_gateway_failure', 503); }
  if (!res.ok) {
    if (endpoint.startsWith('/auth/v1/user') && [401,403].includes(res.status)) fail('unauthenticated', 401);
    fail('local_gateway_failure', 503);
  }
  if (res.status === 204) return null;
  return res.json();
}
const q = (table, params) => api('/rest/v1/' + table + '?' + new URLSearchParams(params));
const unexpired = x => x == null || (Number.isFinite(Date.parse(x)) && Date.parse(x) > Date.now());
function activeOrder(o) {
  return o.status === 'approved' && o.payment_status === 'successful' && unexpired(o.expires_at) &&
    (o.access_type !== 'private' || o.fulfilment_status === 'active');
}
async function activeAccount(id, accessType) {
  const rows = await q('tool_accounts', {select:'id,tool_slug,access_type,enabled,status,expires_at',id:'eq.'+id,tool_slug:'eq.chatgpt',limit:'1'});
  const a = rows[0];
  if (!a || a.enabled !== true || a.status !== 'working' || a.access_type !== accessType || !unexpired(a.expires_at)) fail('account_unavailable');
  return a;
}
async function enabled() {
  const [s] = await q('tool_settings',{select:'enabled,one_click_auth_enabled',tool_slug:'eq.chatgpt',limit:'1'});
  if (!s || s.enabled !== true || s.one_click_auth_enabled !== true) fail('tool_disabled');
}
async function profileActive(user) {
  const [p] = await q('profiles',{select:'id,account_status',id:'eq.'+user,limit:'1'});
  if (!p || p.account_status === 'suspended') fail('missing_entitlement');
}
async function controls(user) {
  const [c] = await q('chatgpt_user_controls',{select:'status,device_limit',user_id:'eq.'+user,limit:'1'});
  if (c && c.status !== 'active') fail('missing_entitlement');
  return c || {status:'active',device_limit:2};
}
async function findEntitlement(user) {
  await enabled(); await profileActive(user); await controls(user);
  const orders = await q('tool_orders',{select:'id,user_id,tool_slug,expires_at,access_type,fulfilment_status,payment_status,status,pricing_option_id',user_id:'eq.'+user,tool_slug:'eq.chatgpt',status:'eq.approved',order:'created_at.desc',limit:'100'});
  for (const o of orders) {
    if (!activeOrder(o)) continue;
    const [a] = await q('tool_account_assignments',{select:'id,account_id,access_type,user_id,tool_slug,order_id,status',user_id:'eq.'+user,tool_slug:'eq.chatgpt',order_id:'eq.'+o.id,status:'eq.active',limit:'1'});
    if (!a || a.access_type !== (o.access_type || 'shared')) continue;
    try { await activeAccount(a.account_id,a.access_type); }
    catch (e) { if (e.code === 'account_unavailable') continue; throw e; }
    return {kind:'order',id:o.id,user,account:a.account_id,assignment:a.id,accessType:a.access_type,plan:o.pricing_option_id || null};
  }
  const grants = await q('tool_access_grants',{select:'id,user_id,tool_slug,account_id,access_type,expires_at,status',user_id:'eq.'+user,tool_slug:'eq.chatgpt',status:'eq.active',order:'granted_at.desc',limit:'100'});
  for (const g of grants) {
    if (!unexpired(g.expires_at)) continue;
    try { await activeAccount(g.account_id,g.access_type); }
    catch (e) { if (e.code === 'account_unavailable') continue; throw e; }
    return {kind:'grant',id:g.id,user,account:g.account_id,assignment:null,accessType:g.access_type,plan:'grant:'+g.id};
  }
  fail('missing_entitlement');
}
async function recheck(e) {
  await enabled(); await profileActive(e.user); await controls(e.user);
  if (e.kind === 'order') {
    const [o] = await q('tool_orders',{select:'id,expires_at,access_type,fulfilment_status,payment_status,status,pricing_option_id',id:'eq.'+e.id,user_id:'eq.'+e.user,tool_slug:'eq.chatgpt',limit:'1'});
    if (!o || !activeOrder(o) || (o.pricing_option_id || null) !== e.plan || (o.access_type || 'shared') !== e.accessType) fail('missing_entitlement');
    const [a] = await q('tool_account_assignments',{select:'id,account_id,access_type',id:'eq.'+e.assignment,order_id:'eq.'+e.id,user_id:'eq.'+e.user,tool_slug:'eq.chatgpt',status:'eq.active',limit:'1'});
    if (!a || a.account_id !== e.account || a.access_type !== e.accessType) fail('device_session_mismatch');
  } else if (e.kind === 'grant') {
    const [g] = await q('tool_access_grants',{select:'account_id,access_type,expires_at,status',id:'eq.'+e.id,user_id:'eq.'+e.user,tool_slug:'eq.chatgpt',limit:'1'});
    if (!g || g.status !== 'active' || !unexpired(g.expires_at)) fail('missing_entitlement');
    if (g.account_id !== e.account || g.access_type !== e.accessType || e.plan !== 'grant:'+e.id) fail('device_session_mismatch');
  } else fail('invalid_ticket');
  await activeAccount(e.account,e.accessType);
}
async function deviceGate(user, device) {
  const control = await controls(user), fingerprint = hash(device).slice(0,32);
  const devices = await q('chatgpt_devices',{select:'id,device_fingerprint',user_id:'eq.'+user});
  const found = devices.find(d=>d.device_fingerprint===fingerprint);
  if (!found) {
    if (devices.length >= control.device_limit) fail('device_session_mismatch');
    await api('/rest/v1/chatgpt_devices',{method:'POST',body:{user_id:user,device_fingerprint:fingerprint,label:'ChatGPT gateway'}});
  }
  return fingerprint;
}
async function deviceStillAllowed(user,fingerprint) {
  const [d] = await q('chatgpt_devices',{select:'id',user_id:'eq.'+user,device_fingerprint:'eq.'+fingerprint,limit:'1'});
  if (!d) fail('device_session_mismatch');
}
async function rateLimit(user) {
  return locked('user-'+hash(user), async () => {
    const r = await load('rate',hash(user)) || {times:[]};
    r.times = r.times.filter(t=>t > Date.now()-60_000);
    if (r.times.length >= 8) fail('rate_limited',429);
    r.times.push(Date.now());await save('rate',hash(user),r);
  });
}
export async function issue(req) {
  const origin = req.headers.get('origin');
  if (!DASHBOARD_ORIGINS.has(origin)) fail('invalid_origin');
  const auth = req.headers.get('authorization') || '';
  if (!/^Bearer [A-Za-z0-9_.-]+$/.test(auth)) fail('unauthenticated',401);
  const bearer = auth.slice(7), user = await api('/auth/v1/user',{bearer});
  if (!user?.id) fail('unauthenticated',401);
  let claims;
  try { claims = JSON.parse(Buffer.from(bearer.split('.')[1], 'base64url').toString()); } catch { fail('unauthenticated',401); }
  if (claims.sub !== user.id || !claims.session_id || !claims.exp || claims.exp*1000 <= Date.now()) fail('unauthenticated',401);
  await rateLimit(user.id);
  const entitlement = await findEntitlement(user.id), incoming = cookies(req);
  const device = validToken(incoming.get(DEVICE)) ? incoming.get(DEVICE) : random();
  const fingerprint = await locked('device-'+hash(user.id),()=>deviceGate(user.id,device));
  const proof = random(), token = random(), expires = Date.now()+TTL;
  await save('ticket',hash(token),{
    version:3,tool:'chatgpt',origin:ORIGIN,status:'issued',expires,entitlement,
    deviceHash:hash(device),proofHash:hash(proof),fingerprint,authSessionHash:hash(claims.session_id),created:Date.now(),
  },true);
  const h = headers(origin);h.set('Content-Type','application/json; charset=utf-8');
  h.append('Set-Cookie',cookie(DEVICE,device,365*24*3600));h.append('Set-Cookie',cookie(PROOF,proof,120));
  return new Response(JSON.stringify({ok:true,launch_url:ORIGIN+'/__trst/enter?ticket='+encodeURIComponent(token),expires_at:new Date(expires).toISOString(),proxy_origin:ORIGIN,provider:'chatgpt_proxy'}),{status:200,headers:h});
}
export async function redeem(req) {
  const url = new URL(req.url), token = url.searchParams.get('ticket');
  if (!token) fail('missing_ticket',401);
  if (!validToken(token) || [...url.searchParams.keys()].some(k=>k!=='ticket') || url.searchParams.getAll('ticket').length!==1) fail('invalid_ticket');
  return locked(hash(token),async()=>{
    const r = await load('ticket',hash(token));
    if (!r || r.version!==3 || r.tool!=='chatgpt' || r.origin!==ORIGIN || url.origin!==ORIGIN) fail('invalid_ticket');
    if (r.status!=='issued') fail('reused_ticket');
    if (r.expires<=Date.now()) fail('expired_ticket');
    const cs=cookies(req);
    if (!validToken(cs.get(DEVICE)) || !validToken(cs.get(PROOF)) || !same(hash(cs.get(DEVICE)),r.deviceHash) || !same(hash(cs.get(PROOF)),r.proofHash)) fail('device_session_mismatch');
    await recheck(r.entitlement);await deviceStillAllowed(r.entitlement.user,r.fingerprint);
    if (r.expires<=Date.now()) fail('expired_ticket');
    const session = random();
    await save('session',hash(session),{...r,status:'active',expires:Date.now()+12*3600_000},true);
    r.status='consumed';r.consumedAt=Date.now();await save('ticket',hash(token),r);
    const h=headers();h.set('Location',ORIGIN+'/');
    h.append('Set-Cookie',cookie(SESSION,session,12*3600));h.append('Set-Cookie',cookie(PROOF,'',0));
    return new Response(null,{status:302,headers:h});
  });
}
async function sessionGate(req) {
  const cs=cookies(req), token=cs.get(SESSION), device=cs.get(DEVICE);
  if (!validToken(token) || !validToken(device)) fail('missing_ticket',401);
  const r=await load('session',hash(token));
  if (!r || r.status!=='active' || r.tool!=='chatgpt' || r.origin!==ORIGIN || r.expires<=Date.now()) fail('invalid_ticket',401);
  if (!same(hash(device),r.deviceHash)) fail('device_session_mismatch');
  await recheck(r.entitlement);await deviceStillAllowed(r.entitlement.user,r.fingerprint);
  return r;
}
export async function handle(req) {
  const requestId=randomUUID();
  try {
    const url=new URL(req.url);
    if (url.origin!==ORIGIN) fail('invalid_origin');
    if (url.pathname==='/__trst/launch') {
      if (req.method==='OPTIONS') {
        if (!DASHBOARD_ORIGINS.has(req.headers.get('origin'))) fail('invalid_origin');
        return new Response(null,{status:204,headers:headers(req.headers.get('origin'))});
      }
      if (req.method!=='POST') fail('invalid_ticket');
      return await issue(req);
    }
    if (url.pathname==='/__trst/enter') {
      if (req.method!=='GET') fail('invalid_ticket');
      return await redeem(req);
    }
    const gatewaySession=await sessionGate(req);
    assertRequestSize(req);
    const route=classifyGatewayRequest(req);
    if(route.kind==='websocket') fail('missing_chatgpt_session_source',503);
    return await proxyWithSingleChatGptSession(req,route,gatewaySession);
  } catch(e) {
    const phase4=e instanceof Phase4PolicyError;
    const phase5=e instanceof Phase5SessionError;
    const code=e instanceof GateError ? e.code : phase4 ? e.code : phase5 ? e.code : 'local_gateway_failure';
    const status=e instanceof GateError ? e.status : phase4 ? e.status : phase5 ? e.status : 503;
    console.info(JSON.stringify({component:'chatgpt_gateway',category:code,request_id:requestId}));
    const h=headers(req.headers.get('origin'));h.set('X-Request-ID',requestId);
    const msg=code==='missing_chatgpt_session_source' ? 'Your secure ChatGPT gateway access is ready. The ChatGPT connection is not configured yet.' :
      code==='method_not_allowed' ? 'Method not allowed.' :
      code==='restricted_document_route' ? 'This ChatGPT account or settings page is restricted.' :
      code==='request_too_large' ? 'This ChatGPT request is too large.' :
      code==='asset_host_blocked' || code==='invalid_gateway_origin' ? 'This ChatGPT route is not allowed.' :
      code==='unsupported_upgrade' ? 'This ChatGPT connection type is not available.' :
      code==='chatgpt_account_mismatch' ? 'ChatGPT account assignment could not be verified.' :
      code==='chatgpt_session_token_missing' ? 'The stored ChatGPT session is missing its session token. Admin needs to refresh the authorised session.' :
      code==='chatgpt_session_token_incomplete' ? 'The stored ChatGPT session-token chunks are incomplete. Admin needs to save the complete session.' :
      code==='chatgpt_session_token_ambiguous' ? 'The stored ChatGPT session contains conflicting token formats. Admin needs to refresh the authorised session.' :
      code==='chatgpt_session_cookie_scope_invalid' ? 'The stored ChatGPT auth cookie scope is invalid. Admin needs to refresh the authorised session.' :
      code==='chatgpt_session_invalid' || code==='chatgpt_session_expired' || code==='upstream_auth_rejected' || code==='upstream_edge_challenge' ? 'ChatGPT is temporarily unavailable. Admin may need to refresh the authorised session.' :
      code==='upstream_network_error' || code==='upstream_external_redirect' ? 'ChatGPT is temporarily unavailable. Please try again later.' :
      status===401 ? 'Open ChatGPT from your TopRatedSEOTools account.' :
      status===503 ? 'ChatGPT is temporarily unavailable. Please try again later.' :
      'ChatGPT access could not be verified. Launch again from your TopRatedSEOTools account.';
    return new Response(msg,{status,headers:h});
  }
}
export function start() {
  const server=http.createServer(async (incoming,outgoing)=>{
    try {
      const url=(incoming.headers['x-forwarded-proto']==='https'?'https':'http')+'://'+incoming.headers.host+incoming.url;
      const init={method:incoming.method,headers:incoming.headers};
      if (!['GET','HEAD'].includes(incoming.method || 'GET')) {
        init.body=Readable.toWeb(incoming);init.duplex='half';
      }
      const req=new Request(url,init);
      const res=await handle(req);
      outgoing.statusCode=res.status;
      for(const [k,v] of res.headers) if(k!=='set-cookie') outgoing.setHeader(k,v);
      const sets=res.headers.getSetCookie();if(sets.length) outgoing.setHeader('Set-Cookie',sets);
      if (!res.body) outgoing.end();
      else Readable.fromWeb(res.body).pipe(outgoing);
    } catch {
      outgoing.writeHead(503,{'Cache-Control':'no-store','Content-Type':'text/plain'});outgoing.end('ChatGPT is temporarily unavailable.');
    }
  });
  server.on('upgrade',(_incoming,socket)=>{
    socket.write('HTTP/1.1 503 Service Unavailable\r\nCache-Control: no-store\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nChatGPT connection is not configured yet.');
    socket.destroy();
  });
  server.requestTimeout=15_000;server.headersTimeout=10_000;
  server.listen(Number(process.env.PORT||3006),'127.0.0.1');return server;
}
if (process.argv[1] && import.meta.url === new URL('file://'+process.argv[1]).href) start();
