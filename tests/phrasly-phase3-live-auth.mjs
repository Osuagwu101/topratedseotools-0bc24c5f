import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
const url=process.env.SUPABASE_URL,anon=process.env.SUPABASE_PUBLISHABLE_KEY,service=process.env.SUPABASE_SERVICE_ROLE_KEY;
const origin=process.env.STAGING_URL || "http://127.0.0.1:3329";
assert.ok(url&&anon&&service,"local Supabase settings required");
const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
const client=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});
const email="phase3-"+Date.now()+"@example.test",password="Fixture-only-Secret-12345!";
let uid;
try{
 const created=await admin.auth.admin.createUser({email,password,email_confirm:true});
 if(created.error)throw created.error;
 uid=created.data.user.id;
 async function insert(table,record){
  const {error}=await admin.from(table).insert(record);
  if(error)throw new Error(table+": "+error.message);
 }
 await insert("profiles",{id:uid,account_status:"active"});
 await insert("tool_access_grants",{user_id:uid,tool_slug:"phrasly",status:"active"});
 await insert("phrasly_oneclick_feature_grants",{user_id:uid,tool_id:"phrasly",feature_key:"humanizer",daily_limit:2,enabled:true});
 await insert("phrasly_oneclick_tool_config",{tool_id:"phrasly",enabled:true,feature_urls:{humanizer:"https://phrasly.ai/dashboard"},block_paths:["/billing"]});
 const signed=await client.auth.signInWithPassword({email,password});
 if(signed.error)throw signed.error;
 const token=signed.data.session?.access_token;
 assert.ok(token);
 let response=await fetch(origin+"/ext-handoff.php?tool_id=phrasly&feature=humanizer",{headers:{Authorization:"Bearer "+token}});
 assert.equal(response.status,200,"verified Supabase-authenticated route");
 let body=await response.json();
 assert.equal(body.ok,true);
 assert.ok(body.payload&&body.signature);
 response=await fetch(origin+"/ext-session",{method:"POST",headers:{Authorization:"Bearer "+token}});
 assert.equal(response.status,200,"popup bridge created");
 const cookie=response.headers.get("set-cookie")||"";
 const session=cookie.match(/PHPSESSID=([^;]+)/)?.[1];
 assert.ok(session);
 response=await fetch(origin+"/ext-whoami.php",{headers:{"X-Ext-Session":session}});
 assert.equal(response.status,200);
 body=await response.json();
 assert.equal(body.ok,true);
 assert.equal(body.email,email);
 assert.equal(body.tools?.[0]?.features?.[0]?.key,"humanizer");
 let update=await admin.from("tool_access_grants").update({status:"revoked"}).eq("user_id",uid);
 if(update.error)throw update.error;
 response=await fetch(origin+"/ext-handoff.php?tool_id=phrasly&feature=humanizer",{headers:{Authorization:"Bearer "+token}});
 assert.equal(response.status,403,"revoked grant blocked");
 body=await response.json();
 assert.equal(body.error,"no_access");
 console.log("PHRASLY_PHASE3_REAL_GOTRUE_POSTGREST_NITRO_PASS");
}finally{
 if(uid) {
   const result=await admin.auth.admin.deleteUser(uid);
   if(result.error)console.error("fixture cleanup failed",result.error.message);
 }
}
