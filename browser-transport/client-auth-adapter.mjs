import {createHash} from 'node:crypto';
import pin from './client-auth-pin.json' with {type:'json'};
export const CLIENT_AUTH_PATH='/core/v12.188.0/browser/browser-67782c38.js';
const syncMethod=`async trstSync(success){
 if(this.trstSyncing)return this.trstSyncing;
 this.trstSyncing=(async()=>{
  for(let attempts=0;!nE&&attempts<200;attempts++)await new Promise(r=>setTimeout(r,50));
  if(!nE)throw Error('QuillBot UI did not initialize');
  let state;
  try{const r=await fetch('/__qbtest/__trst/auth-state',{credentials:'same-origin',cache:'no-store'});if(!r.ok)throw Error('Assigned QuillBot session unavailable');state=await r.json();if(!state.authenticated||!state.premium)throw Error('Assigned Premium session unavailable');}
  catch(error){window.__trstQbAuthReady=false;this.authenticated=false;this.premium=false;this.user=null;this.idToken=null;F3(A8({isAuthenticated:false,premium:false,syncedWithDb:true}));throw error;}
  const changed=this.authenticated!==state.authenticated||this.premium!==state.premium||this.uid!==state.uid;
  const user={uid:state.uid,email:state.email,displayName:state.name,emailVerified:true,premium:state.premium,acceptedPremiumModesTnc:state.accepted_premium_modes_tnc,providerData:[],metadata:{},getIdToken:async()=>state.client_token};
  this.auth={currentUser:user};this.user=user;this.uid=user.uid;this.authenticated=state.authenticated;this.premium=state.premium;this.idToken=state.client_token;this.userType='account';this.sessionsExceeded=false;this.sessExT=Date.parse(state.session_expires_at);
  document.cookie='authenticated=true; Path=/; Secure; SameSite=Lax';
  document.cookie='premium='+String(state.premium)+'; Path=/; Secure; SameSite=Lax';
  document.cookie='useridtoken='+state.client_token+'; Path=/; Secure; SameSite=Lax';
  document.cookie='acceptedPremiumModesTnc='+String(state.accepted_premium_modes_tnc)+'; Path=/; Secure; SameSite=Lax';
  window.__trstQbAuthReady=true;window.__trstQbWriter={name:state.name,email:state.email};
  const payload={uid:user.uid,email:user.email,fullName:state.name,isAuthenticated:state.authenticated,premium:state.premium,syncedWithDb:true,userType:'account',emailVerified:true,sessionsExceeded:false,acceptedPremiumModesTnc:state.accepted_premium_modes_tnc};
  if(changed)F3(A8(payload));
  this.updateGlobalsCharLimit();if(changed)this.update();
  if(typeof success==='function')success();
  return state;
 })();
 try{return await this.trstSyncing;}finally{this.trstSyncing=null;}
}
`;
function replaceOnce(source,from,to){if(source.split(from).length!==2)throw Error('QuillBot client adapter signature changed');return source.replace(from,to);}
export function adaptClient(source){
 if(createHash('sha256').update(source).digest('hex')!==pin.sha256)throw Error('QuillBot client version changed; native access paused.');
 let out=replaceOnce(source,'class kA extends EventTarget{','class kA extends EventTarget{'+syncMethod);
 out=replaceOnce(out,'registerFirebaseListeners(){','registerFirebaseListeners(){if(window.__trstQbProxy){this.trstSync().catch(()=>{});this.trstRefresh=setInterval(()=>this.trstSync().catch(()=>{}),60000);return;}');
 out=replaceOnce(out,'kC(this,"updateDetails",async(e,t,n)=>{','kC(this,"updateDetails",async(e,t,n)=>{if(window.__trstQbProxy)return this.trstSync(t);');
 out=replaceOnce(out,'async forceRefreshUserToken(e=!0){','async forceRefreshUserToken(e=!0){if(window.__trstQbProxy)return this.idToken||(await this.trstSync()).client_token;');

 out=replaceOnce(out,'F3=e("dn",e=>{nE.dispatch(e)})','F3=e("dn",e=>{if(!nE&&window.__trstQbProxy){(window.__trstQbPendingActions??=[]).push(e);return e;}return nE.dispatch(e)})');
 out=replaceOnce(out,'e("dl",nE=ou(sQ,window.__QUILLBOT_CORE_STATE__||{common:sK,user:{}},F0())),delete window.__QUILLBOT_CORE_STATE__','e("dl",nE=ou(sQ,window.__QUILLBOT_CORE_STATE__||{common:sK,user:{}},F0())),(window.__trstQbPendingActions||[]).splice(0).forEach(action=>nE.dispatch(action)),delete window.__QUILLBOT_CORE_STATE__');
 return out;
}
