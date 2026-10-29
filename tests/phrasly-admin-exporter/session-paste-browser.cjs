const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'../..'),site='https://topratedseotools.com',checks=[],saved=[],errors=[];
const uid='00000000-0000-4000-8000-000000000001',aid='10000000-0000-4000-8000-000000000001',bid='10000000-0000-4000-8000-000000000002';
const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url'),token=b64({alg:'HS256',typ:'JWT'})+'.'+b64({sub:uid,role:'authenticated',exp:Math.floor(Date.now()/1000)+3600})+'.FIXTURE';
const user={id:uid,email:'owner@example.test',aud:'authenticated',role:'authenticated',app_metadata:{provider:'email'},user_metadata:{},created_at:new Date().toISOString()};
const session={access_token:token,refresh_token:'FIXTURE_REFRESH',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,token_type:'bearer',user};
const accounts=[{id:aid,label:'Account Alpha',capacity:null,enabled:true},{id:bid,label:'Account Beta',capacity:4,enabled:true}],features=['humanizer','ai_detector'].map(feature_key=>({feature_key,daily_limit:20,is_unlimited:true,enabled:true}));
let browser;
(async()=>{
 browser=await chromium.launch({channel:'chromium',headless:true});const context=await browser.newContext();context.setDefaultTimeout(15000);
 await context.addInitScript(({site,session})=>{if(location.origin===site)localStorage.setItem('trst-admin-auth-v1',JSON.stringify(session));},{site,session});
 await context.route('**/*',async route=>{const req=route.request(),u=new URL(req.url()),json=(v,status=200)=>route.fulfill({status,contentType:'application/json',headers:{'Access-Control-Allow-Origin':site,'Access-Control-Allow-Headers':'*'},body:JSON.stringify(v)});
 if(req.method()==='OPTIONS')return json({});
 if(u.origin===site){
  if(u.pathname==='/admin/phrasly'&&process.env.PHRASLY_TEST_LIVE_ASSETS==='1')return route.continue();
  if(u.pathname==='/admin/phrasly')return route.fulfill({contentType:'text/html',body:'<!doctype html><div id="root"></div><script type="module" src="/phrasly-assets/admin.js"></script>'});
  if(u.pathname.startsWith('/phrasly-assets/')&&process.env.PHRASLY_TEST_LIVE_ASSETS==='1')return route.continue();
  if(u.pathname.startsWith('/phrasly-assets/'))return route.fulfill({path:path.join(root,'public/phrasly-assets',path.basename(u.pathname)),contentType:u.pathname.endsWith('.js')?'application/javascript':'text/css'});
  if(u.pathname==='/api/public/brand-logo')return route.fulfill({status:204});
  if(u.pathname==='/ext-status')return json({ok:false,error:'no_access'},403);
  if(u.pathname==='/ext-admin'){
   if(req.method()==='GET')return json({ok:true,owner_id:uid,accounts,staff:[{id:uid,email:'owner@example.test',features}]});
   const data=req.postDataJSON();saved.push(data);
   if(data.action==='set_limit'){const f=features.find(f=>f.feature_key===data.feature);f.is_unlimited=data.limit===null;if(data.limit!==null)f.daily_limit=data.limit;}
   if(data.action==='save_account'&&data.cookies==='INVALID_FIXTURE')return json({ok:false,error:'bad_cookie_json'},400);
   return json({ok:true});
  }
 }
 if(u.hostname.endsWith('.supabase.co')&&u.pathname==='/auth/v1/user')return json(user);
 return route.abort();});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(site+'/admin/phrasly');
 const account=page.getByRole('combobox',{name:'Account',exact:true}),paste=page.getByRole('textbox',{name:'Updated Phrasly cookies / session',exact:true}),save=page.getByRole('button',{name:'Save encrypted account session',exact:true});
 await account.selectOption(bid);await paste.fill('SYNTHETIC_SESSION');
 await page.evaluate(session=>{const bc=new BroadcastChannel('trst-admin-auth-v1');bc.postMessage({event:'TOKEN_REFRESHED',session});setTimeout(()=>bc.close(),100);},session);
 await page.getByRole('heading',{name:'Phrasly account session',exact:true}).waitFor();
 assert.equal(await account.inputValue(),bid);assert.equal(await paste.inputValue(),'SYNTHETIC_SESSION');checks.push('auth refresh retains selected account and pasted session');
 assert.equal(await page.getByRole('button',{name:/Save limit|Remove limit/}).count(),0);
 assert.equal(await page.getByText('Requests per day',{exact:true}).count(),0);
 checks.push('daily limit settings removed from this page');
 await save.click();await page.getByRole('status').filter({hasText:'Account session updated.'}).waitFor();assert.equal(saved.at(-1).account_id,bid);assert.equal(saved.at(-1).cookies,'SYNTHETIC_SESSION');assert.equal(saved.at(-1).capacity,4);assert.equal(await paste.inputValue(),'');checks.push('raw session save targets selected account and clears after success');
 const cookies=JSON.stringify([{name:'session',value:'SYNTHETIC_JSON',domain:'phrasly.ai',path:'/'}]);await paste.fill(cookies);await save.click();await page.getByRole('status').filter({hasText:'Account session updated.'}).waitFor();assert.equal(saved.at(-1).cookies,cookies);checks.push('full JSON copy paste saves');
 await paste.fill('INVALID_FIXTURE');await save.click();await page.getByRole('alert').waitFor();assert.equal(await paste.inputValue(),'INVALID_FIXTURE');checks.push('failed save retains input and explains accepted formats');
 assert.equal(features[1].is_unlimited,true);assert.equal(await page.getByRole('link',{name:'Download Admin cookie exporter (.zip)',exact:true}).count(),1);checks.push('unlimited settings and exporter remain available');assert.deepEqual(errors,[]);
 await page.getByRole('textbox',{name:'Writer email',exact:true}).fill('new@example.test');await page.getByRole('button',{name:'Save writer access',exact:true}).click();await page.getByRole('status').filter({hasText:'Writer access saved.'}).waitFor();
 assert.equal(saved.at(-1).humanizer,null);assert.equal(saved.at(-1).ai_detector,null);checks.push('new writer assignments default to unlimited');
 await context.addInitScript(()=>{window.chrome=window.chrome||{};window.chrome.runtime={sendMessage:(_id,_msg,cb)=>cb({ok:true,cookies:[{name:'session',value:'IMPORTED_FIXTURE',domain:'phrasly.ai',path:'/'}],capturedAt:Date.now()})};});
 const imported=await context.newPage();imported.on('pageerror',e=>errors.push(e.message));await imported.goto(site+'/admin/phrasly#cookie-import='+'a'.repeat(64));
 await imported.getByRole('button',{name:'Save imported account session',exact:true}).waitFor();
 assert.equal(await imported.getByRole('combobox',{name:'Account',exact:true}).inputValue(),aid);
 assert.equal(await imported.getByRole('button',{name:'Save imported account session',exact:true}).isEnabled(),true);checks.push('import automatically selects the existing account and enables Save');
 await imported.getByRole('button',{name:'Save imported account session',exact:true}).click();await imported.getByRole('status').filter({hasText:'Account session updated.'}).waitFor();assert.equal(saved.at(-1).account_id,aid);assert.equal(JSON.parse(saved.at(-1).cookies)[0].value,'IMPORTED_FIXTURE');assert.equal(saved.at(-1).label,'Account Alpha');assert.equal(saved.at(-1).capacity,null);checks.push('imported cookies save with existing account settings');
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({status:'PASS',mode:process.env.PHRASLY_TEST_LIVE_ASSETS==='1'?'live_public_assets_synthetic_private_apis':'synthetic_offline_fixture',checks:checks.length,cases:checks,page_errors:errors}));
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();});
