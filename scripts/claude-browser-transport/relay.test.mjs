import assert from 'node:assert/strict';
import { once } from 'node:events';
import { validateRelayRequest as validate, startRelay } from './relay.mjs';

const valid=validate({path:'/api/organizations',method:'GET',headers:{
  Cookie:'must-not-forward',Authorization:'Bearer must-not-forward',
  Host:'evil.test','User-Agent':'must-not-spoof','sec-ch-ua':'must-not-spoof',
  'Content-Type':'application/json','anthropic-client-version':'example',
}});
assert.equal(valid.url,'https://claude.ai/api/organizations');
assert.deepEqual(valid.headers,{'content-type':'application/json','anthropic-client-version':'example'});
for(const path of ['https://evil.test/','//evil.test/','/\\evil.test/','/%2f%2fevil.test','/api/../settings','/api/%2e%2e/settings','/cdn-cgi/challenge-platform','/login','/api/auth/session','/new#hash','/api/%00']){
  assert.throws(()=>validate({path}),path);
}
for(const method of ['DELETE','CONNECT','TRACE'])assert.throws(()=>validate({path:'/new',method}));
assert.throws(()=>validate({path:'/api/x',method:'POST',body:'x'.repeat(25*1024*1024+1)}));
assert.equal(validate({path:'/api/x',method:'POST',body:'{"text":"₦ café"}'}).body,'{"text":"₦ café"}');
const rpc='/claudeai-rpc/anthropic.bard.api.v1alpha.ConversationService/StreamTimeline';
assert.equal(validate({path:rpc,method:'POST',bodyBase64:'AP8AgA=='}).bodyBase64,'AP8AgA==');
assert.throws(()=>validate({path:rpc,method:'GET'}));
assert.throws(()=>validate({path:rpc,method:'POST',bodyBase64:'not base64'}));
assert.throws(()=>validate({path:'/claudeai-rpc/anthropic.bard.api.v1alpha.AccountService/GetApiKeys',method:'POST'}));
process.env.CLAUDE_BROWSER_RELAY_KEY='test-only-relay-key-12345678901234567890';
const server=startRelay({port:0});await once(server,'listening');
try{
  const base='http://127.0.0.1:'+server.address().port;
  assert.equal((await fetch(base+'/health')).status,200);
  assert.equal((await fetch(base+'/request',{method:'POST',body:'{}'})).status,401);
  assert.equal((await fetch(base+'/request',{method:'POST',headers:{Authorization:'Bearer wrong'},body:'{}'})).status,401);
  const headers={Authorization:'Bearer '+process.env.CLAUDE_BROWSER_RELAY_KEY,'Content-Type':'application/json'};
  assert.equal((await fetch(base+'/request',{method:'POST',headers,body:JSON.stringify({path:'//evil.test/'})})).status,400);
  assert.equal((await fetch(base+'/request',{method:'POST',headers,body:'bad-json'})).status,400);
  assert.equal((await fetch(base+'/unknown',{headers})).status,404);
  console.log('Browser relay: fixed origin, path/method limits, credential filtering, Unicode input and private endpoint checks passed.');
}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
