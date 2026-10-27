/* Real Chromium MV3 integration, entirely synthetic accounts/cookies and routed APIs. */
const fs=require("node:fs"),os=require("node:os"),path=require("node:path"),assert=require("node:assert/strict"),{createHash}=require("node:crypto"),{chromium}=require("playwright");
const root=path.resolve(__dirname,"../.."),extension=path.join(root,"extensions/phrasly-admin-exporter"),assets=path.join(root,"public/phrasly-assets"),id="eohjplbcofclaeblcbdaoijfcdjpmmnl",site="https://topratedseotools.com";
const report={status:"RUNNING",mode:"synthetic_offline_fixture",checks:{},page_errors:[],external_network_requests:0};
const temp=fs.mkdtempSync(path.join(os.tmpdir(),"toprated-admin-exporter-"));let context,role="owner",saved=[],ownerGets=0;
const uid="00000000-0000-4000-8000-000000000001";
const b64=x=>Buffer.from(JSON.stringify(x)).toString("base64url");
const token=b64({alg:"HS256",typ:"JWT"})+"."+b64({sub:uid,role:"authenticated",aud:"authenticated",iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600})+".SYNTHETIC_SIGNATURE";
const user={id:uid,email:"admin@example.test",aud:"authenticated",role:"authenticated",app_metadata:{provider:"email",providers:["email"]},user_metadata:{full_name:"Fixture Admin"},created_at:new Date().toISOString()};
const session={access_token:token,refresh_token:"SYNTHETIC_REFRESH",token_type:"bearer",expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,user};
const accounts=[{id:"00000000-0000-4000-8000-000000000010",label:"Account Alpha",target_url:"https://phrasly.ai/dashboard",capacity:4,enabled:true},{id:"00000000-0000-4000-8000-000000000011",label:"Account Beta",target_url:"https://phrasly.ai/dashboard",capacity:9,enabled:true}];
const json=(route,data,status=200)=>route.fulfill({status,contentType:"application/json",headers:{"Access-Control-Allow-Origin":site,"Access-Control-Allow-Headers":"*","Access-Control-Allow-Methods":"GET,POST,OPTIONS","Cache-Control":"no-store"},body:JSON.stringify(data)});
async function openPopup(worker,provider){
 await provider.bringToFront();
 const cdp=await context.browser().newBrowserCDPSession();
 await worker.evaluate(()=>chrome.action.openPopup());
 let target;const deadline=Date.now()+15000;
 while(Date.now()<deadline&&!target){target=(await cdp.send("Target.getTargets")).targetInfos.find(t=>t.url==="chrome-extension://"+id+"/popup.html");if(!target)await new Promise(r=>setTimeout(r,100));}
 assert.ok(target,"actual Chrome action popup target exists");
 const {sessionId}=await cdp.send("Target.attachToTarget",{targetId:target.targetId,flatten:false});
 let sequence=0;const requests=new Map();
 cdp.on("Target.receivedMessageFromTarget",event=>{
  if(event.sessionId!==sessionId)return;const result=JSON.parse(event.message),pending=requests.get(result.id);if(!pending)return;
  requests.delete(result.id);clearTimeout(pending.timer);if(result.error)pending.reject(new Error(result.error.message));else pending.resolve(result.result);
 });
 async function command(method,params={}){
  const requestId=++sequence;
  return new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>{requests.delete(requestId);reject(new Error("Popup command timeout: "+method));},10000);
   requests.set(requestId,{resolve,reject,timer});
   cdp.send("Target.sendMessageToTarget",{sessionId,message:JSON.stringify({id:requestId,method,params})}).catch(e=>{clearTimeout(timer);requests.delete(requestId);reject(e);});
  });
 }
 async function evaluate(expression){
  const result=await command("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true,userGesture:true});
  if(result.exceptionDetails)throw new Error("Popup evaluation failed");return result.result.value;
 }
 async function text(selector){return evaluate("document.querySelector("+JSON.stringify(selector)+")?.innerText||''");}
 async function waitText(selector,expected){
  const until=Date.now()+15000;while(Date.now()<until){if((await text(selector)).includes(expected))return;await new Promise(r=>setTimeout(r,80));}
  throw new Error("Popup text not ready: "+selector);
 }
 return {evaluate,text,waitText,click:selector=>evaluate("document.querySelector("+JSON.stringify(selector)+").click()")};
}
async function pending(worker){return worker.evaluate(async()=>{const p=(await chrome.storage.session.get("phraslyPendingImport")).phraslyPendingImport;return p?{nonce:p.nonce,tabId:p.tabId,count:p.cookies.length}:null;});}
(async()=>{
 context=await chromium.launchPersistentContext(path.join(temp,"profile"),{channel:"chromium",headless:false,acceptDownloads:true,args:["--disable-extensions-except="+extension,"--load-extension="+extension]});
 await context.grantPermissions(["clipboard-read","clipboard-write"]);
 await context.route("**/*",async route=>{
  const request=route.request(),u=new URL(request.url());
  if(u.protocol==="chrome-extension:")return route.continue();
  if(request.method()==="OPTIONS")return json(route,{});
  if(u.origin===site){
   if(u.pathname==="/admin/phrasly")return route.fulfill({contentType:"text/html",body:'<!doctype html><html><head><meta charset="utf-8"><title>Phrasly administration</title><link rel="stylesheet" href="/phrasly-assets/workspace.css"></head><body><div id="root"></div><script type="module" src="/phrasly-assets/admin.js"></script></body></html>'});
   if(u.pathname.startsWith("/phrasly-assets/")){
    const file=path.join(assets,path.basename(u.pathname));if(!fs.existsSync(file))return route.fulfill({status:404,body:"missing fixture asset"});
    return route.fulfill({path:file,contentType:file.endsWith(".js")?"application/javascript":file.endsWith(".css")?"text/css":"application/zip"});
   }
   if(u.pathname==="/api/public/brand-logo")return route.fulfill({path:path.join(extension,"icons/icon128.png"),contentType:"image/png"});
   if(u.pathname==="/ext-status")return json(route,{ok:false,error:"no_access"},403);
   if(u.pathname==="/ext-admin"){
    assert.equal(request.headers().authorization,"Bearer "+token);
    if(role!=="owner")return json(route,{ok:false,error:"forbidden"},403);
    if(request.method()==="GET"){ownerGets++;return json(route,{ok:true,owner_id:uid,accounts,staff:[]});}
    const body=request.postDataJSON();assert.equal(body.action,"save_account");saved.push(body);return json(route,{ok:true});
   }
   if(u.pathname==="/dashboard")return route.fulfill({contentType:"text/html",body:"<!doctype html><title>Fixture customer page</title><p>Customer page</p>"});
  }
  if(u.hostname==="phrasly.ai")return route.fulfill({contentType:"text/html",body:"<!doctype html><title>Phrasly fixture</title><h1>Signed-in Phrasly fixture</h1><textarea></textarea>"});
  if(u.hostname==="vuhnvsejdszfvwicflbb.supabase.co"&&u.pathname==="/auth/v1/token")return json(route,session);
  if(u.hostname==="vuhnvsejdszfvwicflbb.supabase.co"&&u.pathname==="/auth/v1/user")return json(route,user);
  report.external_network_requests++;return route.abort();
 });
 context.on("page",page=>page.on("pageerror",e=>report.page_errors.push(e.message.slice(0,160))));
 await context.addCookies([
  {name:"session",value:"SYNTHETIC_PHRASLY_SESSION",domain:".phrasly.ai",path:"/",secure:true,httpOnly:true,sameSite:"Lax",expires:Math.floor(Date.now()/1000)+3600},
  {name:"theme",value:"light",domain:"phrasly.ai",path:"/",secure:true,sameSite:"Lax"},
  {name:"payload_cookie",value:"<b>HIDDEN_FIXTURE</b>",domain:".phrasly.ai",path:"/",secure:true}
 ]);
 const provider=await context.newPage();await provider.goto("https://phrasly.ai/dashboard");
 const worker=context.serviceWorkers()[0]||await context.waitForEvent("serviceworker",{timeout:20000});assert.equal(new URL(worker.url()).host,id);
 const popup=await openPopup(worker,provider);
 await popup.waitText("#cookie-count","3 Phrasly cookies");
 assert.ok(!(await popup.text("body")).includes("SYNTHETIC_PHRASLY_SESSION"));
 assert.ok(!(await popup.text("body")).includes("HIDDEN_FIXTURE"));
 report.checks.cookie_names_without_secret_values=true;
 await popup.click("#copy-json-btn");
 await popup.waitText("#status-message","Complete cookie JSON copied.");
 const copied=JSON.parse(await popup.evaluate("navigator.clipboard.readText()"));
 assert.equal(copied.length,3);assert.equal(copied.find(c=>c.name==="session").httpOnly,true);assert.equal(copied.find(c=>c.name==="session").domain,".phrasly.ai");assert.ok(copied.every(c=>"storeId" in c&&"sameSite" in c&&"path" in c));
 report.checks.copy_full_json_with_metadata=true;

 const opened=context.waitForEvent("page");await popup.click("#send-admin-btn");const admin=await opened;
 await admin.waitForURL(url=>url.origin===site&&url.pathname==="/admin/phrasly"&&url.hash.startsWith("#cookie-import="));
 const nonce=new URL(admin.url()).hash.split("=")[1];assert.match(nonce,/^[a-f0-9]{64}$/);assert.ok(!admin.url().includes("SYNTHETIC"));
 await admin.getByRole("heading",{name:"Sign in to TopRated",exact:true}).waitFor();
 assert.equal(ownerGets,0);assert.ok(await pending(worker));report.checks.admin_sign_in_before_claim=true;
 await admin.getByLabel("Email",{exact:true}).fill("admin@example.test");await admin.getByLabel("Password",{exact:true}).fill("fixture-password");
 await admin.getByRole("button",{name:"Sign in",exact:true}).click();
 await admin.getByText("3 Phrasly cookies received",{exact:true}).waitFor({timeout:30000});
 assert.equal(await admin.getByLabel("Account",{exact:true}).inputValue(),"");
 assert.equal(await admin.getByRole("button",{name:"Save imported account session",exact:true}).isDisabled(),true);
 assert.equal(new URL(admin.url()).hash,"");
 assert.equal(await pending(worker),null);
 assert.equal(await admin.locator("textarea").count(),0);
 report.checks.authenticated_one_time_claim_hidden_values_and_explicit_target=true;
 const second=accounts[1];await admin.getByLabel("Account",{exact:true}).selectOption(second.id);
 assert.equal(await admin.getByLabel("Label",{exact:true}).inputValue(),second.label);assert.equal(await admin.getByLabel("Writer capacity (blank for unlimited reuse)",{exact:true}).inputValue(),"9");
 await admin.getByRole("button",{name:"Save imported account session",exact:true}).click();
 await admin.getByText("Account session updated.",{exact:true}).waitFor();
 assert.equal(saved.length,1);assert.equal(saved[0].account_id,second.id);assert.equal(saved[0].label,second.label);assert.equal(saved[0].capacity,second.capacity);assert.equal(saved[0].enabled,second.enabled);
 const payload=JSON.parse(saved[0].cookies);assert.deepEqual(payload,copied);
 report.checks.selected_account_and_settings_preserved_on_save=true;
 const replay=await admin.evaluate(({id,nonce})=>new Promise(resolve=>chrome.runtime.sendMessage(id,{type:"TOPRATED_PHRASLY_COOKIE_IMPORT",version:1,nonce},result=>{void chrome.runtime.lastError;resolve(result);})),{id,nonce});
 assert.equal(replay.error,"import_expired");assert.equal(replay.cookies,undefined);report.checks.replay_returns_no_cookies=true;
 const downloadLink=admin.getByRole("link",{name:"Download Admin cookie exporter (.zip)",exact:true});assert.equal(await downloadLink.getAttribute("download"),"Osuagwu-Solomon-TopRated.zip");assert.equal(await downloadLink.getAttribute("href"),"/phrasly-assets/Osuagwu-Solomon-TopRated.zip");
 const downloaded=Buffer.from(await admin.evaluate(async()=>Array.from(new Uint8Array(await (await fetch("/phrasly-assets/Osuagwu-Solomon-TopRated.zip")).arrayBuffer()))));
 const sha=data=>createHash("sha256").update(data).digest("hex");assert.equal(sha(downloaded),sha(fs.readFileSync(path.join(assets,"Osuagwu-Solomon-TopRated.zip"))));report.checks.admin_download_link_and_package_bytes=true;
 role="writer";const popup2=await openPopup(worker,provider);await popup2.waitText("#cookie-count","3 Phrasly cookies");const event2=context.waitForEvent("page");await popup2.click("#send-admin-btn");const denied=await event2;await denied.waitForURL(url=>url.origin===site&&url.pathname==="/admin/phrasly");
 await denied.getByText("This page is available to the account owner.",{exact:true}).waitFor();assert.ok(await pending(worker));assert.equal(saved.length,1);report.checks.non_owner_cannot_receive_or_save_via_admin_ui=true;
 const remaining=await pending(worker),other=await context.newPage();await other.goto(site+"/dashboard");
 const rejected=await other.evaluate(({id,nonce})=>new Promise(resolve=>chrome.runtime.sendMessage(id,{type:"TOPRATED_PHRASLY_COOKIE_IMPORT",version:1,nonce},r=>{void chrome.runtime.lastError;resolve(r);})),{id,nonce:remaining.nonce});
 assert.equal(rejected.error,"untrusted_import");assert.equal(rejected.cookies,undefined);assert.ok(await pending(worker));report.checks.other_page_and_tab_cannot_take_handoff=true;
 assert.deepEqual(report.page_errors,[]);assert.equal(report.external_network_requests,0);
 report.status="PASS";console.log(JSON.stringify(report,null,2));
})().catch(e=>{report.status="FAIL";report.failure=String(e.stack||e.message).split("\n").slice(0,7).join("\n");console.error(JSON.stringify(report,null,2));process.exitCode=1;}).finally(async()=>{if(context)await context.close();fs.writeFileSync(path.join(temp,"browser-report.json"),JSON.stringify(report,null,2));console.log("Fixture evidence: "+temp);});
