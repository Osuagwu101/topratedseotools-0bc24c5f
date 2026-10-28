import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const source=process.env.PHRASLY_EXPORTER_SOURCE||path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../extensions/phrasly-admin-exporter');
const coreSource=fs.readFileSync(path.join(source,'core.mjs'),'utf8');
const workerSource=fs.readFileSync(path.join(source,'background.mjs'),'utf8');
const manifest=JSON.parse(fs.readFileSync(path.join(source,'manifest.json'),'utf8'));
const core=await import('file://'+path.join(source,'core.mjs').replaceAll('\\','/'));
const checks=[];
async function test(name,fn){await fn();checks.push(name);console.log('PASS '+name);}
const clone=v=>JSON.parse(JSON.stringify(v));
const fixture=()=>[
 {name:'session',value:'SYNTHETIC_PHRASLY_SESSION',domain:'.phrasly.ai',path:'/',secure:true,httpOnly:true,hostOnly:false,sameSite:'lax',session:false,expirationDate:4102444800,storeId:'0'},
 {name:'theme',value:'light',domain:'phrasly.ai',path:'/',secure:true,httpOnly:false,hostOnly:true,sameSite:'lax',session:true,storeId:'0'}
];
async function harness(){
 const state={},tabs=new Map([[10,{id:10,url:'https://phrasly.ai/dashboard/humanizer',active:true}]]),listeners={},alarms=new Map();let nextId=20;
 let cookies=fixture(),lastGet;
 const chrome={
  runtime:{id:'exporter',getURL:p=>'chrome-extension://exporter/'+p,onMessage:{addListener:f=>listeners.internal=f},onMessageExternal:{addListener:f=>listeners.external=f}},
  tabs:{get:async id=>clone(tabs.get(id)),create:async data=>{for(const tab of tabs.values())tab.active=false;const tab={id:nextId++,...data};tabs.set(tab.id,tab);return clone(tab);},update:async(id,data)=>{Object.assign(tabs.get(id),data);return clone(tabs.get(id));}},
  cookies:{getAllCookieStores:async()=>[{id:'0',tabIds:[10]}],getAll:async filter=>{lastGet=filter;return clone(cookies);}},
  storage:{session:{get:async key=>({[key]:clone(state[key]??null)}),set:async values=>Object.assign(state,clone(values)),remove:async key=>{delete state[key];}}},
  alarms:{create:async(name,info)=>alarms.set(name,info),clear:async name=>alarms.delete(name),onAlarm:{addListener:f=>listeners.alarm=f}}
 };
 const context=vm.createContext({chrome,crypto:webcrypto,TextEncoder,URL,Date});
 const coreModule=new vm.SourceTextModule(coreSource,{context});await coreModule.link(()=>{});await coreModule.evaluate();
 const worker=new vm.SourceTextModule(workerSource,{context});await worker.link(s=>{assert.equal(s,'./core.mjs');return coreModule;});await worker.evaluate();
 const invoke=(kind,message,sender)=>new Promise(resolve=>{if(!listeners[kind](message,sender,r=>resolve(clone(r))))resolve({ignored:true});});
 const internal=message=>invoke('internal',message,{id:'exporter',url:'chrome-extension://exporter/popup.html'});
 const send=()=>internal({type:'SEND_PHRASLY_COOKIES',tabId:10});
 const pending=()=>state.phraslyPendingImport;
 const sender=()=>({origin:core.ADMIN_ORIGIN,url:tabs.get(pending().tabId).url,tab:{id:pending().tabId}});
 const claim=(overrides={},from)=>invoke('external',{type:'TOPRATED_PHRASLY_COOKIE_IMPORT',version:1,nonce:pending()?.nonce,...overrides},from||sender());
 return {chrome,state,tabs,listeners,alarms,internal,send,pending,sender,claim,invoke,setCookies:c=>cookies=c,lastGet:()=>clone(lastGet),activate:()=>{for(const t of tabs.values())t.active=false;tabs.get(10).active=true;}};
}

await test('brand and permissions match the requested Phrasly-only exporter',()=>{assert.equal(manifest.name,'Osuagwu Solomon TopRated');assert.deepEqual(manifest.host_permissions,['https://phrasly.ai/*','https://*.phrasly.ai/*']);assert.deepEqual(manifest.externally_connectable.matches,['https://topratedseotools.com/*']);assert.ok(!manifest.permissions.includes('scripting'));assert.ok(!manifest.permissions.includes('tabs'));});
await test('exact Phrasly domain and its subdomains are accepted',()=>{for(const host of ['phrasly.ai','.phrasly.ai','app.phrasly.ai'])assert.equal(core.isPhraslyDomain(host),true);});
await test('lookalike and unrelated domains are rejected',()=>{for(const host of ['evilphrasly.ai','phrasly.ai.evil.test','example.com','phrasly.ai.'])assert.equal(core.isPhraslyDomain(host),false);});
await test('only HTTPS Phrasly pages without a nonstandard port are valid sources',()=>{assert.equal(core.isPhraslyPage('https://phrasly.ai/dashboard'),true);for(const u of ['http://phrasly.ai/','https://phrasly.ai:444/','https://phrasly.ai.evil.test/','file:///tmp/phrasly.ai','bad'])assert.equal(core.isPhraslyPage(u),false);});
await test('the complete cookie array and metadata are preserved',()=>assert.deepEqual(core.validateCookies(fixture()),fixture()));
await test('foreign cookie domains cannot enter a bundle',()=>assert.throws(()=>core.validateCookies([...fixture(),{name:'x',value:'x',domain:'.example.com'}]),/invalid_cookie_bundle/));
await test('a session cookie is mandatory for sending',()=>assert.throws(()=>core.validateCookies(fixture().filter(c=>c.name!=='session')),/phrasly_sign_in_required/));
await test('copy-only export can show cookies before login',()=>assert.equal(core.validateCookies([fixture()[1]],false).length,1));
await test('empty, malformed, excessive and oversized exports are rejected',()=>{for(const v of [[],null,{},[{}],Array.from({length:101},()=>fixture()[0]),[{...fixture()[0],value:'x'.repeat(200001)}]])assert.throws(()=>core.validateCookies(v),/invalid_cookie_bundle/);});
await test('only the extension popup can request local cookies',async()=>{const h=await harness();assert.deepEqual(await h.invoke('internal',{type:'GET_PHRASLY_COOKIES',tabId:10},{id:'other',url:'https://phrasly.ai/'}),{ignored:true});});
await test('opening the popup reads the correct browser cookie store without a handoff',async()=>{const h=await harness();const r=await h.internal({type:'GET_PHRASLY_COOKIES',tabId:10});assert.equal(r.ok,true);assert.deepEqual(r.cookies,fixture());assert.deepEqual(h.lastGet(),{domain:'phrasly.ai',storeId:'0'});assert.equal(h.pending(),undefined);assert.equal(h.tabs.size,1);});
await test('an inactive or unrelated source tab cannot export cookies',async()=>{const h=await harness();h.tabs.get(10).active=false;assert.equal((await h.send()).error,'phrasly_page_required');h.tabs.get(10).active=true;h.tabs.get(10).url='https://example.com';assert.equal((await h.send()).error,'phrasly_page_required');});
await test('Send creates a bound short-lived handoff with no cookie data in the URL',async()=>{const h=await harness();assert.equal((await h.send()).ok,true);const p=h.pending();assert.match(p.nonce,/^[a-f0-9]{64}$/);assert.equal(p.expiresAt-p.capturedAt,300000);assert.equal(h.tabs.get(p.tabId).url,core.ADMIN_ORIGIN+core.ADMIN_PATH+'#cookie-import='+p.nonce);assert.ok(!h.tabs.get(p.tabId).url.includes('SYNTHETIC'));assert.ok(h.alarms.has('phraslyImportExpiry'));});
await test('a valid first-party Admin claim returns the complete export and consumes it',async()=>{const h=await harness();await h.send();const r=await h.claim();assert.equal(r.ok,true);assert.deepEqual(r.cookies,fixture());assert.equal(h.pending(),undefined);assert.equal(h.alarms.size,0);});
await test('foreign origins cannot consume a pending export',async()=>{const h=await harness();await h.send();const s=h.sender();s.origin='https://evil.test';s.url='https://evil.test/admin/phrasly#cookie-import='+h.pending().nonce;assert.equal((await h.claim({},s)).error,'untrusted_import');assert.ok(h.pending());assert.equal((await h.claim()).ok,true);});
await test('another page on TopRated cannot consume an export',async()=>{const h=await harness();await h.send();const s=h.sender();s.url=core.ADMIN_ORIGIN+'/dashboard#cookie-import='+h.pending().nonce;assert.equal((await h.claim({},s)).error,'untrusted_import');assert.ok(h.pending());});
await test('a different Admin tab cannot steal the handoff',async()=>{const h=await harness();await h.send();const s=h.sender();s.tab.id+=1;assert.equal((await h.claim({},s)).error,'untrusted_import');assert.ok(h.pending());});
await test('origin-spoofed and malformed sender URLs are rejected',async()=>{const h=await harness();await h.send();for(const url of ['http://topratedseotools.com/admin/phrasly','https://topratedseotools.com.evil.test/admin/phrasly','https://topratedseotools.com:444/admin/phrasly','bad']){const s=h.sender();s.url=url;assert.equal((await h.claim({},s)).error,'untrusted_import');}});
await test('an incorrect nonce or missing fragment cannot consume a valid export',async()=>{const h=await harness();await h.send();assert.equal((await h.claim({nonce:'f'.repeat(64)})).error,'untrusted_import');const s=h.sender();s.url=core.ADMIN_ORIGIN+core.ADMIN_PATH;assert.equal((await h.claim({},s)).error,'untrusted_import');assert.ok(h.pending());});
await test('concurrent claims succeed exactly once',async()=>{const h=await harness();await h.send();const nonce=h.pending().nonce,s=h.sender();const r=await Promise.all([h.claim({nonce},s),h.claim({nonce},s)]);assert.equal(r.filter(x=>x.ok).length,1);assert.equal(r.filter(x=>x.error==='import_expired').length,1);});
await test('a replay after successful consumption returns no cookies',async()=>{const h=await harness();await h.send();const nonce=h.pending().nonce,s=h.sender();await h.claim();const r=await h.claim({nonce},s);assert.equal(r.error,'import_expired');assert.equal(r.cookies,undefined);});
await test('expired exports are cleared without returning cookie values',async()=>{const h=await harness();await h.send();h.pending().expiresAt=Date.now()-1;const r=await h.claim();assert.equal(r.error,'import_expired');assert.equal(h.pending(),undefined);assert.equal(r.cookies,undefined);});
await test('the expiry alarm clears abandoned exports',async()=>{const h=await harness();await h.send();h.pending().expiresAt=Date.now()-1;h.listeners.alarm({name:'phraslyImportExpiry'});await new Promise(setImmediate);assert.equal(h.pending(),undefined);});
await test('an old alarm cannot clear a newer unexpired export',async()=>{const h=await harness();await h.send();h.listeners.alarm({name:'phraslyImportExpiry'});await new Promise(setImmediate);assert.ok(h.pending());});
await test('sending a new export replaces the old pending packet',async()=>{const h=await harness();await h.send();const old=h.pending().nonce;h.activate();await h.send();assert.notEqual(h.pending().nonce,old);assert.equal(Object.keys(h.state).length,1);});
await test('invalid payload versions do not expose an import',async()=>{const h=await harness();await h.send();const r=await h.invoke('external',{type:'TOPRATED_PHRASLY_COOKIE_IMPORT',version:2,nonce:h.pending().nonce},h.sender());assert.deepEqual(r,{ignored:true});assert.ok(h.pending());});
await test('the collector has no direct network upload or persistent/synced cookie storage',()=>{assert.doesNotMatch(workerSource,/\bfetch\s*\(|XMLHttpRequest|sendBeacon|storage\.(local|sync)/);assert.doesNotMatch(fs.readFileSync(path.join(source,'popup.mjs'),'utf8'),/innerHTML|console\./);});
console.log(JSON.stringify({status:'PASS',checks:checks.length,cases:checks},null,2));
