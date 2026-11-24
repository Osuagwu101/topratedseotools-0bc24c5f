import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {toolHistoryEntry,isProviderToolPath,providerLimitHit,PROVIDER_LIMIT_BODY} from './tool-history.mjs';
import {WriterStore} from './writer-store.mjs';
import {validateRelayRequest as v} from './relay.mjs';
test('AI Detector result becomes a readable history entry',()=>{
  const e=toolHistoryEntry('/api/ai-detector/score',{text:'Some text.',language:'en'},{data:{value:{aiScore:0.42,aiParaphrasedScore:0.1,humanParaphrasedScore:0.05}}});
  assert.deepEqual(e,{tool:'AI Detector',input:'Some text.',output:'AI-generated: 42% · AI-refined: 10% · Human-refined: 5%'});
  assert.equal(toolHistoryEntry('/api/ai-detector/score',{text:'x'},{data:{}}),null);
  assert.equal(toolHistoryEntry('/api/ai-detector/score',{text:'  '},{data:{value:{aiScore:1}}}),null);
});
test('Summarizer result becomes a history entry',()=>{
  assert.deepEqual(toolHistoryEntry('/api/summarizer/summarize-para/abs',{para:'Long text'},{data:{summary:'Short.'}}),{tool:'Summarizer',input:'Long text',output:'Short.'});
  assert.equal(toolHistoryEntry('/api/summarizer/summarize-para/abs',{para:'Long'},{data:{}}),null);
});
test('other routes are not recorded',()=>{assert.equal(toolHistoryEntry('/api/utils/detect-language',{text:'x'},{}),null);});
test('provider limits become an Admin-code message',()=>{
  assert.ok(isProviderToolPath('/api/ai-detector/score')&&isProviderToolPath('/api/summarizer/summarize-para/abs')&&!isProviderToolPath('/api/paraphraser/single-paraphrase/2'));
  assert.ok(providerLimitHit(429,null)&&providerLimitHit(402,{})&&providerLimitHit(200,{code:'AI_DETECTOR_LIMIT_REACHED'})&&!providerLimitHit(200,{code:'COM_OK'}));
  assert.match(PROVIDER_LIMIT_BODY.message,/QB-02/);
});
test('tool usage is counted per writer per tool and history stays per writer',()=>{
  const dir=mkdtempSync(join(tmpdir(),'qb-tools-'));const s=new WriterStore(join(dir,'s.sqlite'));
  try{
    s.countTool('a','AI Detector');s.countTool('a','AI Detector');s.countTool('a','Summarizer');s.countTool('b','AI Detector');
    assert.deepEqual(s.toolUsage('a'),{'AI Detector':2,'Summarizer':1});assert.deepEqual(s.toolUsage('b'),{'AI Detector':1});
    s.saveHistory('a','enc-a','f1');assert.equal(s.history('a').length,1);assert.equal(s.history('b').length,0);
  }finally{s.db.close();rmSync(dir,{recursive:true});}
});
test('citation storage and Projects stay closed, other tool data stays open',()=>{
  for(const path of ['/citation-generator','/api/citations-next/data/folders','/api/citations/x','/api/projects'])assert.throws(()=>v({path}));
  assert.throws(()=>v({path:'/api/citations-next/data/new/source',method:'POST',body:'{}'}));
  assert.equal(v({path:'/api/summarizer/summarize-para/abs',method:'POST',body:'{}'}).method,'POST');
});
