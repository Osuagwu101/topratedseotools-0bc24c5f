import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateRelayRequest as v} from './relay.mjs';
test('canonical read route',()=>assert.equal(v({path:'/paraphrasing-tool'}).url,'https://quillbot.com/paraphrasing-tool'));
test('external and malformed routes denied',()=>{for(const path of ['//evil.test','/../settings','/settings','/api/auth/token','/cdn-cgi/challenge','/logout','/paraphrasing-tool#x'])assert.throws(()=>v({path}));});
test('mutations disabled during preflight',()=>assert.throws(()=>v({path:'/paraphrasing-tool',method:'POST',body:'x'})));
test('credentials not accepted from callers',()=>assert.deepEqual(v({path:'/',headers:{cookie:'secret',authorization:'secret',useridtoken:'secret'}}).headers,{}));
