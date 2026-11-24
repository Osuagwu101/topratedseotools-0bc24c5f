import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateRelayRequest as v} from './relay.mjs';
test('canonical read route',()=>assert.equal(v({path:'/paraphrasing-tool'}).url,'https://quillbot.com/paraphrasing-tool'));
test('external and malformed routes denied',()=>{for(const path of ['//evil.test','/../settings','/settings','/api/auth/token','/cdn-cgi/challenge','/logout','/paraphrasing-tool#x'])assert.throws(()=>v({path}));});
test('mutations disabled during preflight',()=>assert.throws(()=>v({path:'/paraphrasing-tool',method:'POST',body:'x'})));
test('credentials not accepted from callers',()=>assert.deepEqual(v({path:'/',headers:{cookie:'secret',authorization:'secret',useridtoken:'secret'}}).headers,{}));
test('other QuillBot tools are open, but only through their own routes',()=>{
  for(const path of ['/ai-content-detector','/ai-humanizer','/summarize','/citation-generator','/grammar-checker','/plagiarism-checker','/ssrprops?lib=@quillbot/ai-detector-page&page=x','/api/ai-detector/limit?featureName=x'])assert.equal(v({path}).method,'GET');
  for(const path of ['/api/ai-detector/score?version=1','/api/humanizer/humanize','/api/utils/detect-language'])assert.equal(v({path,method:'POST',body:'{}'}).method,'POST');
});
test('account, payment and shared-storage routes stay closed',()=>{
  for(const path of ['/account','/settings','/billing','/api/billing/x','/api/payments/checkout','/api/projects','/api/history','/api/user/me','/api/auth/sign-out'])assert.throws(()=>v({path,method:'POST',body:'{}'}));
  for(const path of ['/account','/settings','/api/projects','/api/history','/ssrprops?lib=@quillbot/projects','/ssrprops?lib=@quillbot/account-page'])assert.throws(()=>v({path}));
});
