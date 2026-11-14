export function oneClickInfoScript(endpoint: string, limited: boolean) {
 const config=JSON.stringify({endpoint,limited}).replace(/</g,"\\u003c");
 return "<script>(()=>{const cfg="+config+";("+oneClickInfoClient.toString()+")(cfg)})()</script>";
}
function oneClickInfoClient(cfg: {endpoint:string;limited:boolean}) {
 function start(){
  if(document.getElementById("trst-oneclick-info"))return;
  const host=document.createElement("div");host.id="trst-oneclick-info";
  host.style.cssText="position:fixed;bottom:max(20px,env(safe-area-inset-bottom));right:20px;z-index:2147483646;max-width:calc(100vw - 32px)";
  const root=host.attachShadow({mode:"open"});
  root.innerHTML='<style>:host{color-scheme:dark}*{box-sizing:border-box}section{width:310px;max-width:calc(100vw - 32px);background:#0f172a;color:#f1f5f9;border:1px solid #3f7fd1;border-radius:12px;padding:12px 14px;box-shadow:0 8px 28px #0005;font:12px/1.5 system-ui,sans-serif}header{display:flex;align-items:center;justify-content:space-between;gap:12px}strong{font-size:15px;color:#38bdf8}button{cursor:pointer;border:0;background:transparent;color:#cbd5e1;font:700 20px system-ui}p{margin:4px 0 10px;color:#cbd5e1;overflow-wrap:anywhere}.row{display:flex;justify-content:space-between;gap:16px;font-weight:600}footer{margin-top:8px;padding-top:8px;border-top:1px solid #ffffff24;color:#cbd5e1}#open{border:1px solid #3f7fd1;border-radius:50%;width:42px;height:42px;background:#0f172a;color:#38bdf8;font-size:13px} [hidden]{display:none!important}@media(max-width:480px){section{width:280px}}</style><section aria-label="Top Rated SEO Tools account"><header><strong>Top Rated SEO Tools</strong><button id="close" aria-label="Minimize account information">×</button></header><p id="identity">Loading account…</p><div class="row"><span id="usage-label"></span><span id="usage"></span></div><footer id="reset"></footer></section><button id="open" aria-label="Show account information" hidden>TR</button>';
  const el=(id:string)=>root.getElementById(id)!;
  const panel=root.querySelector("section")!;
  el("close").onclick=()=>{panel.hidden=true;el("open").hidden=false};
  el("open").onclick=()=>{panel.hidden=false;el("open").hidden=true;refresh()};
  el("usage-label").textContent=cfg.limited?"Daily usage":"Usage";
  el("reset").hidden=!cfg.limited;
  let snapshot:any=null,busy=false,lastReset=0;
  function paint(){
   if(!snapshot)return;
   el("identity").textContent=snapshot.user_label||"Customer";
   el("usage").textContent=cfg.limited?snapshot.used+" / "+snapshot.limit:"Unlimited";
   if(cfg.limited){
    const seconds=Math.max(0,Math.ceil((Date.parse(snapshot.resets_at)-Date.now())/1000));
    el("reset").textContent="Resets in "+Math.floor(seconds/3600)+"h "+Math.floor(seconds%3600/60)+"m";
    if(seconds===0&&Date.now()-lastReset>5000){lastReset=Date.now();refresh()}
   }
  }
  async function refresh(){
   if(busy)return;busy=true;
   try{const r=await fetch(cfg.endpoint,{credentials:"same-origin",cache:"no-store"});if(!r.ok)throw Error();snapshot=await r.json();paint()}
   catch{if(!snapshot){el("identity").textContent="Account information unavailable";el("usage").textContent=cfg.limited?"—":"Unlimited"}}
   finally{busy=false}
  }
  document.documentElement.append(host);refresh();
  setInterval(()=>{if(!host.isConnected)document.documentElement.append(host);paint()},1000);
  if(cfg.limited)setInterval(()=>{if(!document.hidden)refresh()},5000);
  window.addEventListener("focus",refresh);
  document.addEventListener("visibilitychange",()=>{if(!document.hidden)refresh()});
 }
 if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",start,{once:true});else start();
}
