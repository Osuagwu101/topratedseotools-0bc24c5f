/* Storefront Phrasly integration: guard the old launch before it opens an unauthenticated provider tab. */
(()=>{
 let modulePromise;
 const relevant=()=>["/dashboard","/tools/phrasly","/tools/phrasly/"].includes(location.pathname);
 const load=()=>modulePromise||(modulePromise=import("/phrasly-assets/customer-access-v1.js"));
 function check(){if(relevant())void load().catch(()=>{});}
 window.addEventListener("click",event=>{
  const target=event.target instanceof Element?event.target.closest("button,a"):null;
  if(!target||target.closest("[data-trst-phrasly-access]"))return;
  const label=(target.textContent||"").replace(/\s+/g," ").trim();
  const isLaunch=["launch phrasly","access phrasly","open phrasly"].includes(label.toLowerCase());
  if(!isLaunch)return;
  event.preventDefault();event.stopImmediatePropagation();
  void load().then(module=>module.launchLegacyPhrasly("humanizer")).catch(()=>{
   location.assign("/phrasly?setup=1");
  });
 },true);
 let queued=false;
 function schedule(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;check();});}
 new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});
 window.addEventListener("popstate",check);check();
})();
