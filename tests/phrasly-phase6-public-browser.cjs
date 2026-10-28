/* Public Phase 6 acceptance. No provider generation is requested. */
const fs=require("node:fs"),path=require("node:path"),os=require("node:os"),assert=require("node:assert/strict");
const {execFileSync}=require("node:child_process"),{createHash}=require("node:crypto"),{chromium}=require("playwright");
const dir=process.env.PHRASLY_ACCEPTANCE_PRIVATE_DIR;
const site="https://topratedseotools.com",id="lpgnjkafilbopdojcfnagooojifkccek";
const qa=JSON.parse(fs.readFileSync(path.join(dir,process.env.PHRASLY_BROWSER_USE_OWNER==="true"?"phase6-owner-session.private.json":"phase6-writer-session.private.json"),"utf8"));
const owner=JSON.parse(fs.readFileSync(path.join(dir,"phase6-owner-session.private.json"),"utf8"));
let context;const evidence={utc:new Date().toISOString(),checks:{},errors:[],provider_generation_requests:0,browser_actor:process.env.PHRASLY_BROWSER_USE_OWNER==="true"?"existing_owner_with_explicit_writer_grants":"acceptance_writer"};
(async()=>{
 const temp=fs.mkdtempSync(path.join(dir,"phase6-public-"));
 const extension=path.join(temp,"extension");
 execFileSync("python",["-c","import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])",path.join(dir,"TopRated-Phrasly-Access.zip"),extension]);
 context=await chromium.launchPersistentContext(path.join(temp,"profile"),{channel:"chromium",headless:false,acceptDownloads:true,args:["--disable-extensions-except="+extension,"--load-extension="+extension]});
 const worker=context.serviceWorkers()[0]||await context.waitForEvent("serviceworker",{timeout:15000});assert.equal(new URL(worker.url()).host,id);
 const signedOut=await context.newPage();await signedOut.goto(site+"/phrasly");
 await signedOut.getByRole("heading",{name:"Sign in to open Phrasly",exact:true}).waitFor({timeout:30000});
 evidence.checks.signed_out_page=true;await signedOut.close();
 await context.addInitScript(({site,qa,owner})=>{if(location.origin===site){localStorage.setItem("sb-vuhnvsejdszfvwicflbb-auth-token",JSON.stringify(qa));localStorage.setItem("trst-admin-auth-v1",JSON.stringify(owner));}},{site,qa,owner});
 const writer=await context.newPage();writer.on("pageerror",e=>evidence.errors.push(e.message.slice(0,160)));
 for(const [route,feature]of [["/phrasly","humanizer"],["/phrasly?feature=ai_detector","ai_detector"]]){
  const opened=context.waitForEvent("page",{timeout:30000});
  await writer.goto(site+route);
  const native=await opened;
  await native.waitForURL("https://phrasly.ai/dashboard/"+(feature==="humanizer"?"humanizer":"ai-detector"),{timeout:60000});
  await native.locator("textarea").first().waitFor({timeout:60000});
  evidence.checks[feature+"_native_direct_launch"]=true;
  assert.equal(await writer.getByRole("heading",{name:"Your writer workspace",exact:true}).count(),0);
  assert.equal(await writer.locator("iframe").count(),0);
  if(feature==="humanizer")evidence.provider_plan=await native.evaluate(()=>{const t=document.body.innerText;return {free_plan:/Free plan/.test(t),remaining_words:t.match(/\b[\d,]+ words left\b/)?.[0]||null};});
 }
 evidence.checks.no_extra_writer_dashboard=true;
 const popup=await context.newPage();await popup.goto("chrome-extension://"+id+"/popup.html");
 await popup.locator("#signedIn:not(.hidden)").waitFor({timeout:20000});assert.equal(await popup.locator(".tool").count(),2);evidence.checks.public_popup_identity=true;
 const admin=await context.newPage();admin.on("pageerror",e=>evidence.errors.push(e.message.slice(0,160)));
 await admin.goto(site+"/admin/phrasly");await admin.getByRole("heading",{name:"Writer access",exact:true}).waitFor({timeout:30000});
 await admin.getByRole("heading",{name:"Phrasly account session",exact:true}).waitFor();assert.equal(await admin.getByLabel("Updated Phrasly cookie JSON").inputValue(),"");evidence.checks.owner_admin_page=true;
 assert.deepEqual(evidence.errors,[]);evidence.status="PASS";evidence.extension_id=id;
 await writer.screenshot({path:path.join(temp,"writer-live.png"),fullPage:true});
 console.log(JSON.stringify(evidence));
})().catch(e=>{evidence.status="FAIL";evidence.failure=e.message;console.error(JSON.stringify(evidence));process.exitCode=1;}).finally(async()=>{fs.writeFileSync(path.join(dir,"phase6-public-browser.json"),JSON.stringify(evidence,null,2));if(context)await context.close();});
