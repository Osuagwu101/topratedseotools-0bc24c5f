import assert from 'node:assert/strict';
import {createHash,createCipheriv} from 'node:crypto';
import {EventEmitter,once} from 'node:events';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),WS=require('ws');
process.env.SUPABASE_URL='https://database.test';process.env.SUPABASE_SERVICE_ROLE_KEY='test-service-key';process.env.GRAMMARLY_SESSION_ENCRYPTION_KEY='33'.repeat(32);
process.env.GRAMMARLY_PROXY_PUBLIC_ORIGIN='https://grammarly.topratedseotools.com';
function encrypt(value){const iv=Buffer.alloc(12,1),c=createCipheriv('aes-256-gcm',Buffer.from('33'.repeat(32),'hex'),iv);c.setAAD(Buffer.from('topratedseotools:grammarly:session_state_json:v1'));const ct=Buffer.concat([c.update(JSON.stringify(value)),c.final()]);return JSON.stringify({v:1,alg:'A256GCM',iv:iv.toString('base64'),ct:ct.toString('base64'),tag:c.getAuthTag().toString('base64')});}
const sessions=[1,2].map(n=>({id:'session'+n,user_id:'writer'+n,status:'active',source_kind:'grant',source_id:'grant'+n,provider_account_key:'account_'+n,expires_at:new Date(Date.now()+120000).toISOString(),token_hash:createHash('sha256').update(String(n).repeat(43)).digest('hex')}));
const controls=sessions.map(s=>({user_id:s.user_id,provider_account_key:s.provider_account_key}));
const accounts=[1,2].map(n=>({account_key:'account_'+n,status:'stored',verified_at:new Date().toISOString(),encrypted_payload:encrypt({cookies:[{name:'grauth',value:'provider-cookie-'+n,domain:'.grammarly.com',path:'/'}]})}));
const tables={grammarly_proxy_sessions:sessions,grammarly_user_controls:controls,grammarly_provider_accounts:accounts,tool_settings:[{tool_slug:'grammarly',enabled:true,one_click_auth_enabled:true}],tool_access_grants:sessions.map(s=>({id:s.source_id,user_id:s.user_id,tool_slug:'grammarly',status:'active',expires_at:null})),grammarly_document_owners:[{document_id:'1001',user_id:'writer1',provider_account_key:'account_1'},{document_id:'2002',user_id:'writer2',provider_account_key:'account_2'}]};
const realFetch=globalThis.fetch;
globalThis.fetch=async input=>{const u=new URL(String(input));assert.equal(u.origin,'https://database.test');const table=u.pathname.split('/').at(-1);const rows=(tables[table]??[]).filter(r=>[...u.searchParams].every(([k,v])=>!v.startsWith('eq.')||String(r[k])===v.slice(3)));return Response.json(rows);};
const providers=[];
class Provider extends EventEmitter{
 constructor(target,protocols,options){super();this.target=target;this.headers=options.headers;this.frames=[];this.readyState=0;providers.push(this);queueMicrotask(()=>{this.readyState=WS.OPEN;this.emit('open')});}
 send(data,options){this.frames.push(String(data));queueMicrotask(()=>this.emit('message',data,options.binary));}
 close(code=1000,reason=''){if(this.readyState===WS.CLOSED)return;this.readyState=WS.CLOSED;this.emit('close',code,reason);}
}
const {startRelay}=await import('../scripts/grammarly-ws-relay.mjs');
const server=startRelay({port:0,UpstreamWebSocket:Provider});await once(server,'listening');
const port=server.address().port;
const clients=[];
function socket(n,path='/__ws/capi.grammarly.com/freews'){const ws=new WS('ws://127.0.0.1:'+port+path,{headers:{Cookie:'trst_gr_proxy='+String(n).repeat(43),Origin:process.env.GRAMMARLY_PROXY_PUBLIC_ORIGIN}});clients.push(ws);return ws;}
try{
 const [a,b]=[socket(1),socket(2)];await Promise.all([once(a,'open'),once(b,'open')]);
 assert.equal(providers[0].headers.Cookie,'grauth=provider-cookie-1');assert.equal(providers[1].headers.Cookie,'grauth=provider-cookie-2');
 const replies=[once(a,'message'),once(b,'message')];a.send('{"docid":"1001","text":"one"}');b.send('{"docid":"2002","text":"two"}');await Promise.all(replies);
 assert.equal(providers[0].frames.length,1);assert.equal(providers[1].frames.length,1);
 const denied=once(a,'close');a.send('{"docid":"2002","text":"foreign"}');assert.equal((await denied)[0],4403);assert.equal(providers[0].frames.length,1);
 const switched=once(b,'close');controls[1].provider_account_key='account_1';assert.equal((await switched)[0],4401);
 controls[1].provider_account_key='account_2';accounts[1].status='revoked';
 const blocked=socket(2);const response=await new Promise(resolve=>{blocked.once('unexpected-response',(_req,res)=>{res.resume();blocked.terminate();resolve(res.statusCode)});blocked.on('error',()=>{});});assert.equal(response,401);assert.equal(providers.length,2);
 const owned=socket(1,'/__ws/dox.grammarly.com/documents/1001/ws');await once(owned,'open');
 const binaryReply=once(owned,'message');owned.send(Buffer.from([1,2,3]));assert.deepEqual((await binaryReply)[0],Buffer.from([1,2,3]));
 const foreignSocket=socket(1,'/__ws/dox.grammarly.com/documents/2002/ws');
 const foreignStatus=await new Promise(resolve=>{foreignSocket.once('unexpected-response',(_req,res)=>{res.resume();foreignSocket.terminate();resolve(res.statusCode)});foreignSocket.on('error',()=>{});});assert.equal(foreignStatus,403);

 tables.grammarly_document_owners.push({document_id:'coda:ownDoc0001',user_id:'writer1',provider_account_key:'account_1'});
 const params=Buffer.from(JSON.stringify({documentId:'ownDoc0001',csrfToken:'browser'})).toString('base64url');
 const codaPath='/__ws/coda.grammarly.com/document_server/?transport=websocket&params='+params;
 const coda=socket(1,codaPath);await once(coda,'open');
 assert.equal(providers.at(-1).headers.Origin,'https://coda.grammarly.com');
 assert.equal(providers.at(-1).headers.Cookie,'grauth=provider-cookie-1');
 let reply=once(coda,'message');coda.send('40/document_server,{}');await reply;
 const codaClosed=once(coda,'close');coda.send('42/document_server,["open",{"documentId":"foreignDoc001"}]');assert.equal((await codaClosed)[0],4403);
 const count=providers.length;
 const badSid=socket(1,codaPath+'&sid=unsealed');
 const badSidStatus=await new Promise(resolve=>{badSid.once('unexpected-response',(_req,res)=>{res.resume();badSid.terminate();resolve(res.statusCode)});badSid.on('error',()=>{});});assert.equal(badSidStatus,403);assert.equal(providers.length,count);
 console.log('Grammarly WebSockets: real downstream sockets, independent upstream cookies, owned frames, foreign-document rejection, idle reassignment closure and revoked-account handshake checks passed.');
}finally{clients.forEach(c=>{try{c.terminate()}catch{}});await new Promise(resolve=>server.close(resolve));globalThis.fetch=realFetch;}
