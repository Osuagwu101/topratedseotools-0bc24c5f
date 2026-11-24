import {strict as assert} from "node:assert";
import {isDisabledChatGptModel,isDisabledChatGptEffort,applyChatGptWriterModelPolicy,requestUsesDisabledChatGptModel,clampChatGptRequestEffort} from "../src/lib/chatgpt-model-policy";
for(const m of ["gpt-6-2-astra","gpt-6-astra","GPT-6.2 Astra","GPT-6 Astra","gpt-7-astra"])assert(isDisabledChatGptModel(m),m);
for(const m of ["gpt-6-2-sol","gpt-6-1-terra","gpt-6-luna","GPT-6.2 Sol","astronaut","Disastrous"])assert(!isDisabledChatGptModel(m),m);
for(const e of ["xhigh","Extra high","extra_high","max","Max","extra-high"])assert(isDisabledChatGptEffort(e),e);
for(const e of ["low","medium","high","High","standard","extended","heavy","maximize"])assert(!isDisabledChatGptEffort(e),e);
const models={models:[
 {slug:"gpt-6-2-astra",title:"GPT-6.2 Astra",thinking_efforts:[{thinking_effort:"high",full_label:"High"},{thinking_effort:"xhigh",full_label:"Extra high"},{thinking_effort:"max",full_label:"Max"}]},
 {slug:"gpt-6-2-sol",title:"GPT-6.2 Sol",default_thinking_effort:"max",thinking_efforts:[{thinking_effort:"low",full_label:"Low"},{thinking_effort:"high",full_label:"High"},{thinking_effort:"xhigh",full_label:"Extra high"},{thinking_effort:"max",full_label:"Max"}]},
 {slug:"gpt-6-astra",title:"GPT-6 Astra"},{slug:"gpt-6-luna",title:"GPT-6 Luna"}],
 categories:[{category:"default",models:["gpt-6-2-sol"]}]};
const out=applyChatGptWriterModelPolicy(models);
assert.deepEqual(out.models.map((m:any)=>m.slug),["gpt-6-2-sol","gpt-6-luna"]);
assert.deepEqual(out.models[0].thinking_efforts.map((e:any)=>e.thinking_effort),["low","high"]);
assert.equal(out.models[0].default_thinking_effort,"high");
// Titles that merely mention astra are not removed.
const chats={items:[{id:"1",title:"Astra project plan"}]};
assert.deepEqual(applyChatGptWriterModelPolicy(chats),chats);
assert(requestUsesDisabledChatGptModel({model:"gpt-6-2-astra"}));
assert(!requestUsesDisabledChatGptModel({model:"gpt-6-2-sol"}));
const req:any={model:"gpt-6-2-sol",thinking_effort:"xhigh",x:{reasoning_effort:"max"}};
assert(clampChatGptRequestEffort(req));assert.equal(req.thinking_effort,"high");assert.equal(req.x.reasoning_effort,"high");
assert(!clampChatGptRequestEffort({thinking_effort:"high"}));
console.log("chatgpt model policy ok");
