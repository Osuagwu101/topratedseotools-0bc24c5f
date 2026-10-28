const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const site='https://topratedseotools.com',root=path.resolve(__dirname,'../..'),uid='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002',checks=[],saved=[],errors=[];
const b64=x=>Buffer.from(JSON.stringify(x)).toString('base64url'),token=b64({alg:'HS256',typ:'JWT'})+'.'+b64({sub:uid,role:'authenticated',exp:Math.floor(Date.now()/1000)+3600})+'.FIXTURE';
const user={id:uid,email:'owner@example.test',aud:'authenticated',role:'authenticated',app_metadata:{provider:'email'},user_metadata:{},created_at:new Date().toISOString()};
const session={access_token:token,refresh_token:'FIXTURE_REFRESH',expires_in:3600,expires_at:Math.floor(Date.now()/1000)+3600,token_type:'bearer',user};
const features=()=>['humanizer','ai_detector'].map(feature_key=>({feature_key,daily_limit:20,is_unlimited:true,enabled:true}));
const staff=[{id:uid,email:'alpha@example.test',features:features()},{id:other,email:'beta@example.test',features:features()}];staff[1].features[0].enabled=false;staff[1].features[0].is_unlimited=false;
let browser;
(async()=>{browser=await chromium.launch({channel:'chromium',headless:true});const context=await browser.newContext();context.setDefaultTimeout(20000);
 await context.addInitScript(({site,session})=>{if(location.origin===site){localStorage.setItem('sb-vuhnvsejdszfvwicflbb-auth-token',JSON.stringify(session));localStorage.setItem('trst-admin-auth-v1',JSON.stringify(session));}},{site,session});
 await context.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());const json=(value,status=200)=>route.fulfill({status,contentType:'application/json',headers:{'Access-Control-Allow-Origin':site,'Access-Control-Allow-Headers':'*'},body:JSON.stringify(value)});
 if(req.method()==='OPTIONS')return json({});
 if(url.origin===site){
  if(url.pathname==='/admin/phrasly')return route.fulfill({contentType:'text/html',body:'<!doctype html><div id="root"></div><script type="module" src="/phrasly-assets/admin.js"></script>'});
  if(url.pathname.startsWith('/phrasly-assets/'))return route.fulfill({path:path.join(root,'public/phrasly-assets',path.basename(url.pathname)),contentType:url.pathname.endsWith('.js')?'application/javascript':'text/css'});
  if(url.pathname==='/api/public/brand-logo')return route.fulfill({status:204});
  if(url.pathname==='/ext-status')return json({ok:true,features:[{key:'humanizer',label:'Humanizer',used:25,limit:'Unlimited',unlimited:true}]});
  if(url.pathname==='/ext-admin'){
   if(req.method()==='GET')return json({ok:true,owner_id:uid,accounts:[],staff});
   const data=req.postDataJSON();assert.equal(data.action,'set_limit');const record=staff.find(w=>w.id===data.user_id).features.find(f=>f.feature_key===data.feature);assert.ok(record);const before=record.enabled;
   record.is_unlimited=data.limit===null;if(data.limit!==null)record.daily_limit=data.limit;assert.equal(record.enabled,before);saved.push(data);return json({ok:true});
  }
 }
 if(url.hostname==='vuhnvsejdszfvwicflbb.supabase.co'&&url.pathname==='/auth/v1/user')return json(user);
 return route.abort();});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(site+'/admin/phrasly');
 const form=page.getByRole('form',{name:'alpha@example.test Humanizer limits',exact:true});await form.waitFor();assert.equal(await form.getByRole('checkbox').isChecked(),true);assert.equal(await form.getByRole('spinbutton').isDisabled(),true);checks.push('current unlimited setting is visible');
 await form.getByRole('checkbox').uncheck();await form.getByRole('spinbutton').fill('47');await form.getByRole('button',{name:'Save limit',exact:true}).click();await form.getByText('Humanizer: 47 / day',{exact:true}).waitFor();assert.deepEqual(saved[0],{action:'set_limit',user_id:uid,feature:'humanizer',limit:47});checks.push('add finite cap to selected user and feature');
 await form.getByRole('spinbutton').fill('10001');assert.equal(await form.getByRole('button',{name:'Save limit',exact:true}).isDisabled(),true);checks.push('invalid caps cannot be saved');
 await form.getByRole('spinbutton').fill('30');await form.getByRole('button',{name:'Save limit',exact:true}).click();await form.getByText('Humanizer: 30 / day',{exact:true}).waitFor();checks.push('edit assigned cap');
 await form.getByRole('button',{name:'Remove limit',exact:true}).click();await form.getByText('Humanizer: Unlimited',{exact:true}).waitFor();assert.equal(saved[2].limit,null);checks.push('remove cap restores unlimited');
 assert.equal(staff[0].features[1].is_unlimited,true);assert.equal(staff[1].features[0].is_unlimited,false);checks.push('other users and features are preserved');
 const revoked=page.getByRole('form',{name:'beta@example.test Humanizer limits',exact:true});await revoked.getByRole('button',{name:'Remove limit',exact:true}).click();await revoked.getByText('Humanizer: Unlimited (revoked)',{exact:true}).waitFor();assert.equal(staff[1].features[0].enabled,false);checks.push('removing a cap retains revoked access');
 await page.getByText('25 used today · Unlimited',{exact:true}).waitFor();checks.push('usage summary displays unlimited beyond old cap');assert.deepEqual(errors,[]);
 console.log(JSON.stringify({status:'PASS',checks:checks.length,cases:checks,page_errors:errors}));
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();});
