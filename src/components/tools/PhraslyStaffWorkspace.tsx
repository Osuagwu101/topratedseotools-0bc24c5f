import React,{useEffect,useRef,useState} from "react";
import {createRoot} from "react-dom/client";
import {supabase} from "@/integrations/supabase/client";
import {launchPhraslyAwsFeature} from "@/lib/phrasly-extension/launch-from-website";
import {PhraslyAccessSetup} from "./PhraslyAccessSetup";
import {PhraslyOneClickActions} from "@/components/tools/PhraslyOneClickActions";

const ADMIN=location.pathname.startsWith("/admin/");
const SETUP=new URLSearchParams(location.search).get("setup")==="1";
const messages:Record<string,string>={
 not_signed_in:"Sign in to continue.",no_access:"Phrasly access has not been assigned to this account. Contact your administrator.",
 forbidden:"This page is available to the account owner.",account_inactive:"This account is unavailable. Contact your administrator.",
 writer_not_found:"No active TopRated account matches that email.",bad_cookie_json:"Paste the Phrasly cookie array as valid JSON, including its session cookie.",
 bad_request:"Check the entered details and try again.",service_unavailable:"Phrasly is temporarily unavailable. Contact your administrator."
};
async function call(url:string,body?:unknown,binary=false){
 const {data}=await supabase.auth.getSession();
 if(!data.session?.access_token)throw new Error("not_signed_in");
 const response=await fetch(url,{method:body===undefined?"GET":"POST",headers:{
  Authorization:"Bearer "+data.session.access_token,...(body!==undefined?{"Content-Type":"application/json"}:{})
 },...(body!==undefined?{body:JSON.stringify(body)}:{}),credentials:"same-origin",cache:"no-store"});
 if(binary&&response.ok)return response.blob();
 const result=await response.json();
 if(!response.ok||result.ok===false)throw new Error(result.error||"service_unavailable");
 return result;
}
function App(){
 const [session,setSession]=useState(false),[ready,setReady]=useState(false),[state,setState]=useState<any>(null),[status,setStatus]=useState<any>(null);
 const [error,setError]=useState(""),[notice,setNotice]=useState(""),[busy,setBusy]=useState(false);
 const [email,setEmail]=useState(""),[password,setPassword]=useState("");
 const [writerEmail,setWriterEmail]=useState(""),[humanizer,setHumanizer]=useState(20),[detector,setDetector]=useState(20),[expiry,setExpiry]=useState("");
 const [accountId,setAccountId]=useState(""),[label,setLabel]=useState(""),[capacity,setCapacity]=useState(""),[cookies,setCookies]=useState(""),[enabled,setEnabled]=useState(true);
 const [nativeState,setNativeState]=useState("opening");
 const nativeRequested=useRef(false);
 useEffect(()=>{
  if(ADMIN)return;
  document.title=SETUP?"Install the Access Extension":"Opening Phrasly";
  if(SETUP)return;
  if(!status||nativeRequested.current)return;
  nativeRequested.current=true;
  const selected=new URLSearchParams(location.search).get("feature")==="ai_detector"?"ai_detector":"humanizer";
  void launchPhraslyAwsFeature(selected).then(result=>{
   if(result.ok)setNativeState("opened");
   else setNativeState(result.error||"failed");
  }).catch(()=>setNativeState("failed"));
 },[status]);
 const displayError=(e:any)=>setError(messages[e.message]||"The request could not be completed. Please try again.");
 async function load(){
  try{
   const {data}=await supabase.auth.getSession();setSession(!!data.session);setError("");setState(null);setStatus(null);
   if(data.session){
    if(ADMIN){
     const result=await call("/ext-admin");setState(result);
     if(!accountId&&result.accounts[0])selectAccount(result.accounts[0]);
     try{setStatus(await call("/ext-status"));}catch{setStatus(null);}
    }else setStatus(await call("/ext-status"));
   }
  }catch(e){displayError(e);}
  finally{setReady(true);}
 }
 useEffect(()=>{void load();const {data}=supabase.auth.onAuthStateChange(()=>{void load();});return()=>data.subscription.unsubscribe();},[]);
 function selectAccount(a:any){setAccountId(a.id);setLabel(a.label);setCapacity(a.capacity===null?"":String(a.capacity));setEnabled(a.enabled);setCookies("");}
 async function operation(action:()=>Promise<void>){
  if(busy)return;setBusy(true);setError("");setNotice("");
  try{await action();}catch(e){displayError(e);}finally{setBusy(false);}
 }
 async function login(e:React.FormEvent){
  e.preventDefault();await operation(async()=>{
   const {error}=await supabase.auth.signInWithPassword({email,password});
   if(error)throw new Error("sign_in_failed");
   setPassword("");await load();
  });
 }
 async function download(){
  await operation(async()=>{
   const blob=await call("/ext-package",{},true),url=URL.createObjectURL(blob);
   const a=document.createElement("a");a.href=url;a.download="TopRated-Phrasly-Access.zip";a.click();URL.revokeObjectURL(url);
   setNotice("Extension downloaded. Follow the installation steps below.");
  });
 }
 async function grant(e:React.FormEvent){
  e.preventDefault();await operation(async()=>{
   await call("/ext-admin",{action:"grant",email:writerEmail,humanizer,ai_detector:detector,expires_at:expiry?new Date(expiry).toISOString():null});
   setNotice("Writer access saved.");await load();
  });
 }
 async function saveAccount(e:React.FormEvent){
  e.preventDefault();await operation(async()=>{
   await call("/ext-admin",{action:"save_account",account_id:accountId,label,capacity:capacity===""?null:Number(capacity),enabled,cookies});
   setCookies("");setNotice("Account session updated.");await load();
  });
 }
 if(!ADMIN)return <main className="phrasly-entry-page">
  <section>
   <h1>{SETUP?"Install the Access Extension":!ready?"Opening Phrasly…":!session?"Sign in to open Phrasly":nativeState==="opened"?"Phrasly is open":nativeState==="opening"&&status?"Opening Phrasly…":"Open native Phrasly"}</h1>
   <p>{nativeState==="opened"?"Continue in the Phrasly tab that just opened.":session?"Your writing takes place on phrasly.ai.":"Use your existing TopRated writer account to continue to phrasly.ai."}</p>
   {error&&<div role="alert" className="message error">{error}</div>}
   {!session&&ready&&<form onSubmit={login}><label>Email<input required type="email" autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} /></label><label>Password<input required type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} /></label><button disabled={busy}>Sign in and open Phrasly</button></form>}
   {status&&nativeState!=="opening"&&nativeState!=="opened"&&<>
    <p>{nativeState==="extension_unavailable"||nativeState==="extension_disabled"?"Install or reload the TopRated access extension, then continue.":"Phrasly could not be opened. Check your access with your administrator."}</p>
    <button onClick={()=>{nativeRequested.current=false;setNativeState("opening");void load();}}>Open Phrasly</button>
    <button className="secondary" disabled={busy} onClick={()=>void download()}>Download extension</button>
    {notice&&<p role="status">{notice}</p>}
    <ol><li>Extract the downloaded ZIP.</li><li>Open chrome://extensions or edge://extensions, enable Developer mode, and choose Load unpacked.</li><li>Select the extracted folder, then choose Open Phrasly above.</li></ol>
   </>}
  </section>
 <PhraslyAccessSetup guideOnly />
 </main>;
 return <><header><a href="/"><img src="/api/public/brand-logo" alt="" />TopRated</a><span>IN-HOUSE WRITERS</span><a href={ADMIN?"/admin":"/dashboard"}>{ADMIN?"Back to Admin":"Dashboard"}</a></header>
 <main><div className="intro"><p className="eyebrow">PHRASLY ACCESS</p><h1>{ADMIN?"Phrasly administration":"Your writer workspace"}</h1><p>{ADMIN?"Assign writer allowances and update the shared Phrasly account session.":"Open your assigned Humanizer or AI Detector from this browser."}</p></div>
 {error&&<div className="message error" role="alert">{error}</div>}
 {notice&&<div className="message" role="status">{notice}</div>}
 {!ready?<section><p>Loading your access…</p></section>:!session?<section className="signin"><h2>Sign in to TopRated</h2><p>Use your existing {ADMIN?"Admin":"writer"} account.</p><form onSubmit={login}><label>Email<input type="email" autoComplete="username" required value={email} onChange={e=>setEmail(e.target.value)} /></label><label>Password<input type="password" autoComplete="current-password" required value={password} onChange={e=>setPassword(e.target.value)} /></label><button disabled={busy}>{busy?"Signing in…":"Sign in"}</button></form></section>:<>
 {status&&<section><div className="section-heading"><div><h2>Open Phrasly</h2><p>Daily allowances reset at midnight, West Africa Time.</p></div><button className="secondary" onClick={()=>void load()}>Refresh usage</button></div>
 <div className="allowances">{status.features.map((f:any)=><div key={f.key}><strong>{f.label}</strong><span>{f.used} / {f.limit} used today</span></div>)}</div><PhraslyOneClickActions /></section>}
 {ADMIN&&state&&<>
 <section><h2>Writer access</h2><p>Assign access to an existing TopRated account. These grants do not create payments or orders.</p>
 <form onSubmit={grant} className="grant"><label>Writer email<input required type="email" value={writerEmail} onChange={e=>setWriterEmail(e.target.value)} /></label><label>Humanizer requests per day<input required type="number" min="1" max="10000" value={humanizer} onChange={e=>setHumanizer(Number(e.target.value))} /></label><label>AI Detector requests per day<input required type="number" min="1" max="10000" value={detector} onChange={e=>setDetector(Number(e.target.value))} /></label><label>Access ends (optional)<input type="datetime-local" value={expiry} onChange={e=>setExpiry(e.target.value)} /></label><button disabled={busy}>Save writer access</button></form>
 <div className="table-wrap"><table><thead><tr><th>Writer</th><th>Daily feature limits</th><th>Access</th></tr></thead><tbody>{state.staff.map((w:any)=><tr key={w.id}><td>{w.email||w.full_name||"Writer"}</td><td>{w.features.map((f:any)=><div key={f.feature_key}>{f.feature_key==="humanizer"?"Humanizer":"AI Detector"}: {f.daily_limit} {f.enabled?"":"(revoked)"}</div>)}</td><td><button className="secondary" disabled={busy||w.features.every((f:any)=>!f.enabled)} onClick={()=>void operation(async()=>{await call("/ext-admin",{action:"revoke",user_id:w.id});setNotice("Writer access revoked.");await load();})}>Revoke access</button></td></tr>)}</tbody></table></div></section>
 <section><h2>Phrasly account session</h2><p>Use the cookie array from your authorised Phrasly account. Saved cookie values are encrypted and are never displayed here.</p><p className="fine">The Phrasly account's own plan allowance is separate from the writer request limits above. Check its remaining allowance in Phrasly.</p>
 <form onSubmit={saveAccount}><label>Account<select value={accountId} onChange={e=>selectAccount(state.accounts.find((a:any)=>a.id===e.target.value))}>{state.accounts.map((a:any)=><option key={a.id} value={a.id}>{a.label}</option>)}</select></label>
 <div className="row"><label>Label<input value={label} required maxLength={120} onChange={e=>setLabel(e.target.value)} /></label><label>Writer capacity (blank for unlimited reuse)<input type="number" min="1" max="10000" value={capacity} onChange={e=>setCapacity(e.target.value)} /></label></div>
 <label className="check"><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)} /> Account enabled</label>
 <label>Updated Phrasly cookie JSON<textarea required spellCheck={false} autoComplete="off" rows={7} value={cookies} onChange={e=>setCookies(e.target.value)} placeholder='[{"name":"session","value":"…","domain":"phrasly.ai","path":"/"}]' /></label>
 <button disabled={busy}>Save encrypted account session</button></form></section>
 </>}
 {status&&<section><div className="section-heading"><div><h2>Browser extension</h2><p>Install once in the browser you use for writing.</p></div><button disabled={busy} onClick={()=>void download()}>Download extension</button></div>
 <ol><li>Download and extract the ZIP into a folder you will keep.</li><li>Open <strong>chrome://extensions</strong> or <strong>edge://extensions</strong> and turn on Developer mode.</li><li>Choose <strong>Load unpacked</strong> and select the extracted folder. For an existing installation, reload the updated extension.</li><li>Return here and choose Open Humanizer or Open AI Detector.</li></ol></section>}
 </>}
 <footer>TopRated · Private writer access</footer></main></>;
}
createRoot(document.getElementById("root")!).render(<App />);
