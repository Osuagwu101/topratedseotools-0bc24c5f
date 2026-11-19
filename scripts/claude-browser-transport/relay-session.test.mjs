import assert from 'node:assert/strict';
import { once } from 'node:events';
import { validateSessionCookies as validate, startRelay } from './relay.mjs';

const ok=validate({cookies:[
  {name:'sessionKey',value:'sk-ant-test',domain:'.claude.ai',path:'/',sameSite:'no_restriction',httpOnly:true,expires:4102444800},
  {name:'lastActiveOrg',value:'org',domain:'claude.ai',sameSite:'lax'},
]});
assert.equal(ok.length,2);
assert.deepEqual(ok[0],{name:'sessionKey',value:'sk-ant-test',domain:'.claude.ai',path:'/',secure:true,httpOnly:true,sameSite:'None',expires:4102444800});
assert.equal(ok[1].sameSite,'Lax');
assert.throws(()=>validate({cookies:[]}));
assert.throws(()=>validate({cookies:[{name:'sessionKey',value:'x',domain:'.evil.test'}]}));
assert.throws(()=>validate({cookies:[{name:'sessionKey',value:'x',domain:'claude.ai.evil.test'}]}));
assert.throws(()=>validate({cookies:[{name:'other',value:'x',domain:'.claude.ai'}]}));
assert.throws(()=>validate({cookies:[{name:'sessionKey',value:'a;b',domain:'.claude.ai'}]}));
assert.throws(()=>validate({cookies:[{name:'bad name',value:'x',domain:'.claude.ai'}]}));

process.env.CLAUDE_BROWSER_RELAY_KEY='test-only-relay-key-12345678901234567890';
const applied=[];
const server=startRelay({port:0,applySession:async cookies=>{applied.push(cookies);}});await once(server,'listening');
try{
  const base='http://127.0.0.1:'+server.address().port;
  const body=JSON.stringify({cookies:[{name:'sessionKey',value:'sk',domain:'.claude.ai'}]});
  assert.equal((await fetch(base+'/session',{method:'POST',body})).status,401);
  const headers={Authorization:'Bearer '+process.env.CLAUDE_BROWSER_RELAY_KEY,'Content-Type':'application/json'};
  assert.equal((await fetch(base+'/session',{method:'POST',headers,body:'{"cookies":[{"name":"sessionKey","value":"x","domain":"evil.test"}]}'})).status,400);
  assert.equal(applied.length,0);
  const res=await fetch(base+'/session',{method:'POST',headers,body});
  assert.equal(res.status,200);assert.equal(applied.length,1);assert.equal(applied[0][0].name,'sessionKey');
  console.log('Browser relay session push: authentication, claude.ai-only cookies and sessionKey requirement passed.');
}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
