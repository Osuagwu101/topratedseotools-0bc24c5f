/* Actual Chrome cookie store; all values synthetic, with every network request blocked. */
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'../..'),checks=[];let context;const temp=fs.mkdtempSync(path.join(os.tmpdir(),'phrasly-cookie-replacement-'));
(async()=>{
 const ext=path.join(temp,'extension');execFileSync('python3',[path.join(root,'scripts/phrasly/build-native-extension.py'),'--origin','https://topratedseotools.com','--enabled','--out',ext]);
 context=await chromium.launchPersistentContext(path.join(temp,'profile'),{channel:'chromium',headless:false,args:['--disable-extensions-except='+ext,'--load-extension='+ext]});await context.route('**/*',route=>route.abort());
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');assert.equal(new URL(worker.url()).host,'lpgnjkafilbopdojcfnagooojifkccek');checks.push('extension identity and permissions retained');
 const result=await worker.evaluate(async()=>{
  const url='https://phrasly.ai/dashboard/humanizer',base={url:'https://phrasly.ai/',name:'session',path:'/',secure:true,httpOnly:true,sameSite:'lax'};
  await chrome.cookies.set({...base,value:'OLD_HOST_ONLY'});await chrome.cookies.set({...base,domain:'.phrasly.ai',value:'OLD_DOMAIN'});await chrome.cookies.set({...base,url:'https://phrasly.ai/dashboard',path:'/dashboard',value:'OLD_PATH'});await chrome.cookies.set({url:'https://phrasly.ai/',name:'keep_preference',value:'PRESERVE'});
  const first=await applyCookies(url,[{...base,domain:'phrasly.ai',hostOnly:true,value:'NEW_AUTH'}]);let cookies=await chrome.cookies.getAll({domain:'phrasly.ai',name:'session'}),selected=await chrome.cookies.get({url,name:'session'});
  const oneFresh=cookies.length===1&&cookies[0].hostOnly&&cookies[0].path==='/'&&selected.value==='NEW_AUTH';
  const preserved=(await chrome.cookies.get({url:'https://phrasly.ai/',name:'keep_preference'})).value==='PRESERVE';
  const future=Math.floor(Date.now()/1000)+3600;await applyCookies(url,[{...base,domain:'.phrasly.ai',hostOnly:false,value:'DOMAIN_AUTH',expires:future}]);cookies=await chrome.cookies.getAll({domain:'phrasly.ai',name:'session'});
  const domainPreserved=cookies.length===1&&!cookies[0].hostOnly&&cookies[0].value==='DOMAIN_AUTH'&&Math.abs(cookies[0].expirationDate-future)<2;
  const expired=await applyCookies(url,[{...base,domain:'phrasly.ai',value:'EXPIRED',expirationDate:Math.floor(Date.now()/1000)-5}]);const expiredRejected=expired.failed.some(c=>c.name==='session')&&(await chrome.cookies.get({url,name:'session'})).value==='DOMAIN_AUTH';
  const missing=await applyCookies(url,[{name:'preference',domain:'phrasly.ai',value:'fixture'}]);const missingRejected=missing.failed.some(c=>c.name==='session');
  const optional=await applyCookies(url,[{...base,domain:'phrasly.ai',hostOnly:true,value:'FINAL_AUTH'},{name:'invalid;name',value:'synthetic',domain:'phrasly.ai'}]);
  const optionalFailureSafe=optional.failed.some(c=>c.name==='invalid;name')&&!optional.failed.some(c=>c.name==='session')&&(await chrome.cookies.get({url,name:'session'})).value==='FINAL_AUTH';
  return {oneFresh,preserved,domainPreserved,expiredRejected,missingRejected,optionalFailureSafe,noSecretResponse:!JSON.stringify(first).includes('NEW_AUTH')};
 });
 for(const [name,passed]of Object.entries(result)){assert.equal(passed,true,name);checks.push(name);}
 console.log(JSON.stringify({status:'PASS',checks:checks.length,cases:checks,provider_network_requests:0}));
})().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(async()=>{if(context)await context.close();fs.rmSync(temp,{recursive:true,force:true});});
