import {strict as assert} from "node:assert";
import {applyChatGptBootstrapPolicy,isDisabledChatGptModel,isDisabledChatGptEffort,applyChatGptWriterModelPolicy,requestUsesDisabledChatGptModel,clampChatGptRequestEffort} from "../src/lib/chatgpt-model-policy";
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
// Picker settings embedded in the page (pair lists, JSON stored inside a string, xhigh switch).
const pairs=[{model:"gpt-6-luna",reasoning_effort:"high"},{model:"gpt-6.2-sol",reasoning_effort:"low"},{model:"gpt-6.2-sol",reasoning_effort:"xhigh"},{model:"gpt-6.2-astra",reasoning_effort:"medium"},{model:"gpt-6-astra",reasoning_effort:"low"}];
const outPairs=applyChatGptWriterModelPolicy([pairs,[pairs[2]]]);
assert.deepEqual(outPairs[0],[{model:"gpt-6-luna",reasoning_effort:"high"},{model:"gpt-6.2-sol",reasoning_effort:"low"}]);
assert.deepEqual(outPairs[1],[]);
const blob={statsig:JSON.stringify({a:{value:{show_xhigh_in_simple_picker:true,combos:[pairs]}}}),plain:{show_xhigh_in_simple_picker:true}};
const outBlob=applyChatGptWriterModelPolicy(blob);
const inner=JSON.parse(outBlob.statsig);
assert.equal(inner.a.value.show_xhigh_in_simple_picker,false);assert.equal(inner.a.value.combos[0].length,2);
assert.equal(outBlob.plain.show_xhigh_in_simple_picker,false);
assert.deepEqual(applyChatGptWriterModelPolicy({title:"Astra project plan",note:"max"}),{title:"Astra project plan",note:"max"});
const html='<html><head></head><body><script id="client-bootstrap" type="application/json">'+JSON.stringify(blob).replace(/</g,"\\u003c")+'</script><script>var astra=1</script></body></html>';
const outHtml=applyChatGptBootstrapPolicy(html);
assert(!/astra\W*"?,?\W*reasoning/i.test(outHtml.split("client-bootstrap")[1].split("</script>")[0]));
assert(!outHtml.split("client-bootstrap")[1].split("</script>")[0].includes("gpt-6.2-astra"));
assert(outHtml.includes("<script>var astra=1</script>"));
assert.equal(applyChatGptBootstrapPolicy("<html>no bootstrap here</html>"),"<html>no bootstrap here</html>");
assert.equal(applyChatGptBootstrapPolicy('<script id="client-bootstrap" type="application/json">{broken</script>'),'<script id="client-bootstrap" type="application/json">{broken</script>');
// Work-mode /tpp/models payload: categories, versions and slug lists also name Astra.
const tpp={models:[{slug:"gpt-6.2-sol-wm",title:"GPT-6.2 Sol"},{slug:"gpt-6-astra-wm",title:"GPT-6 Astra"}],
 eligible_codex_model_slugs:["gpt-6-astra","gpt-6.2-astra","gpt-6.2-sol"],
 categories:[{category:"gpt_6_2_sol_work_mode",human_category_name:"GPT-6.2 Sol",default_model:"gpt-6.2-sol-wm",supported_models:["gpt-6.2-sol-wm"],model_version:"6.2 Sol"},
  {category:"gpt_6_2_astra_work_mode",human_category_name:"GPT-6.2 Astra",default_model:"gpt-6.2-astra-wm",supported_models:["gpt-6.2-astra-wm"],model_version:"6.2 Astra",action_pill_short_name:"GPT-6.2 Astra"}],
 versions:[{id:"latest",display_text:"Latest • 6.2 Sol",slugs:["gpt-6.2-sol-wm","gpt-6.2-astra-wm"],intelligence_presets:[{title:"Medium",thinking_effort:"standard"}]},
  {id:"6 Astra",display_text:"6 Astra",display_text_full:"Legacy • 6 Astra",slugs:["gpt-6-astra-wm"]}],
 model_upgrades:{"gpt-6-astra":"gpt-6.2-sol","gpt-6.1-sol":"gpt-6.2-sol"},
 slider_settings:[{model_slug:"gpt-6.2-sol-wm",thinking_effort:"standard"}]};
const outTpp=applyChatGptWriterModelPolicy(tpp);
assert(!/astra/i.test(JSON.stringify(outTpp)),JSON.stringify(outTpp));
assert.deepEqual(outTpp.eligible_codex_model_slugs,["gpt-6.2-sol"]);
assert.equal(outTpp.categories.length,1);assert.equal(outTpp.versions.length,1);
assert.deepEqual(outTpp.versions[0].slugs,["gpt-6.2-sol-wm"]);
assert.deepEqual(Object.keys(outTpp.model_upgrades),["gpt-6.1-sol"]);
assert.equal(outTpp.slider_settings.length,1);
console.log("chatgpt model policy ok");
