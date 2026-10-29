const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict"),{chromium}=require("playwright");
const root=path.resolve(__dirname,"../.."),site="https://topratedseotools.com",saved=[],errors=[],checks=[];
const uid="00000000-0000-4000-8000-000000000001",aid="10000000-0000-4000-8000-000000000001";
const b64=x=>Buffer.from(JSON.stringify(x)).toString("base64url"),token=b64({alg:"HS256",typ:"JWT"})+"."+b64({sub:uid,role:"authenticated",exp:Math.floor(Date.now()/1000)+3600})+".FIXTURE";
const user={id:uid,email:"owner@example.test",aud:"authenticated",role:"authenticated",app_metadata:{provider:"email"},user_metadata:{},created_at:new Date().toISOString()};
const session={access_token:token,refresh_token:"FIXTURE",expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,token_type:"bearer",user};
const accounts=[{id:aid,label:"Account 1",target_url:"https://phrasly.ai/dashboard",capacity:null,enabled:true,used:2}];
let browser;
(async()=>{
 browser=await chromium.launch({channel:"chromium",headless:true});const context=await browser.newContext();context.setDefaultTimeout(15000);
 await context.addInitScript(({site,session})=>{if(location.origin===site)localStorage.setItem("trst-admin-auth-v1",JSON.stringify(session))},{site,session});
 await context.route("**/*",async route=>{const req=route.request(),u=new URL(req.url()),json=(v,status=200)=>route.fulfill({status,contentType:"application/json",headers:{"Access-Control-Allow-Origin":site,"Access-Control-Allow-Headers":"*"},body:JSON.stringify(v)});
 if(req.method()==="OPTIONS")return json({});
 if(u.origin===site){
  if(u.pathname==="/admin/phrasly")return route.fulfill({contentType:"text/html",body:'<!doctype html><link rel="stylesheet" href="/phrasly-assets/workspace.css"><div id="root"></div><script type="module" src="/phrasly-assets/admin-aws-parity-20261029.js"></script>'});
  if(u.pathname.startsWith("/phrasly-assets/"))return route.fulfill({path:path.join(root,"public/phrasly-assets",path.basename(u.pathname)),contentType:u.pathname.endsWith(".js")?"application/javascript":"text/css"});
  if(u.pathname==="/api/public/brand-logo")return route.fulfill({status:204});
  if(u.pathname==="/ext-status")return json({ok:false,error:"no_access"},403);
  if(u.pathname==="/ext-admin"){if(req.method()==="GET")return json({ok:true,owner_id:uid,accounts,staff:[]});const data=req.postDataJSON();saved.push(data);if(data.cookies==="INVALID")return json({ok:false,error:"bad_cookie_json"},400);if(data.action==="add_account")accounts.push({...data,id:"20000000-0000-4000-8000-000000000001",used:0});else Object.assign(accounts.find(a=>a.id===data.account_id),data);return json({ok:true});}
 }
 if(u.hostname.endsWith(".supabase.co")&&u.pathname==="/auth/v1/user")return json(user);return route.abort();});
 const page=await context.newPage();page.on("pageerror",e=>errors.push(e.message));await page.goto(site+"/admin/phrasly");
 await page.getByRole("heading",{name:"Cookie-Based Tools",exact:true}).waitFor();
 const section=page.getByRole("region",{name:"Cookie-Based Tools"});await section.getByRole("button",{name:"Save",exact:true}).waitFor();
 assert.ok(await section.getByText("2 in use (unlimited capacity)",{exact:true}).count());checks.push("AWS account rows and usage visible");
 await section.getByRole("textbox",{name:"Account name",exact:true}).fill("Renamed account");
 await section.getByRole("button",{name:"Save",exact:true}).click();await page.getByText("Account saved.",{exact:true}).waitFor();
 assert.equal(saved.at(-1).cookies,"");assert.equal(saved.at(-1).label,"Renamed account");checks.push("metadata save preserves session");
 await section.getByRole("textbox",{name:"Account cookie JSON",exact:true}).fill("INVALID");await section.getByRole("button",{name:"Save",exact:true}).click();await page.getByRole("alert").waitFor();assert.equal(await section.getByRole("textbox",{name:"Account cookie JSON",exact:true}).inputValue(),"INVALID");checks.push("failed save retains pasted input");
 await section.getByRole("textbox",{name:"Account cookie JSON",exact:true}).fill("");
 await section.getByRole("textbox",{name:"New account name",exact:true}).fill("Account 2");
 await section.getByRole("textbox",{name:"New account cookie JSON",exact:true}).fill('[{"name":"session","value":"SYNTHETIC","domain":"phrasly.ai","path":"/"}]');
 await section.getByRole("spinbutton",{name:"New account capacity",exact:true}).fill("3");
 await section.getByRole("button",{name:"+ Add account",exact:true}).click();await section.getByRole("textbox",{name:"Account name",exact:true}).nth(1).waitFor();assert.equal(saved.at(-1).action,"add_account");assert.equal(saved.at(-1).capacity,3);checks.push("second account creation submits URL capacity and cookies");
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));checks.push("mobile rows fit viewport");
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({status:"PASS",checks}));await browser.close();
})().catch(async e=>{console.error(e);if(browser)await browser.close();process.exitCode=1});
