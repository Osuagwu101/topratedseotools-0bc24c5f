/* Live acceptance uses an explicitly prepared, temporary owner session.
 * It sends the existing valid provider session back to its same account; no processing is requested.
 */
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict"),{createHash}=require("node:crypto"),{execFileSync}=require("node:child_process"),{chromium}=require("playwright");
const root=path.resolve(__dirname,"../.."),dir=process.env.PHRASLY_EXPORTER_ACCEPTANCE_DIR;
assert.ok(dir,"PHRASLY_EXPORTER_ACCEPTANCE_DIR is required");
const privateFile=path.join(dir,"acceptance.private.json"),data=JSON.parse(fs.readFileSync(privateFile,"utf8"));
const site="https://topratedseotools.com",id="eohjplbcofclaeblcbdaoijfcdjpmmnl",writerId="lpgnjkafilbopdojcfnagooojifkccek";
const exporter=path.join(root,"extensions/phrasly-admin-exporter"),temp=fs.mkdtempSync(path.join(dir,"browser-")),writer=path.join(temp,"writer-extension");
execFileSync("python",["-c","import sys,zipfile;zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])",path.join(dir,"writer-access.zip"),writer]);
const report={utc:new Date().toISOString(),mode:"public_production_existing_account",checks:{},native:{},provider_generation_requests:0};
let context,capturedHash="",saveRequests=0,saveSucceeded=false,guardFailure="";
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

(async()=>{
 context=await chromium.launchPersistentContext(path.join(temp,"profile"),{channel:"chromium",headless:false,acceptDownloads:true,args:["--disable-extensions-except="+exporter,"--load-extension="+exporter]});
 await context.addInitScript(({site,session})=>{if(location.origin===site){localStorage.setItem("sb-vuhnvsejdszfvwicflbb-auth-token",JSON.stringify(session));localStorage.setItem("trst-admin-auth-v1",JSON.stringify(session));}},{site,session:data.session});
 const providerCookies=data.providerCookies.map(c=>{
  const cookie={name:c.name,value:c.value,domain:c.domain,path:c.path||"/",secure:typeof c.secure==="boolean"?c.secure:true,httpOnly:typeof c.httpOnly==="boolean"?c.httpOnly:c.name==="session"};
  const expiry=c.expirationDate??c.expires;if(typeof expiry==="number"&&expiry>Date.now()/1000)cookie.expires=expiry;
  const same={lax:"Lax",strict:"Strict",no_restriction:"None",Lax:"Lax",Strict:"Strict",None:"None"}[c.sameSite];if(same)cookie.sameSite=same;
  return cookie;
 });
 assert.ok(providerCookies.length&&providerCookies.every(c=>c.domain.replace(/^\./,"")==="phrasly.ai"||c.domain.endsWith(".phrasly.ai")));
 await context.addCookies(providerCookies);
 const provider=await context.newPage();await provider.goto("https://phrasly.ai/dashboard/humanizer",{waitUntil:"domcontentloaded",timeout:90000});await provider.bringToFront();await provider.locator("textarea").first().waitFor({timeout:180000});
 report.checks.existing_provider_session_authenticated=true;console.log("PASS existing valid Phrasly account ready for export");
 const worker=context.serviceWorkers().find(w=>new URL(w.url()).host===id)||await context.waitForEvent("serviceworker",{predicate:w=>new URL(w.url()).host===id,timeout:30000});
 const popup=await openPopup(worker,provider);await popup.waitText("#session-status","Session found");
 capturedHash=await popup.evaluate('(async()=>{const cookies=await chrome.cookies.getAll({domain:"phrasly.ai"});const value=cookies.find(c=>c.name==="session")?.value;if(!value)return "";return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value))),x=>x.toString(16).padStart(2,"0")).join("");})()');
 assert.match(capturedHash,/^[a-f0-9]{64}$/);report.observations={captured_session_differs_from_stored_snapshot:capturedHash!==data.sourceSessionHash};
 assert.ok(!(await popup.text("body")).includes("eyJ"));report.checks.cookie_values_hidden_in_popup=true;
 await context.route(site+"/ext-admin",async route=>{
  if(route.request().method()!=="POST")return route.continue();
  try{
   const body=route.request().postDataJSON(),cookies=JSON.parse(body.cookies),session=cookies.find(c=>c.name==="session");
   const valid=body.action==="save_account"&&body.account_id===data.account.id&&body.label===data.account.label&&body.capacity===data.account.capacity&&body.enabled===data.account.enabled&&session&&createHash("sha256").update(session.value).digest("hex")===capturedHash&&!session.value.startsWith("SYNTHETIC")&&saveRequests===0;
   if(!valid)throw new Error("live_save_guard_mismatch");
   saveRequests++;const response=await route.fetch({maxRetries:0});saveSucceeded=response.status()===200;return route.fulfill({response});
  }catch(e){guardFailure="guarded_save_failed";return route.abort();}
 });
 const event=context.waitForEvent("page",{timeout:30000});await popup.click("#send-admin-btn");const admin=await event;
 await admin.waitForURL(u=>u.origin===site&&u.pathname==="/admin/phrasly",{timeout:60000});
 await admin.getByText(/Phrasly cookies received/).waitFor({timeout:45000});
 assert.equal(await admin.getByLabel("Account",{exact:true}).inputValue(),"");assert.equal(await admin.getByRole("button",{name:"Save imported account session",exact:true}).isDisabled(),true);report.checks.live_owner_import_requires_target_selection=true;
 await admin.getByLabel("Account",{exact:true}).selectOption(data.account.id);
 assert.equal(await admin.getByLabel("Label",{exact:true}).inputValue(),data.account.label);
 assert.equal(await admin.getByLabel("Writer capacity (blank for unlimited reuse)",{exact:true}).inputValue(),data.account.capacity===null?"":String(data.account.capacity));
 assert.equal(await admin.getByLabel("Account enabled",{exact:true}).isChecked(),data.account.enabled);
 await admin.getByRole("button",{name:"Save imported account session",exact:true}).click();
 await admin.getByText("Account session updated.",{exact:true}).waitFor({timeout:45000});assert.equal(guardFailure,"");assert.equal(saveRequests,1);assert.equal(saveSucceeded,true);
 report.checks.live_selected_account_session_saved=true;report.checks.existing_account_settings_preserved=true;console.log("PASS real exporter handoff and selected-account save");
 const downloadEvent=admin.waitForEvent("download");await admin.getByRole("link",{name:"Download Admin cookie exporter (.zip)",exact:true}).click();const download=await downloadEvent;const downloaded=path.join(temp,"Osuagwu-Solomon-TopRated.zip");await download.saveAs(downloaded);
 const hash=createHash("sha256").update(fs.readFileSync(downloaded)).digest("hex");assert.equal(hash,"84116055b20c1afc8f3a87a968095c6579730d6f96378bdd2449d975d7708eb7");report.checks.live_browser_download=true;report.package_sha256=hash;
 await context.close();context=null;
 context=await chromium.launchPersistentContext(path.join(temp,"writer-profile"),{channel:"chromium",headless:false,args:["--disable-extensions-except="+writer,"--load-extension="+writer]});
 await context.addInitScript(({site,session})=>{if(location.origin===site){localStorage.setItem("sb-vuhnvsejdszfvwicflbb-auth-token",JSON.stringify(session));localStorage.setItem("trst-admin-auth-v1",JSON.stringify(session));}},{site,session:data.writerSession});
 const tool=await context.newPage();await tool.goto(site+"/tools/phrasly",{waitUntil:"domcontentloaded",timeout:60000});await tool.locator("[data-trst-phrasly-access]").waitFor({timeout:45000});
 for(const [feature,label,url] of [["humanizer","Access Humanizer","https://phrasly.ai/dashboard/humanizer"],["ai_detector","Access AI Detector","https://phrasly.ai/dashboard/ai-detector"]]){
  await tool.bringToFront();const opened=context.waitForEvent("page",{timeout:180000});await tool.locator("[data-trst-phrasly-access]").getByRole("button",{name:label,exact:true}).click();const native=await opened;
  await native.bringToFront();await native.waitForURL(url,{waitUntil:"commit",timeout:60000});await native.locator("textarea").first().waitFor({timeout:180000});
  report.native[feature]={editor_ready:true,path:new URL(native.url()).pathname};console.log("PASS native "+feature+" after account update");
 }
 report.status="PASS";
})().catch(e=>{report.status="FAIL";report.failure=String(e.message).split("\n")[0].slice(0,220);process.exitCode=1;}).finally(async()=>{
 if(context)await context.close();
 for(const [name,session] of [["owner",data.session],["writer",data.writerSession]]){try{const r=await fetch(data.api+"/auth/v1/logout?scope=local",{method:"POST",headers:{apikey:data.publishable,Authorization:"Bearer "+session.access_token},signal:AbortSignal.timeout(30000)});report["temporary_"+name+"_session_revoked"]=r.ok;}catch{report["temporary_"+name+"_session_revoked"]=false;}}
 fs.unlinkSync(privateFile);
 fs.writeFileSync(path.join(dir,"live-acceptance.json"),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
});
