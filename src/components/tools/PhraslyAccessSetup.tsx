import React,{useEffect,useState} from "react";
import {supabase} from "@/integrations/supabase/client";
import {launchPhraslyAwsFeature} from "@/lib/phrasly-extension/launch-from-website";
import type {LaunchFeature} from "@/lib/phrasly-extension/launcher";

const help:Record<string,string>={
 no_access:"Phrasly access has not been assigned to this TopRated account. Contact Admin.",
 not_signed_in:"Sign in to your TopRated account to download the extension and open Phrasly.",
 extension_unavailable:"Install the access extension using the steps below, then click Launch Phrasly again.",
 extension_disabled:"Reload the updated access extension in your browser, then try again.",
 launch_state_unknown:"Check your browser tabs before trying again. Phrasly may already be opening.",
 handoff_unavailable:"Your Phrasly access could not be confirmed. Contact Admin.",
};
async function sessionToken(){
 const {data}=await supabase.auth.getSession();
 if(!data.session?.access_token)throw new Error("not_signed_in");
 return data.session.access_token;
}
export async function launchCustomerPhrasly(feature:LaunchFeature="humanizer"){
 const token=await sessionToken();
 const status=await fetch("/ext-status",{headers:{Authorization:"Bearer "+token},cache:"no-store"});
 if(!status.ok){const body=await status.json();throw new Error(body.error||"no_access");}
 const result=await launchPhraslyAwsFeature(feature);
 if(!result.ok)throw new Error(result.error||"launch_failed");
 return result;
}
export function PhraslyAccessSetup({guideOnly=false,showActions=true}:{guideOnly?:boolean;showActions?:boolean}){
 const [signed,setSigned]=useState<boolean|null>(null),[busy,setBusy]=useState(""),[message,setMessage]=useState(""),[expanded,setExpanded]=useState(guideOnly);
 useEffect(()=>{
  if(!document.getElementById("trst-phrasly-setup-css")){const link=document.createElement("link");link.id="trst-phrasly-setup-css";link.rel="stylesheet";link.href="/phrasly-assets/access-setup.css";document.head.appendChild(link);}
  const update=()=>{void supabase.auth.getSession().then(({data})=>setSigned(!!data.session));};
  update();const {data}=supabase.auth.onAuthStateChange((_event,session)=>setSigned(!!session));return()=>data.subscription.unsubscribe();
 },[]);
 useEffect(()=>{
  const event=(e:Event)=>{const d=(e as CustomEvent).detail;setMessage(d?.message||"");if(d?.expand)setExpanded(true);};
  window.addEventListener("trst-phrasly-notice",event);return()=>window.removeEventListener("trst-phrasly-notice",event);
 },[]);
 async function run(key:string,fn:()=>Promise<void>){
  if(busy)return;setBusy(key);setMessage("");
  try{await fn();}catch(e){const code=e instanceof Error?e.message:"";setMessage(help[code]||"Phrasly could not be opened. Contact Admin for help.");}
  finally{setBusy("");}
 }
 async function download(){
  await run("download",async()=>{
   const token=await sessionToken();
   const response=await fetch("/ext-package",{method:"POST",headers:{Authorization:"Bearer "+token},cache:"no-store"});
   if(!response.ok){const body=await response.json();throw new Error(body.error||"no_access");}
   const url=URL.createObjectURL(await response.blob()),a=document.createElement("a");
   a.href=url;a.download="TopRated-Phrasly-Access.zip";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
   setExpanded(true);setMessage("Downloaded. Extract the ZIP, then follow the installation steps below.");
  });
 }
 async function open(feature:LaunchFeature){await run(feature,async()=>{await launchCustomerPhrasly(feature);setMessage("Phrasly is opening in its own tab. It can take a little time to finish loading.");});}
 return <section data-trst-phrasly-access="true" className="trst-phrasly-setup" aria-label="Phrasly access extension">
  <div className="trst-phrasly-setup-heading"><div><h2>Download Extension</h2><p>Required to open Phrasly already signed in. Install once in each browser you use for writing.</p></div>
   <button type="button" onClick={()=>void download()} disabled={!!busy}>{busy==="download"?"Downloading…":"Download Extension (.zip)"}</button>
  </div>
  {message&&<p role="status" aria-live="polite" className="trst-phrasly-message">{message}</p>}
  {signed===false&&<p><a href="/login">Sign in to TopRated</a> to download and launch. You do not need to sign in to a separate Phrasly account.</p>}
  <details open={expanded} onToggle={e=>setExpanded(e.currentTarget.open)}><summary>Installation instructions (Chrome / Edge / Brave)</summary>
   <ol>
    <li>Download the ZIP above, then <strong>extract (unzip) it</strong> into a folder you will keep.</li>
    <li>Open <code>chrome://extensions</code> in a new tab. For Edge use <code>edge://extensions</code>; for Brave use <code>brave://extensions</code>.</li>
    <li>Turn on <strong>Developer mode</strong> at the top of the extensions page.</li>
    <li>Click <strong>Load unpacked</strong>, then select the extracted folder containing <code>manifest.json</code>.</li>
    <li>Return to TopRated and click <strong>Launch Phrasly</strong>, <strong>Access Humanizer</strong> or <strong>Access AI Detector</strong>. Phrasly opens in its own tab already signed in.</li>
   </ol>
   <p>If an older extension is installed, load this updated folder or click Reload for the updated extension. Repeat installation when you change browsers or computers.</p>
  </details>
  {showActions&&!guideOnly&&signed&&<div className="trst-phrasly-actions">
   <button type="button" disabled={!!busy} onClick={()=>void open("humanizer")}>Access Humanizer</button>
   <button type="button" disabled={!!busy} onClick={()=>void open("ai_detector")}>Access AI Detector</button>
  </div>}
 </section>;
}
export function phraslyNotice(error:unknown){
 const code=error instanceof Error?error.message:"";
 return help[code]||"Phrasly could not be opened. Contact Admin for help.";
}
