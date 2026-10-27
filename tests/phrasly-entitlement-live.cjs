/* Production acceptance with an explicitly supplied temporary verification session.
 * No payment writes, provider processing, credential output or usage-counter changes.
 */
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const {createHash}=require("node:crypto"),{execFileSync}=require("node:child_process"),{chromium}=require("playwright");
const dir=process.env.PHRASLY_ACCEPTANCE_PRIVATE_DIR,site="https://topratedseotools.com";
assert.ok(dir,"PHRASLY_ACCEPTANCE_PRIVATE_DIR is required");
const privateFile=path.join(dir,"target-session.private.json");
const config=JSON.parse(fs.readFileSync(privateFile,"utf8")),session=config.session;
const evidence={utc:new Date().toISOString(),checks:{},native:{},provider_generation_requests:0};
let context;
async function request(route,method="GET"){
 return fetch(site+route,{method,headers:{Authorization:"Bearer "+session.access_token,...(method==="POST"?{"Content-Type":"application/json"}:{})},...(method==="POST"?{body:"{}"}:{}),cache:"no-store"});
}
(async()=>{
 const denied=await fetch(site+"/ext-status");assert.equal(denied.status,401);evidence.checks.signed_out_denied=true;
 const result=await request("/ext-status");assert.equal(result.status,200);
 const status=await result.json();assert.equal(status.ok,true);assert.equal(status.user_id,session.user.id);
 assert.deepEqual(status.features.map(f=>f.key).sort(),["ai_detector","humanizer"]);
 evidence.checks.affected_user_status=true;evidence.allowances=status.features.map(({key,limit,used})=>({key,limit,used}));
 for(const feature of ["humanizer","ai_detector"]){
  const handoff=await request("/ext-handoff.php?tool_id=phrasly&feature="+feature);
  assert.equal(handoff.status,200);const body=await handoff.json();assert.ok(body.ok&&body.payload&&body.signature);
  evidence.checks[feature+"_handoff_authorized"]=true;
 }
 const response=await request("/ext-package","POST");assert.equal(response.status,200);
 const bytes=Buffer.from(await response.arrayBuffer());
 const sha=createHash("sha256").update(bytes).digest("hex");
 assert.equal(sha,"07fb62c132bca769a1b4adc5aec4731ba5f312abbe07b022ce5bb1cbd0f5f3b3");
 evidence.checks.authorized_exact_extension_download=true;evidence.zip_sha256=sha;
 console.log("PASS affected user status, both handoffs and exact enabled extension download");
 const temp=fs.mkdtempSync(path.join(dir,"browser-")),zip=path.join(temp,"extension.zip"),extension=path.join(temp,"extension");
 fs.writeFileSync(zip,bytes);execFileSync("python",["-c","import sys,zipfile;zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])",zip,extension]);
 context=await chromium.launchPersistentContext(path.join(temp,"profile"),{channel:"chromium",headless:false,args:["--disable-extensions-except="+extension,"--load-extension="+extension]});
 await context.addInitScript(({site,session})=>{if(location.origin===site){localStorage.setItem("sb-vuhnvsejdszfvwicflbb-auth-token",JSON.stringify(session));localStorage.setItem("trst-admin-auth-v1",JSON.stringify(session));}},{site,session});
 const worker=context.serviceWorkers()[0]||await context.waitForEvent("serviceworker",{timeout:30000});
 assert.equal(new URL(worker.url()).host,"lpgnjkafilbopdojcfnagooojifkccek");
 const page=await context.newPage();await page.goto(site+"/tools/phrasly",{waitUntil:"domcontentloaded",timeout:60000});
 const panel=page.locator("[data-trst-phrasly-access]");await panel.waitFor({timeout:45000});
 await page.waitForTimeout(1500);
 assert.ok(!(await panel.innerText()).includes("access has not been assigned"));
 evidence.checks.customer_panel_no_false_denial=true;
 for(const [feature,button,url] of [
  ["humanizer","Access Humanizer","https://phrasly.ai/dashboard/humanizer"],
  ["ai_detector","Access AI Detector","https://phrasly.ai/dashboard/ai-detector"]
 ]){
  await page.bringToFront();
  const opened=context.waitForEvent("page",{timeout:180000});
  await panel.getByRole("button",{name:button,exact:true}).click();
  const native=await opened;await native.bringToFront();
  await native.waitForURL(url,{waitUntil:"commit",timeout:60000});
  await native.locator("textarea").first().waitFor({timeout:180000});
  evidence.native[feature]={editor_ready:true,path:new URL(native.url()).pathname};
  console.log("PASS affected user native "+feature+" editor");
 }
 evidence.status="PASS";
})().catch(e=>{evidence.status="FAIL";evidence.failure=String(e.message).split("\n")[0].slice(0,220);process.exitCode=1;}).finally(async()=>{
 if(context)await context.close();
 try{
  const logout=await fetch(config.api+"/auth/v1/logout?scope=local",{method:"POST",headers:{apikey:config.publishable,Authorization:"Bearer "+session.access_token}});
  evidence.temporary_session_revoked=logout.ok;
 }catch{evidence.temporary_session_revoked=false;}
 if(evidence.temporary_session_revoked)fs.unlinkSync(privateFile);
 fs.writeFileSync(path.join(dir,"live-acceptance.json"),JSON.stringify(evidence,null,2));
 console.log(JSON.stringify(evidence,null,2));
});
