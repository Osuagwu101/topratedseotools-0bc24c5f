// Read-only provider verification plus a permitted writer launch/socket handshake.
// Run with the private production environment; never print IDs, cookies or tokens.
import {strict as assert} from "node:assert";
import {createRequire} from "node:module";
import {once} from "node:events";
import {supabaseAdmin} from "../../src/integrations/supabase/client.server";
import {loadEncryptedSession,verifyGrammarlySession,createGrammarlyProxyLaunch} from "../../src/lib/grammarly-proxy.server";
const db=supabaseAdmin as any;
assert(await verifyGrammarlySession(await loadEncryptedSession("account_1")));
console.log("Account 1 authenticated provider check passed.");
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
