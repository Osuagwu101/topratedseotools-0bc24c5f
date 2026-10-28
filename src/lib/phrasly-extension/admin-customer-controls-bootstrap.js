/* Mount the native Phrasly card in the existing, separately deployed Admin customer screen. */
(()=>{
 let current=null,loading=null,queued=false;
 const user=()=>location.pathname.match(/^\/admin\/customers\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i)?.[1]||null;
 const source=()=>Array.from(document.querySelectorAll('h2')).find(h=>h.textContent.trim()==='StealthWriter AWS controls')?.closest('.rounded-2xl');
 function check(){
  queued=false;const id=user();
  if(current&&current.id===id&&current.host.isConnected)return;
  if(current){current.dispose();current.host.remove();current=null;}
  if(!id||document.querySelector('[data-trst-phrasly-controls]')||!source())return;
  loading||(loading=import('/phrasly-assets/admin-customer-controls-v1.js'));
  void loading.then(module=>{
   if(user()!==id||current||document.querySelector('[data-trst-phrasly-controls]'))return;
   const after=source();if(!after?.isConnected)return;
   const host=document.createElement('div');host.setAttribute('data-trst-phrasly-customer-host',id);after.after(host);
   current={id,host,dispose:module.mountPhraslyCustomerControls(host,id)};
  }).catch(()=>{loading=null;});
 }
 const schedule=()=>{if(queued)return;queued=true;requestAnimationFrame(check);};
 new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});window.addEventListener('popstate',schedule);schedule();
})();
