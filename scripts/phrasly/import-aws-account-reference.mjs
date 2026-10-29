/** Import only the identified Phrasly account and its AWS tool URLs; preserve a private rollback snapshot. */
import fs from "node:fs";
import {createDecipheriv,hkdfSync,createHash} from "node:crypto";
const root="/home/ubuntu/releases/trst-phrasly-aws-exact-20261029";
const settings=JSON.parse(fs.readFileSync(root+"/settings.private.json","utf8"));
const input=globalThis.TRST_REFERENCE;
if(!input||!settings.SUPABASE_URL.includes("vuhnvsejdszfvwicflbb"))throw Error("verified_reference_required");
const base=settings.SUPABASE_URL.replace(/\/$/,""),service=settings.SUPABASE_SERVICE_ROLE_KEY;
async function call(url,method="GET",body,token=service){
 const headers={"Content-Type":"application/json",Authorization:"Bearer "+token};
 if(url.startsWith(base+"/"))headers.apikey=service;
 const r=await fetch(url,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(25000)});
 if(!r.ok)throw Error("import_http_"+r.status);const text=await r.text();return text?JSON.parse(text):null;
}
const accountPath=base+"/rest/v1/phrasly_oneclick_accounts?id=eq."+encodeURIComponent(input.account_id)+"&tool_id=eq.phrasly";
const configPath=base+"/rest/v1/phrasly_oneclick_tool_config?tool_id=eq.phrasly";
const rows=await call(accountPath),configs=await call(configPath);
if(rows.length!==1||configs.length!==1)throw Error("unique_account_and_config_required");
const before=rows[0],configBefore=configs[0],file=root+"/rollback/account-before.private.json";
if(fs.existsSync(file))throw Error("reference_import_already_attempted");
fs.writeFileSync(file,JSON.stringify({account:before,config:configBefore}),{mode:0o600});
const cookies=JSON.parse(input.source.cookie_json);
try{
 await call("http://127.0.0.1:3344/ext-admin","POST",{action:"save_account",account_id:before.id,label:before.label,target_url:input.source.target_url,capacity:before.capacity,enabled:before.enabled,cookies:JSON.stringify(cookies)},input.owner_token);
 await call(configPath,"PATCH",{feature_urls:JSON.parse(input.config.cookie_feature_urls||"{}"),block_paths:JSON.parse(input.config.block_paths||"[]")});
 const after=(await call(accountPath))[0],envelope=JSON.parse(after.encrypted_cookies),raw=settings.PHRASLY_SESSION_ENCRYPTION_KEY||"";
 const key=raw?Buffer.from(raw,/^[0-9a-f]{64}$/i.test(raw)?"hex":"base64"):Buffer.from(hkdfSync("sha256",Buffer.from(service),Buffer.from("topratedseotools"),Buffer.from("phrasly-session-encryption:v1"),32));
 const d=createDecipheriv("aes-256-gcm",key,Buffer.from(envelope.iv,"base64"));d.setAAD(Buffer.from("topratedseotools:phrasly:session_state_json:v1"));d.setAuthTag(Buffer.from(envelope.tag,"base64"));
 const state=JSON.parse(Buffer.concat([d.update(Buffer.from(envelope.ct,"base64")),d.final()]).toString("utf8"));
 if(JSON.stringify(state.authenticated_cookies)!==JSON.stringify(cookies))throw Error("cookie_roundtrip_changed");
 if(after.label!==before.label||after.capacity!==before.capacity||after.enabled!==before.enabled)throw Error("account_metadata_changed");
 const result={status:"PASS",source:"live AWS reference",cookies: cookies.length,full_array_preserved:true,account_metadata_preserved:true,financial_mutations:false,schema_changes:false,bundle_sha256:createHash("sha256").update(JSON.stringify(cookies)).digest("hex")};
 fs.writeFileSync(root+"/reference-import-evidence.json",JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}catch(e){
 await call(accountPath,"PATCH",{target_url:before.target_url,encrypted_cookies:before.encrypted_cookies,label:before.label,capacity:before.capacity,enabled:before.enabled});
 await call(configPath,"PATCH",{feature_urls:configBefore.feature_urls,block_paths:configBefore.block_paths});throw e;
}
