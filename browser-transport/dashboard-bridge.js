(() => {
 if(window.__trstQuillbotLauncher)return;window.__trstQuillbotLauncher=true;
 const gateway='https://quillbot.topratedseotools.com',url='https://vuhnvsejdszfvwicflbb.supabase.co',key='sb_publishable_qACYapb1FmF5eAfeG9wEPw_KYGrmAa6';
 let pending=false;
 function notice(message,error=false){let box=document.querySelector('#trst-quillbot-notice');if(!box){box=document.createElement('div');box.id='trst-quillbot-notice';box.setAttribute('role','status');box.style.cssText='position:fixed;right:20px;bottom:20px;max-width:380px;padding:16px 20px;border-radius:12px;background:#175f34;color:white;z-index:2147483647;font:14px/1.5 system-ui;box-shadow:0 6px 24px #0002';document.body.append(box);}box.style.background=error?'#a32121':'#175f34';box.textContent=message;setTimeout(()=>box.remove(),error?10000:4000);}
 function activeSession(){let stored;try{stored=JSON.parse(localStorage.getItem('sb-vuhnvsejdszfvwicflbb-auth-token')||'null')}catch{}const session=stored?.access_token?stored:stored?.currentSession;if(!session?.access_token)throw Error('Please sign in to TopRated SEO Tools again.');if(session.expires_at&&session.expires_at*1000<Date.now()+10000)throw Error('Please refresh your dashboard to reconnect your TopRated session.');return session;}
 function cardFor(target){if(location.pathname!=='/dashboard'&&location.pathname!=='/dashboard/')return null;const card=target instanceof Element?target.closest('a[href]'):null;if(!card)return null;const link=new URL(card.href);return link.origin===location.origin&&link.pathname==='/tools/quillbot'&&!link.hash&&/active|lifetime/i.test(card.textContent||'')?card:null;}
 async function launch(){
  if(pending)return;pending=true;
  let handoff=null;try{handoff=window.open('about:blank','_blank');if(handoff)handoff.opener=null;}catch{}
  notice('Opening QuillBot...');
  try{
   const session=activeSession();
   const response=await fetch(gateway+'/__qbtest/__trst/launch',{method:'POST',credentials:'include',signal:AbortSignal.timeout(25000),headers:{authorization:'Bearer '+session.access_token}});
   const text=await response.text();let result;try{result=JSON.parse(text)}catch{}
   if(!response.ok||!result?.launch_url)throw Error(result?.message||text.slice(0,240)||'QuillBot is temporarily unavailable.');
   const target=new URL(result.launch_url);if(target.origin!==gateway||target.pathname!=='/__qbtest/__trst/enter')throw Error('QuillBot returned an invalid launch.');
   if(handoff&&!handoff.closed)handoff.location.href=target.href;else location.assign(target.href);
   notice('QuillBot is ready.');
  }catch(error){if(handoff&&!handoff.closed)handoff.close();notice(error.name==='TimeoutError'?'QuillBot connection timed out. Please retry or contact Admin.':error.message||'QuillBot launch failed.',true);}finally{pending=false;}
 }
 document.addEventListener('click',event=>{const card=cardFor(event.target);if(!card)return;event.preventDefault();event.stopImmediatePropagation();void launch();},true);
 function mark(){if(location.pathname!=='/dashboard'&&location.pathname!=='/dashboard/')return;for(const a of document.querySelectorAll('a[href]'))if(cardFor(a))a.title='Launch QuillBot OneClick';}
 let queued=false;const schedule=()=>{if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;mark()});};new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});window.addEventListener('popstate',mark);mark();
})();
