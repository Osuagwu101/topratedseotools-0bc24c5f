const {test}=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),ts=require("typescript"),vm=require("node:vm");
const compile=p=>ts.transpileModule(fs.readFileSync(p,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function fixture(role=true){
 const aid="10000000-0000-4000-8000-000000000001",uid="00000000-0000-4000-8000-000000000001",writes=[];
 const tables={profiles:[{id:uid,account_status:"active"}],user_roles:[{user_id:uid,role:"admin",is_active:true,is_super_admin:role}],admin_accounts:[{user_id:uid}],phrasly_oneclick_accounts:[{id:aid,tool_id:"phrasly",label:"Account 1",target_url:"https://phrasly.ai/dashboard",capacity:null,enabled:true,encrypted_cookies:"ORIGINAL"}],phrasly_oneclick_assignments:[{account_id:aid,tool_id:"phrasly"},{account_id:aid,tool_id:"phrasly"}],phrasly_oneclick_feature_grants:[]};
 const db={auth:{getUser:async()=>({data:{user:{id:uid}}})},from(table){
  let filters=[],fields="*",op="select",value,single=false;
  const q={select(v){fields=v;return q},eq(k,v){filters.push([k,v]);return q},order(){return q},in(){return q},maybeSingle(){single=true;return q},single(){single=true;return q},update(v){op="update";value=v;return q},insert(v){op="insert";value=v;return q},then(resolve,reject){let data=(tables[table]||[]).filter(r=>filters.every(([k,v])=>r[k]===v));if(op!=="select"){writes.push({table,op,value});if(op==="insert")data=[{id:aid,...value}];}if(op==="select"&&fields!=="*")data=data.map(r=>Object.fromEntries(fields.split(",").filter(k=>k in r).map(k=>[k,r[k]])));return Promise.resolve({data:single?data[0]||null:data,error:null}).then(resolve,reject)} };return q;
 }};
 class OneclickError extends Error{constructor(code,status=403){super(code);this.code=code;this.status=status}}
 const parser={exports:{}};vm.runInNewContext(compile("src/lib/phrasly-extension/session-input.ts"),parser);
 const box={exports:{},URL,Response,process:{env:{PHRASLY_EXTENSION_ENABLED:"true"}},require(name){
  if(name==="node:fs/promises")return {};
  if(name.includes("client.server"))return {supabaseAdmin:db};
  if(name.includes("phrasly-session.server"))return {encryptPhraslySession:s=>"ENC:"+s};
  if(name==="./session-input")return parser.exports;
  if(name==="./backend.server")return {verifiedWriter:async r=>{if(!r.headers.get("authorization"))throw new OneclickError("not_signed_in",401);return uid},writerStatus:async()=>({}),OneclickError,oneclickJson:v=>new Response(JSON.stringify(v))};
  throw Error(name);
 }};
 vm.runInNewContext(compile("src/lib/phrasly-extension/release.server.ts"),box);
 const request=body=>new Request("https://topratedseotools.com/ext-admin",{method:body?"POST":"GET",headers:{authorization:"Bearer fixture"},...(body?{body:JSON.stringify(body)}:{})});
 const base={action:"save_account",account_id:aid,label:"Account 1",target_url:"https://phrasly.ai/dashboard",capacity:null,enabled:true,cookies:""};
 return {api:box.exports,request,base,writes,tables};
}
test("owner sees real assignment counts without saved cookies",async()=>{const f=fixture(),r=await f.api.adminState(f.request()),v=await r.json();assert.equal(v.accounts[0].used,2);assert.equal("encrypted_cookies" in v.accounts[0],false)});
test("metadata save retains encrypted session",async()=>{const f=fixture();await f.api.adminChange(f.request({...f.base,label:"Updated",capacity:4}));const w=f.writes.find(x=>x.op==="update");assert.equal(w.value.capacity,4);assert.equal("encrypted_cookies" in w.value,false)});
test("add encrypts a complete AWS cookie array",async()=>{const f=fixture(),cookie={name:"session",value:"SYNTHETIC",domain:"phrasly.ai",hostOnly:true,path:"/",expirationDate:2000000000,sameSite:"lax"};await f.api.adminChange(f.request({...f.base,action:"add_account",cookies:JSON.stringify([cookie])}));const w=f.writes.find(x=>x.table==="phrasly_oneclick_accounts");assert.equal(w.op,"insert");assert.deepEqual(JSON.parse(w.value.encrypted_cookies.slice(4)).authenticated_cookies,[cookie]);assert.equal(w.value.target_url,"https://phrasly.ai/dashboard")});
test("new account requires valid login cookies",async()=>{const f=fixture();await assert.rejects(f.api.adminChange(f.request({...f.base,action:"add_account"})),/bad_cookie_json/);assert.equal(f.writes.length,0)});
test("foreign, insecure and credential URLs cannot be stored",async()=>{for(const target_url of ["https://evilphrasly.ai/","http://phrasly.ai/","https://user@phrasly.ai/","https://phrasly.ai.evil.test/"]){const f=fixture();await assert.rejects(f.api.adminChange(f.request({...f.base,target_url})),/bad_target_url/);assert.equal(f.writes.length,0)}});
test("writer and signed-out requests cannot administer accounts",async()=>{const f=fixture(false);await assert.rejects(f.api.adminState(f.request()),/forbidden/);await assert.rejects(f.api.adminChange(new Request("https://topratedseotools.com/ext-admin")),/not_signed_in/);assert.equal(f.writes.length,0)});
