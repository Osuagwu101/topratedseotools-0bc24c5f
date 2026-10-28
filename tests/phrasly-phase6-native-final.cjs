/* Native public release verification; traces only URL paths/status, never bodies/tokens. */
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict"),{execFileSync}=require("node:child_process"),{chromium}=require("playwright");
const dir=process.env.PHRASLY_ACCEPTANCE_PRIVATE_DIR,site="https://topratedseotools.com",id="lpgnjkafilbopdojcfnagooojifkccek";
const session=JSON.parse(fs.readFileSync(path.join(dir,"phase6-owner-session.private.json"),"utf8"));
let context;const evidence={utc:new Date().toISOString(),checks:{},native:{},page_errors:[],provider_generation_requests:0,actor:"existing_owner_with_explicit_writer_grants"};
(async()=>{
 const temp=fs.mkdtempSync(path.join(dir,"phase6-native-final-")),extension=path.join(temp,"extension");
 execFileSync("python",["-c","import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])",path.join(dir,"TopRated-Phrasly-Access.zip"),extension]);
 context=await chromium.launchPersistentContext(path.join(temp,"profile"),{channel:"chromium",headless:false,args:["--disable-extensions-except="+extension,"--load-extension="+extension]});
 const pending=new Map(),resources=[];
 context.on("request",r=>{try{const u=new URL(r.url());if(u.protocol.startsWith("http"))pending.set(r,{path:u.origin+u.pathname,type:r.resourceType()});}catch{}});
 context.on("requestfinished",r=>pending.delete(r));
 context.on("requestfailed",r=>{const info=pending.get(r);pending.delete(r);if(info)resources.push({...info,error:r.failure()?.errorText});});
 context.on("response",r=>{const u=new URL(r.url());if(r.status()>=400||r.request().resourceType()==="fetch"||r.request().resourceType()==="xhr")resources.push({path:u.origin+u.pathname,status:r.status()});});
 context.on("page",p=>p.on("pageerror",e=>evidence.page_errors.push({url:p.url().split("?")[0],message:e.message.slice(0,180)})));
 const worker=context.serviceWorkers()[0]||await context.waitForEvent("serviceworker");assert.equal(new URL(worker.url()).host,id);
 const signed=await context.newPage();await signed.goto(site+"/phrasly");await signed.getByRole("heading",{name:"Sign in to open Phrasly",exact:true}).waitFor();evidence.checks.signed_out_page=true;await signed.close();
 await context.addInitScript(({site,session})=>{if(location.origin===site){localStorage.setItem("sb-vuhnvsejdszfvwicflbb-auth-token",JSON.stringify(session));localStorage.setItem("trst-admin-auth-v1",JSON.stringify(session));}},{site,session});
 const admin=await context.newPage();await admin.goto(site+"/admin/phrasly");await admin.getByRole("heading",{name:"Writer access",exact:true}).waitFor();await admin.getByRole("heading",{name:"Phrasly account session",exact:true}).waitFor();assert.equal(await admin.getByLabel("Updated Phrasly cookie JSON").inputValue(),"");evidence.checks.owner_admin_controls=true;
 const writer=await context.newPage(),nativePages=[];
 for(const [route,feature]of [["/phrasly","humanizer"],["/phrasly?feature=ai_detector","ai_detector"]]){
  const opened=context.waitForEvent("page",{timeout:30000});await writer.goto(site+route);const native=await opened;
  const url="https://phrasly.ai/dashboard/"+(feature==="humanizer"?"humanizer":"ai-detector");await native.waitForURL(url,{timeout:60000,waitUntil:"commit"});
  assert.equal(await writer.getByRole("heading",{name:"Your writer workspace",exact:true}).count(),0);assert.equal(await writer.locator("iframe").count(),0);
  evidence.checks[feature+"_native_auto_launch"]=true;nativePages.push([feature,native]);console.log("PASS automatic native "+feature);
 }
 evidence.checks.no_writer_dashboard=true;
 const popup=await context.newPage();await popup.goto("chrome-extension://"+id+"/popup.html");await popup.locator("#signedIn:not(.hidden)").waitFor({timeout:20000});assert.equal(await popup.locator(".tool").count(),2);evidence.checks.extension_popup=true;
 for(const [feature,native]of nativePages){
  await native.bringToFront();
  try{await native.locator("textarea").first().waitFor({timeout:180000});evidence.native[feature]={editor_ready:true,url:native.url()};}
  catch{evidence.native[feature]={editor_ready:false,url:native.url(),title:await native.title(),pending:[...pending.values()].slice(-30),resources:resources.filter(x=>x.path.startsWith("https://phrasly.ai/")||x.error).slice(-65),state:await native.evaluate(()=>({ready:document.readyState,visible:document.visibilityState,scripts:document.scripts.length,textareas:document.querySelectorAll("textarea").length}))};await native.screenshot({path:path.join(temp,feature+"-loading.png")});}
  console.log(JSON.stringify({feature,result:evidence.native[feature]}));
 }
 if(Object.values(evidence.native).some(x=>!x.editor_ready)){
  const bare=await chromium.launch({channel:"chromium",headless:false});
  try{const control=await bare.newContext();await control.addCookies(await context.cookies("https://phrasly.ai"));const page=await control.newPage();await page.goto("https://phrasly.ai/dashboard/humanizer",{waitUntil:"domcontentloaded"});await page.bringToFront();let ready=false;try{await page.locator("textarea").first().waitFor({timeout:180000});ready=true;}catch{}evidence.without_extension_control={editor_ready:ready,url:page.url(),title:await page.title()};console.log(JSON.stringify({control:evidence.without_extension_control}));}finally{await bare.close();}
 }
 assert.deepEqual(evidence.page_errors,[]);
 const ready=Object.values(evidence.native).every(x=>x.editor_ready);
 evidence.status=ready?"PASS":"NATIVE_EDITOR_BLOCKED";console.log(JSON.stringify(evidence));if(!ready)process.exitCode=2;
})().catch(e=>{evidence.status="FAIL";evidence.failure=e.message;console.error(JSON.stringify(evidence));process.exitCode=1;}).finally(async()=>{fs.writeFileSync(path.join(dir,"phase6-native-final-browser.json"),JSON.stringify(evidence,null,2));if(context)await context.close();});
