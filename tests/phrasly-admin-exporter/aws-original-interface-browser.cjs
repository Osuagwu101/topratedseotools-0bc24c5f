const fs=require("fs"),path=require("path"),assert=require("assert/strict"),{chromium}=require("playwright");
const root=path.resolve(__dirname,"../.."),site="https://topratedseotools.com",ref="https://aws-reference.test";
const shell=JSON.parse(fs.readFileSync(path.join(root,"src/lib/phrasly-extension/aws-admin-shell.server.ts"),"utf8").replace(/^export const AWS_ADMIN_HTML=/,"").replace(/;\s*$/,""));
const uid="00000000-0000-4000-8000-000000000001",aid="10000000-0000-4000-8000-000000000001",bid="10000000-0000-4000-8000-000000000002",cookieJson=JSON.stringify([{name:"session",value:"SYNTHETIC",domain:".phrasly.ai",path:"/"}]).replaceAll("/","\\/"),b64=x=>Buffer.from(JSON.stringify(x)).toString("base64url");
const user={id:uid,email:"owner@example.test",aud:"authenticated",role:"authenticated",app_metadata:{provider:"email"},user_metadata:{},created_at:new Date().toISOString()};
const session={access_token:b64({alg:"HS256",typ:"JWT"})+"."+b64({sub:uid,role:"authenticated",exp:Math.floor(Date.now()/1000)+3600})+".FIXTURE",refresh_token:"FIXTURE",expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,token_type:"bearer",user};
const accounts=[{id:aid,label:"Account 1",target_url:"https://phrasly.ai/dashboard",capacity:null,enabled:true,used:2,cookie_json:cookieJson}],writes=[],errors=[],checks=[];
let browser;
async function layout(page){await page.evaluate(()=>document.fonts.ready);return page.evaluate(()=>{const card=document.querySelector("main .rounded-2xl.border"),form=card.querySelector('form:has(input[value="update_account"])');const es=[document.querySelector("aside"),document.querySelector("header"),document.querySelector("main"),card,...form.querySelectorAll('input:not([type=hidden])'),card.querySelector("textarea"),card.querySelector('form:has(input[value="add_account"])')];return es.map(e=>{const r=e.getBoundingClientRect();return [r.x,r.y,r.width,r.height].map(v=>Math.round(v*10)/10)})})}
(async()=>{browser=await chromium.launch({channel:"chromium",headless:true});const context=await browser.newContext({viewport:{width:1920,height:1080}});context.setDefaultTimeout(20000);
await context.addInitScript(({site,session})=>{if(location.origin===site)localStorage.setItem("trst-admin-auth-v1",JSON.stringify(session))},{site,session});
await context.route("**/*",async route=>{const req=route.request(),u=new URL(req.url()),json=(v,status=200)=>route.fulfill({status,contentType:"application/json",headers:{"Access-Control-Allow-Origin":site,"Access-Control-Allow-Headers":"*"},body:JSON.stringify(v)});
 if(req.method()==="OPTIONS")return json({});
 if(u.origin===site||u.origin===ref){
  if(u.pathname==="/admin/phrasly")return route.fulfill({contentType:"text/html",body:shell});
  if(u.origin===ref&&u.pathname==="/cookie-tools.php")return route.fulfill({contentType:"text/html",body:fs.readFileSync(path.join(root,"reference/phrasly-aws-url-only/admin-interface/rendered-reference-screen.html"),"utf8")});
  if(u.pathname.startsWith("/phrasly-assets/")){const rel=u.pathname.slice("/phrasly-assets/".length);return route.fulfill({path:path.join(root,"public/phrasly-assets",rel),contentType:rel.endsWith(".js")?"application/javascript":rel.endsWith(".webp")?"image/webp":rel.endsWith(".png")?"image/png":"application/octet-stream"})}
  if(u.pathname.startsWith("/assets/img/"))return route.fulfill({path:path.join(root,"public/phrasly-assets/aws",path.basename(u.pathname))});
  if(u.pathname==="/ext-admin"){
   assert.equal(u.searchParams.get("interface"),"aws");
   if(req.method()==="GET")return json({ok:true,owner_id:uid,accounts,staff:[]});
   const body=req.postDataJSON();writes.push(body);assert.equal(body.aws_interface,true);
   if(body.action==="add_account"){if(!body.cookie_json.trim())return json({ok:false,error:"url_and_cookies_required"},400);accounts.push({id:bid,label:body.label,target_url:body.target_url,capacity:body.capacity===""?null:Number(body.capacity),used:0,enabled:true,cookie_json:body.cookie_json});}
   if(body.action==="update_account"){const a=accounts.find(a=>a.id===body.account_id);a.label=body.label;a.target_url=body.target_url;a.capacity=body.capacity===""?null:Number(body.capacity);a.cookie_json=body.cookie_json;}
   if(body.action==="delete_account"){const i=accounts.findIndex(a=>a.id===body.account_id);if(accounts[i].used)return json({ok:false,error:"account_in_use"},409);accounts.splice(i,1);}
   return json({ok:true});
  }
 }
 if(u.hostname.endsWith(".supabase.co")&&u.pathname==="/auth/v1/user")return json(user);
 return route.continue();
});
const page=await context.newPage();page.on("pageerror",e=>errors.push(e.message));
await page.goto(site+"/admin/phrasly",{waitUntil:"domcontentloaded",timeout:60000});await page.locator("main:not([hidden])").waitFor();await page.waitForFunction(()=>getComputedStyle(document.querySelector("aside")).width==="256px");
assert.equal(await page.locator('textarea[name="cookie_json"]').first().inputValue(),cookieJson);assert.equal(await page.getByRole("button",{name:"Remove",exact:true}).count(),0);checks.push("original populated cookie field and assigned-account controls");
const reference=await context.newPage();await reference.goto(ref+"/cookie-tools.php",{waitUntil:"domcontentloaded",timeout:60000});await reference.waitForFunction(()=>getComputedStyle(document.querySelector("aside")).width==="256px");
const actual=await layout(page),expected=await layout(reference);
const maxDelta=Math.max(...actual.flatMap((r,i)=>r.map((v,j)=>Math.abs(v-expected[i][j]))));assert.ok(maxDelta<=1,"AWS layout differs by "+maxDelta+"px");checks.push("original AWS desktop geometry matches within "+maxDelta+"px");
const outDir=path.join(require("os").homedir(),"trst-ops/aws-three-surfaces-qa-20261029");fs.mkdirSync(outDir,{recursive:true});await page.screenshot({path:path.join(outDir,"toprated-synthetic.png"),fullPage:true});await reference.screenshot({path:path.join(outDir,"aws-original-synthetic.png"),fullPage:true});
const update=page.locator('form:has(input[name="action"][value="update_account"])');await update.locator('input[name="label"]').fill("Updated account");await page.locator('button[form="oc-cookie-acct-'+aid+'"]').click();await page.getByText("Account updated.",{exact:true}).waitFor();assert.equal(writes.at(-1).cookie_json,cookieJson);checks.push("original Save submits full configuration");
const add=page.locator('form:has(input[name="action"][value="add_account"])');await add.locator('[name="label"]').fill("Account 2");await add.locator('[name="target_url"]').fill("https://phrasly.ai/dashboard");await add.locator('[name="capacity"]').fill("3");await add.locator('[name="cookie_json"]').fill(cookieJson);await add.getByRole("button",{name:"+ Add account",exact:true}).click();await page.getByText("Account added.",{exact:true}).waitFor();assert.equal(await page.getByRole("button",{name:"Remove",exact:true}).count(),1);checks.push("original Add Account and unused Remove controls");
const before=writes.length;page.once("dialog",d=>d.dismiss());await page.getByRole("button",{name:"Remove",exact:true}).click();assert.equal(writes.length,before);page.once("dialog",d=>d.accept());await page.getByRole("button",{name:"Remove",exact:true}).click();await page.getByText("Account removed.",{exact:true}).waitFor();assert.equal(accounts.length,1);checks.push("original unused-account confirmation and removal");
await page.getByRole("button",{name:"Toggle dark mode",exact:true}).click();assert.equal(await page.locator("html").getAttribute("class"),"dark");await page.getByRole("button",{name:"Toggle dark mode",exact:true}).click();checks.push("original AWS theme toggle");
await page.setViewportSize({width:390,height:844});await page.waitForFunction(()=>getComputedStyle(document.querySelector("aside")).display==="none");await page.getByRole("button",{name:"Toggle menu",exact:true}).click();await page.waitForFunction(()=>getComputedStyle(document.querySelector("aside")).display!=="none");checks.push("original mobile sidebar toggle");
assert.deepEqual(errors,[]);const evidence={status:"PASS",checks,desktop_max_geometry_delta_px:maxDelta,synthetic_accounts_only:true,production_mutations:false};fs.writeFileSync(path.join(outDir,"interface-browser-results.json"),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));await browser.close();
})().catch(async e=>{console.error(e);if(browser)await browser.close();process.exitCode=1});
