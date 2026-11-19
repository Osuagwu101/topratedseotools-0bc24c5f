import {strict as assert} from "node:assert";
import {isDisabledClaudeModel,applyClaudeWriterModelPolicy,requestUsesDisabledModel,applyClaudeNewConversationDefaults,clampClaudeRequestEffort} from "../src/lib/claude-model-policy";
for(const m of ["claude-fable-5-2","claude-fable-5","claude-opus-5-5","claude-opus-4-1-20250805-claude-ai","claude-3-opus-20240229","Claude Fable 5.2","claude-mythos-5-2","claude-opus-5-5[1m]"])assert(isDisabledClaudeModel(m),m);
for(const m of ["claude-sonnet-5-5","claude-haiku-5-5","claude-sonnet-4-6","claude-haiku-4-5-20251001","sonnet"])assert(!isDisabledClaudeModel(m),m);
const bootstrap={account:{settings:{default_model:null},memberships:[{organization:{uuid:"o",claude_ai_bootstrap_models_config:[
 {model:"claude-fable-5-2",name:"Claude Fable 5.2"},{model:"claude-opus-5-5"},{model:"claude-sonnet-5-5"},{model:"claude-haiku-5-5"},{model:"claude-opus-4-1-20250805-claude-ai"}]}}]},
 growthbook:{features:{a:{value:{allowedModels:["claude-sonnet-5","claude-fable-5","claude-opus-5","claude-sonnet-5-5"]}},b:{value:{models:[{id:"fable",match:"fable"}]}},c:{value:"{\"model\":\"opus\"}"}}}};
const out=applyClaudeWriterModelPolicy(bootstrap);
const org=out.account.memberships[0].organization;
assert.deepEqual(org.claude_ai_bootstrap_models_config.map((m:any)=>m.model),["claude-sonnet-5-5","claude-haiku-5-5"]);
assert.equal(org.org_enforced_default_model,"claude-sonnet-5-5");assert.equal(org.org_enforced_default_effort,"low");
assert.equal(out.account.settings.default_model,"claude-sonnet-5-5");
assert.deepEqual(out.growthbook.features.a.value.allowedModels,["claude-sonnet-5-5","claude-sonnet-5"]);
assert.deepEqual(out.growthbook.features.b.value.models,[{id:"fable",match:"fable"}]); // non-model-id config untouched
assert.equal(out.growthbook.features.c.value,"{\"model\":\"opus\"}");
assert.deepEqual(applyClaudeWriterModelPolicy({account:{settings:{default_model:"claude-haiku-5-5"}}}).account.settings.default_model,"claude-haiku-5-5");
assert(requestUsesDisabledModel({model:"claude-opus-5-5"}));assert(requestUsesDisabledModel({settings:{model:"claude-fable-5-2"}}));
assert(!requestUsesDisabledModel({model:"claude-sonnet-5-5"}));
assert.deepEqual(applyClaudeNewConversationDefaults({name:""}),{name:"",model:"claude-sonnet-5-5",settings:{effort_level:"low"}});
assert.deepEqual(applyClaudeNewConversationDefaults({model:"claude-haiku-5-5",settings:{effort_level:"high"}}),{model:"claude-haiku-5-5",settings:{effort_level:"high"}});
// Extra (xhigh) and Max are removed from every model's effort list; stale selections clamp to high.
const sel={model_selector_config:[{models:[{id:"claude-sonnet-5-5",thinking:{type:"effort_and_mode",effort_options:[{id:"low",name:"Low"},{id:"medium",name:"Medium"},{id:"high",name:"High"},{id:"xhigh",name:"Extra"},{id:"max",name:"Max"}]}}],settings_vocabulary:{effort_level:{high:3,low:1,max:5,medium:2,xhigh:4}}}],
 model_selector_state:[{id:"chat",model:"claude-sonnet-5-5",thinking:{type:"effort_and_mode",effort:"max",mode:"auto"},thinking_by_model:[{id:"claude-sonnet-5-5",thinking:{effort:"xhigh"}}]}]};
const sout=applyClaudeWriterModelPolicy(sel);
assert.deepEqual(sout.model_selector_config[0].models[0].thinking.effort_options.map((o:any)=>o.id),["low","medium","high"]);
assert.deepEqual(sout.model_selector_config[0].settings_vocabulary.effort_level,{high:3,low:1,max:5,medium:2,xhigh:4});
assert.equal(sout.model_selector_state[0].thinking.effort,"high");assert.equal(sout.model_selector_state[0].thinking_by_model[0].thinking.effort,"high");
const req={model:"claude-sonnet-5-5",settings:{effort_level:"max"},create_conversation_params:{effort_level:"xhigh"},prompt:"max effort please",effort_level_note:"max"};
assert(clampClaudeRequestEffort(req));assert.equal(req.settings.effort_level,"high");assert.equal(req.create_conversation_params.effort_level,"high");assert.equal(req.prompt,"max effort please");
assert(!clampClaudeRequestEffort({settings:{effort_level:"low"}}));assert(!clampClaudeRequestEffort({settings:{effort_level:"medium"}}));
console.log("Claude model policy: Fable/Opus/Mythos removed and refused, Extra/Max effort removed and clamped, Sonnet 5.5 low default, other models untouched.");
