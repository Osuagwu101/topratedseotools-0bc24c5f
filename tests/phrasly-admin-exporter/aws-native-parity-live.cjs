const {chromium}=require("playwright"),fs=require("fs"),path=require("path"),os=require("os");
const data=JSON.parse(fs.readFileSync(path.join(os.homedir(),"trst-ops/aws-parity-private-20261029/verification.private.json"),"utf8"));
(async()=>{const ext=path.join(os.homedir(),"Downloads/Top Rated Phrasly 29th Oct"),dir=fs.mkdtempSync(path.join(os.tmpdir(),"trst-parity-"));let context;const network=[];
 try{context=await chromium.launchPersistentContext(dir,{channel:"chromium",headless:process.env.PHRASLY_NATIVE_HEADED!=="1",args:["--disable-extensions-except="+ext,"--load-extension="+ext]});
 const page=await context.newPage();await page.goto("https://topratedseotools.com/phrasly?setup=1",{waitUntil:"domcontentloaded"});
 context.on("response",r=>{const u=new URL(r.url());if(u.hostname.endsWith("phrasly.ai")&&/api|user|session|profile|history|subscription/.test(u.pathname))network.push({path:u.pathname,status:r.status()})});
 const launch=await page.evaluate(async token=>{const r=await fetch("/ext-handoff.php?tool_id=phrasly&feature=humanizer",{headers:{Authorization:"Bearer "+token}}),v=await r.json();if(!r.ok)return {ok:false,error:v.error};return new Promise(resolve=>chrome.runtime.sendMessage("lpgnjkafilbopdojcfnagooojifkccek",{type:"trst_access",payload:v.payload,signature:v.signature},result=>resolve(chrome.runtime.lastError?{ok:false,error:chrome.runtime.lastError.message}:result)));},data.session.access_token);
 const safeLaunch={ok:launch?.ok,error:launch?.error,success:launch?.results?.success?.length,failed:launch?.results?.failed?.map(x=>({name:x.name,error:x.error}))};
 await new Promise(r=>setTimeout(r,25000));
 const provider=context.pages().find(p=>new URL(p.url()).hostname==="phrasly.ai");
 const outcome={launch:safeLaunch,provider:provider?{url:provider.url(),title:await provider.title(),hasSignIn:await provider.getByRole("button",{name:/sign in|sign up/i}).count(),bodyExcerpt:(await provider.locator("body").innerText()).replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig,"[email]").slice(0,1800)}:null,network};
 const dest=path.join(os.homedir(),"trst-ops/aws-parity-private-20261029/native-diagnostic.json");fs.writeFileSync(dest,JSON.stringify(outcome,null,2));console.log(JSON.stringify(outcome));
 }finally{if(context)await context.close();fs.rmSync(dir,{recursive:true,force:true})}
})().catch(e=>{console.error(e.message);process.exitCode=1});
