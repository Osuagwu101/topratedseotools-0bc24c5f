import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {WriterStore} from '../browser-transport/writer-store.mjs';
import {BrowserConnection} from '../browser-transport/relay.mjs';
function fixture(fn){const dir=mkdtempSync(join(tmpdir(),'qb-rollout-'));const store=new WriterStore(join(dir,'store'));try{fn(store);}finally{store.db.close();rmSync(dir,{recursive:true});}}
test('failed paraphrase refunds once without refunding another writer',()=>fixture(s=>{const id=s.reserve('a','text');s.fail('b',id);assert.equal(s.status('a').used,1);s.fail('a',id);s.fail('a',id);assert.equal(s.status('a').used,0);}));
test('partial successful output cannot be used to obtain a free submission',()=>fixture(s=>{const id=s.reserve('a','text');s.recordOutput('a',id,{alt:'real result'});s.fail('a',id);assert.equal(s.status('a').used,1);}));
test('midnight reset follows Lagos, and previous-day failure does not refund the new day',()=>fixture(s=>{let now=Date.parse('2026-11-17T22:59:59Z');s.now=()=>now;const id=s.reserve('a','yesterday');assert.equal(s.status('a').used,1);now+=2000;assert.equal(s.status('a').used,0);s.reserve('a','today');s.fail('a',id);assert.equal(s.status('a').used,1);}));
test('concurrent session imports do not reload the shared browser twice',async()=>{const c=new BrowserConnection();let apply=0;c.ready=async()=>{};c.reset=()=>{};c.call=async(method)=>{if(method==='Network.setCookies'){apply++;await new Promise(r=>setTimeout(r,5));}return {cookies:[]}};const input={cookie:'useridtoken='+('test-only-'.repeat(20)),version:'one'};await Promise.all([c.applySession(input),c.applySession(input)]);assert.equal(apply,1);});

test('provider responses redact imported credentials even after native cookie removal',async()=>{
 const {runInNewContext}=await import('node:vm');
 const c=new BrowserConnection();c.ready=async()=>{};c.browserToken=async()=>('native-secret-test-'.repeat(10));c.importedSecrets=['imported-secret-test-only'];
 const events=[];let done;const finished=new Promise(r=>done=r);
 const response=JSON.stringify({info:'imported-secret-test-only',useridtoken:'native-secret-test-'.repeat(10),message:'normal response'});
 c.call=async(method,params)=>{runInNewContext(params.expression,{trstRelayData(payload){const event=JSON.parse(payload);events.push(event);if(event.kind==='end'||event.kind==='error')done();},trstRelayControllers:new Map(),document:{cookie:''},AbortController,URL,fetch:async()=>({url:'https://quillbot.com/api/utils/get-ui-config',status:200,headers:new Headers({'content-type':'application/json'}),text:async()=>response}),Headers,TextEncoder,btoa:s=>Buffer.from(s,'binary').toString('base64'),atob:s=>Buffer.from(s,'base64').toString('binary'),Uint8Array,Map,decodeURIComponent,encodeURIComponent});return {};};
 const res={headersSent:false,on(){},writeHead(){},end(){}};
 await c.relay({url:'https://quillbot.com/api/utils/get-ui-config',method:'POST',headers:{}},{},res);await finished;
 for(const job of c.jobs.values())job.fail();
 const output=events.filter(e=>e.kind==='chunk').map(e=>Buffer.from(e.data,'base64').toString()).join('');
 assert.ok(!events.some(e=>e.kind==='error'));assert.ok(!output.includes('imported-secret-test-only'));assert.ok(!output.includes('native-secret-test-'));assert.ok(output.includes('normal response'));assert.ok(output.length<5000);
});
