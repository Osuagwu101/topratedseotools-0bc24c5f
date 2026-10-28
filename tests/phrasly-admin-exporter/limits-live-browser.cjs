/* Explicit live UI verification. Input contains one temporary owner session, deleted on exit. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const file=process.argv[2];assert.ok(file,'supply prepared private owner input');const data=JSON.parse(fs.readFileSync(file,'utf8'));let browser;const report={status:'RUNNING',checks:{},page_errors:[]};
(async()=>{browser=await chromium.launch({channel:'chromium',headless:true});const context=await browser.newContext();context.setDefaultTimeout(45000);
 await context.addInitScript(({site,session})=>{if(location.origin===site){localStorage.setItem('sb-vuhnvsejdszfvwicflbb-auth-token',JSON.stringify(session));localStorage.setItem('trst-admin-auth-v1',JSON.stringify(session));}},{site:data.site,session:data.session});
 const page=await context.newPage();page.on('pageerror',e=>report.page_errors.push(e.message.slice(0,150)));await page.goto(data.site+'/admin/phrasly',{waitUntil:'domcontentloaded'});
 await page.getByRole('heading',{name:'Writer access',exact:true}).waitFor();report.checks.live_admin_page_loads=true;
 const forms=page.locator('form[aria-label$=" limits"]');assert.ok(await forms.count()>=data.users*2);
 let unlimited=0;for(let i=0;i<await forms.count();i++){const f=forms.nth(i);if(await f.getByRole('checkbox').isChecked()){assert.equal(await f.getByRole('spinbutton').isDisabled(),true);assert.equal(await f.getByRole('button',{name:'Remove limit',exact:true}).isDisabled(),true);unlimited++;}}
 assert.ok(unlimited>=data.users*2);report.checks.all_current_users_show_unlimited=true;report.current_users=data.users;report.unlimited_feature_editors=unlimited;
 await page.getByLabel('Unlimited Humanizer',{exact:true}).waitFor();await page.getByLabel('Unlimited AI Detector',{exact:true}).waitFor();report.checks.new_assignments_offer_unlimited=true;
 assert.equal(await page.getByRole('link',{name:'Download Admin cookie exporter (.zip)',exact:true}).getAttribute('href'),'/phrasly-assets/Osuagwu-Solomon-TopRated.zip');report.checks.cookie_exporter_preserved=true;
 assert.deepEqual(report.page_errors,[]);report.status='PASS';
})().catch(e=>{report.status='FAIL';report.failure=String(e.message).split('\n')[0].slice(0,180);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();try{const r=await fetch(data.api+'/auth/v1/logout?scope=local',{method:'POST',headers:{apikey:data.publishable,Authorization:'Bearer '+data.session.access_token},signal:AbortSignal.timeout(30000)});report.temporary_owner_session_revoked=r.ok;if(!r.ok)process.exitCode=1;}finally{fs.unlinkSync(file);fs.writeFileSync(path.join(path.dirname(file),'live-browser-evidence.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}});
