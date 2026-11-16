// Read-only provider verification plus a permitted writer launch/socket handshake.
// Run with the private production environment; never print IDs, cookies or tokens.
import {strict as assert} from "node:assert";
import {createRequire} from "node:module";
import {once} from "node:events";
import {supabaseAdmin} from "../../src/integrations/supabase/client.server";
import {loadEncryptedSession,verifyGrammarlySession,createGrammarlyProxyLaunch} from "../../src/lib/grammarly-proxy.server";
const db=supabaseAdmin as any;
if(process.argv.includes("--diagnose-auth")){
 const {decryptGrammarlySession}=await import("../../src/lib/grammarly-session.server");
 const {grammarlyCookieHeader}=await import("../../src/lib/grammarly-proxy.server");
 const state=JSON.parse(decryptGrammarlySession(await loadEncryptedSession("account_1")));
 const response=await fetch("https://auth.grammarly.com/v3/user",{headers:{Cookie:grammarlyCookieHeader(state,"auth.grammarly.com"),Accept:"application/json"},redirect:"manual"});
 const payload=(response.headers.get("content-type")??"").includes("json")?await response.json():null;
 console.log(JSON.stringify({status:response.status,type:response.headers.get("content-type"),keys:payload?Object.keys(payload):[],id_type:typeof payload?.id,user_keys:payload?.user?Object.keys(payload.user):[],data_keys:payload?.data?Object.keys(payload.data):[]}));process.exit(0);
}
assert(await verifyGrammarlySession(await loadEncryptedSession("account_1")));
console.log("Account 1 authenticated provider check passed.");
if(process.argv.includes("--auth-only"))process.exit(0);
const grants=await db.from("tool_access_grants").select("user_id,expires_at").eq("tool_slug","grammarly").eq("status","active");
if(grants.error)throw Error("Could not find an authorized test writer.");
const grant=grants.data.find((g:any)=>!g.expires_at||Date.parse(g.expires_at)>Date.now());
assert(grant,"An active Grammarly writer grant is required for live launch verification.");
const launch=await createGrammarlyProxyLaunch(grant.user_id);
const entry=await fetch(launch.launchUrl,{redirect:"manual"});assert.equal(entry.status,302);
const cookie=entry.headers.get("set-cookie")!.split(";")[0];
const page=await fetch(launch.proxyPublicOrigin+"/",{headers:{Cookie:cookie},redirect:"manual"});assert.equal(page.status,200);assert((await page.text()).includes("trstGrammarlyAccount"));
console.log("Account 1 fresh authorized writer launch and account-marked page passed.");
const WS=createRequire(import.meta.url)("ws");
const socket=new WS(launch.proxyPublicOrigin.replace("https:","wss:")+"/__ws/capi.grammarly.com/freews",{headers:{Cookie:cookie,Origin:launch.proxyPublicOrigin},handshakeTimeout:20000});
try{await once(socket,"open");console.log("Account 1 live checking WebSocket handshake passed.");}finally{socket.close();}
