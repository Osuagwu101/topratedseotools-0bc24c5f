/* Add the source customer-summary interaction to the existing Admin deployment. */
(()=>{
 const customer=()=>/^\/admin\/customers\/[0-9a-f-]{36}\/?$/i.test(location.pathname);
 const bound=new WeakSet();let queued=false;
 function check(){
  queued=false;if(!customer())return;
  const heading=Array.from(document.querySelectorAll('div')).find(el=>el.children.length===0&&el.textContent.trim()==='Assigned tools & subscriptions');
  const list=heading?.parentElement;if(!list)return;
  list.id='assigned-tools';list.tabIndex=-1;list.style.scrollMarginTop='96px';
  const label=Array.from(document.querySelectorAll('div')).find(el=>el.children.length===0&&el.textContent.trim().toLowerCase()==='active / expired');
  const card=label?.parentElement;
  if(card&&!bound.has(card)&&card.tagName!=='A'){
   bound.add(card);card.setAttribute('role','link');card.tabIndex=0;card.setAttribute('aria-label','View assigned tools and revoke access');card.setAttribute('aria-controls','assigned-tools');card.style.cursor='pointer';
   const hint=document.createElement('div');hint.className='mt-1 text-xs text-primary';hint.textContent='View tools & revoke access →';card.append(hint);
   const open=()=>{if(!customer())return;const current=document.getElementById('assigned-tools');if(!current)return;current.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});current.focus({preventScroll:true});};
   card.addEventListener('click',open);card.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();open();}});
   card.addEventListener('focus',()=>{card.style.outline='2px solid #1c5794';card.style.outlineOffset='2px';});card.addEventListener('blur',()=>{card.style.outline='';card.style.outlineOffset='';});
  }
  for(const button of list.querySelectorAll('button')){
   if(button.textContent.trim()!=='Cancel')continue;
   const text=Array.from(button.childNodes).find(node=>node.nodeType===Node.TEXT_NODE&&node.textContent.includes('Cancel'));
   if(text)text.textContent=text.textContent.replace('Cancel','Revoke access');
   const tool=button.closest('tr')?.querySelector('td')?.textContent.trim();
   if(tool)button.setAttribute('aria-label','Revoke '+tool+' access');
  }
 }
 const schedule=()=>{if(queued)return;queued=true;requestAnimationFrame(check);};
 new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});window.addEventListener('popstate',schedule);schedule();
})();
