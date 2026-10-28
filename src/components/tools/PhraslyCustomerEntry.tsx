/** Add the AWS access/setup panel to the existing storefront without replacing its application. */
import React from "react";
import {createRoot,type Root} from "react-dom/client";
import {PhraslyAccessSetup,launchCustomerPhrasly,phraslyNotice} from "./PhraslyAccessSetup";
let host:HTMLDivElement|null=null,root:Root|null=null,queued=false,launching=false;
function relevant(){return ["/dashboard","/tools/phrasly","/tools/phrasly/"].includes(location.pathname);}
function findPlacement(){
 const main=document.querySelector("main");if(!main)return null;
 const tools=[...main.querySelectorAll("h2")].find(e=>e.textContent?.trim()==="Your Tools");
 if(tools?.parentElement)return {parent:tools.parentElement,before:tools};
 const title=main.querySelector("h1");
 const section=title?.closest("section");
 if(section?.parentElement)return {parent:section.parentElement,before:section.nextSibling};
 return {parent:main,before:main.firstChild};
}
function mount(){
 queued=false;
 if(!relevant()){if(host?.isConnected)host.remove();return;}
 if(host?.isConnected||document.querySelector("[data-trst-phrasly-access]"))return;
 const target=findPlacement();if(!target)return;
 if(root){root.unmount();root=null;}
 host=document.createElement("div");host.id="trst-phrasly-access";
 target.parent.insertBefore(host,target.before);
 root=createRoot(host);root.render(<PhraslyAccessSetup showActions={!location.pathname.startsWith("/dashboard")} />);
}
function schedule(){if(!queued){queued=true;requestAnimationFrame(mount);}}
new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
window.addEventListener("popstate",schedule);
schedule();
export async function launchLegacyPhrasly(feature:"humanizer"|"ai_detector"="humanizer"){
 if(launching)return;launching=true;mount();
 try{
  await launchCustomerPhrasly(feature);
  window.dispatchEvent(new CustomEvent("trst-phrasly-notice",{detail:{message:"Phrasly is opening in its own tab. Allow time for its native editor to load."}}));
 }catch(error){
  window.dispatchEvent(new CustomEvent("trst-phrasly-notice",{detail:{message:phraslyNotice(error),expand:true}}));
  const details=host?.querySelector("details");if(details)details.open=true;
  host?.scrollIntoView({behavior:"smooth",block:"center"});
 }finally{launching=false;}
}
