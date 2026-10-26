/* Verify the actual customer entry, including extension setup and the legacy Launch Phrasly button. */
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict"),{createHash}=require("node:crypto"),{execFileSync}=require("node:child_process"),{chromium}=require("playwright");
const dir=process.env.PHRASLY_ACCEPTANCE_PRIVATE_DIR,site="https://topratedseotools.com",assets=path.resolve("public/phrasly-assets");
const owner=JSON.parse(fs.readFileSync(path.join(dir,"phase6-owner-session.private.json"),"utf8"));
const qa=JSON.parse(fs.readFileSync(path.join(dir,"acceptance-writer.private.json"),"utf8"));
const staged=process.env.PHRASLY_ENTRY_STAGE==="true";
let browser,extensionContext;
const evidence={utc:new Date().toISOString(),mode:staged?"staged_assets_with_real_production_auth_and_backend":"public_production",checks:{},page_errors:[],provider_generation_requests:0};
async function routes(context){
 if(!staged)return;
 await context.route(site+"/**",async route=>{
  const u=new URL(route.request().url());
  if(!u.pathname.startsWith("/phrasly-assets/")&&route.request().resourceType()!=="document")return route.continue();
  try{
  if(u.pathname.startsWith("/phrasly-assets/")){
   const file=path.join(assets,path.basename(u.pathname));if(!fs.existsSync(file))return route.continue();
   return route.fulfill({path:file,contentType:file.endsWith(".css")?"text/css":"application/javascript",headers:{"Cache-Control":"no-store"}});
  }
  const response=await route.fetch();
  if((response.headers()["content-type"]||"").includes("text/html")){
   const bootstrap=fs.readFileSync(path.join(assets,"customer-bootstrap-v1.js"),"utf8").replaceAll("\r","").replaceAll("\n"," ");const tag='<script data-trst-phrasly-bootstrap="1">'+bootstrap+"</script>";
   const body=(await response.text()).replace("</head>",tag+"</head>");
   return route.fulfill({response,body});
  }
  return route.fulfill({response});
  }catch{try{await route.abort();}catch{}}
 });
}
async function seed(context){await context.addInitScript(({site,owner})=>{if(location.origin===site){localStorage.setItem("sb-vuhnvsejdszfvwicflbb-auth-token",JSON.stringify(owner));localStorage.setItem("trst-admin-auth-v1",JSON.stringify(owner));}},{site,owner});}
function errors(page){page.on("pageerror",e=>evidence.page_errors.push(e.message.slice(0,180)));}
(async()=>{
 const temp=fs.mkdtempSync(path.join(dir,"phrasly-customer-entry-"));
 browser=await chromium.launch({channel:"chromium",headless:false});
 const loginContext=await browser.newContext();await routes(loginContext);
 const login=await loginContext.newPage();errors(login);await login.goto(site+"/login",{waitUntil:"domcontentloaded",timeout:60000});
 await login.waitForFunction(()=>{const form=document.querySelector("form");return form&&Object.keys(form).some(key=>key.startsWith("__reactProps$")&&typeof form[key]?.onSubmit==="function");},null,{timeout:60000});
 await login.locator('input[type="email"]').fill(qa.email);await login.locator('input[type="password"]').fill(qa.password);
 await login.locator('button[type="submit"]').click();
 await login.waitForURL(url=>url.pathname!=="/login",{timeout:60000,waitUntil:"commit"});
 const hasSession=await login.evaluate(()=>{try{return !!JSON.parse(localStorage.getItem("sb-vuhnvsejdszfvwicflbb-auth-token")||"null")?.access_token;}catch{return false;}});
 assert.ok(hasSession);evidence.checks.existing_customer_login_storage_verified=true;await loginContext.unrouteAll({behavior:"ignoreErrors"});await loginContext.close();
 const context=await browser.newContext({acceptDownloads:true});await routes(context);await seed(context);
 const tool=await context.newPage();errors(tool);await tool.goto(site+"/tools/phrasly",{waitUntil:"domcontentloaded",timeout:60000});
 const panel=tool.locator("[data-trst-phrasly-access]");await panel.waitFor({timeout:45000});
 assert.equal(await panel.getByRole("button",{name:"Download Extension (.zip)",exact:true}).count(),1);
 const pagesBefore=context.pages().length;
 await tool.getByRole("button",{name:"Launch Phrasly",exact:true}).click();
 await panel.getByRole("status").filter({hasText:"Install the access extension"}).waitFor({timeout:20000});
 assert.equal(context.pages().length,pagesBefore);assert.ok(await panel.locator("details").getAttribute("open")!==null);
 evidence.checks.actual_launch_without_extension_shows_setup_not_provider_login=true;
 assert.ok((await panel.innerText()).includes("Load unpacked"));assert.ok((await panel.innerText()).includes("Developer mode"));assert.ok((await panel.innerText()).includes("extract (unzip)"));
 evidence.checks.aws_style_installation_steps_visible=true;
 const downloadEvent=tool.waitForEvent("download");await panel.getByRole("button",{name:"Download Extension (.zip)",exact:true}).click();
 const download=await downloadEvent,file=path.join(temp,download.suggestedFilename());await download.saveAs(file);
 const sha=b=>createHash("sha256").update(b).digest("hex");
 assert.equal(sha(fs.readFileSync(file)),sha(fs.readFileSync(path.join(dir,"TopRated-Phrasly-Access.zip"))));
 evidence.checks.exact_enabled_zip_downloaded_from_actual_tool_page=true;
 await panel.screenshot({path:path.join(temp,"download-and-installation.png")});
 const dashboard=await context.newPage();errors(dashboard);await dashboard.goto(site+"/dashboard",{waitUntil:"domcontentloaded",timeout:60000});
 await dashboard.locator("[data-trst-phrasly-access]").getByRole("button",{name:"Download Extension (.zip)",exact:true}).waitFor({timeout:45000});
 evidence.checks.customer_dashboard_download_panel=true;console.log("PASS customer login, missing-extension launch, AWS instructions, ZIP and dashboard panel");
 await tool.goto(site+"/tools",{waitUntil:"domcontentloaded",timeout:60000});await tool.locator('a[href="/tools/phrasly"]').first().click();
 await tool.locator("[data-trst-phrasly-access]").waitFor({timeout:30000});evidence.checks.real_catalog_navigation_installs_setup_panel=true;
 await context.unrouteAll({behavior:"ignoreErrors"});await context.close();await browser.close();browser=null;
 const extension=path.join(temp,"extension");execFileSync("python",["-c","import zipfile,sys;zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])",file,extension]);
 extensionContext=await chromium.launchPersistentContext(path.join(temp,"profile"),{channel:"chromium",headless:false,args:["--disable-extensions-except="+extension,"--load-extension="+extension]});
 await routes(extensionContext);await seed(extensionContext);
 const worker=extensionContext.serviceWorkers()[0]||await extensionContext.waitForEvent("serviceworker",{timeout:15000});assert.equal(new URL(worker.url()).host,"lpgnjkafilbopdojcfnagooojifkccek");
 const realTool=await extensionContext.newPage();errors(realTool);await realTool.goto(site+"/tools/phrasly",{waitUntil:"domcontentloaded",timeout:60000});
 await realTool.locator("[data-trst-phrasly-access]").waitFor({timeout:45000});
 const opened=extensionContext.waitForEvent("page",{timeout:180000});await realTool.getByRole("button",{name:"Launch Phrasly",exact:true}).click();
 const native=await opened;await native.waitForURL("https://phrasly.ai/dashboard/humanizer",{waitUntil:"commit",timeout:60000});
 await native.locator("textarea").first().waitFor({timeout:180000});evidence.checks.actual_legacy_launch_opens_authenticated_native_humanizer=true;
 const detectorEvent=extensionContext.waitForEvent("page",{timeout:180000});await realTool.locator("[data-trst-phrasly-access]").getByRole("button",{name:"Access AI Detector",exact:true}).click();
 const detector=await detectorEvent;await detector.waitForURL("https://phrasly.ai/dashboard/ai-detector",{waitUntil:"commit",timeout:60000});await detector.locator("textarea").first().waitFor({timeout:180000});
 evidence.checks.actual_tool_page_opens_authenticated_native_detector=true;
 assert.deepEqual(evidence.page_errors,[]);evidence.status="PASS";console.log(JSON.stringify(evidence));
})().catch(e=>{evidence.status="FAIL";evidence.failure=e.message;console.error(JSON.stringify(evidence));process.exitCode=1;}).finally(async()=>{fs.writeFileSync(path.join(dir,staged?"phrasly-entry-staged.json":"phrasly-entry-public.json"),JSON.stringify(evidence,null,2));if(browser)await browser.close();if(extensionContext)await extensionContext.close();});
