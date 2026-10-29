import React,{useState} from "react";
type Account={id:string;label:string;target_url:string;capacity:number|null;enabled:boolean;used:number};
type Props={accounts:Account[];busy:boolean;imported:any;onImportCleared:()=>void;onSave:(body:unknown)=>Promise<void>};
function AccountRow({account,busy,imported,onImportCleared,onSave}:Props&{account?:Account}) {
 const [label,setLabel]=useState(account?.label||""),[url,setUrl]=useState(account?.target_url||"https://phrasly.ai/dashboard");
 const [capacity,setCapacity]=useState(account?.capacity==null?"":String(account.capacity)),[cookies,setCookies]=useState("");
 const [enabled,setEnabled]=useState(account?.enabled??true),[useImport,setUseImport]=useState(false);
 async function save(event:React.FormEvent) {
  event.preventDefault();
  await onSave({action:account?"save_account":"add_account",...(account?{account_id:account.id}:{}),label,target_url:url,capacity:capacity===""?null:Number(capacity),enabled,cookies:useImport&&imported?JSON.stringify(imported.cookies):cookies});
  setCookies("");if(useImport){onImportCleared();setUseImport(false);}
  if(!account){setLabel("");setCapacity("");setUrl("https://phrasly.ai/dashboard");}
 }
 return <form className="cookie-account" onSubmit={e=>void save(e).catch(()=>{})}>
  <div className="cookie-account-fields">
   <label><span className="sr-only">Account name</span><input aria-label={account?"Account name":"New account name"} required maxLength={120} placeholder="Label (e.g. Account 1)" value={label} onChange={e=>setLabel(e.target.value)} /></label>
   <label><span className="sr-only">Native website URL</span><input aria-label={account?"Native website URL":"New native website URL"} type="url" required placeholder="https://phrasly.ai/dashboard" value={url} onChange={e=>setUrl(e.target.value)} /></label>
   <label><span className="sr-only">Capacity</span><input aria-label={account?"Capacity":"New account capacity"} type="number" min="1" max="10000" placeholder="∞" value={capacity} onChange={e=>setCapacity(e.target.value)} /></label>
  </div>
  {imported&&<label className="check"><input type="checkbox" checked={useImport} onChange={e=>setUseImport(e.target.checked)} />Use the received {imported.count} cookies for this account</label>}
  <textarea aria-label={account?"Account cookie JSON":"New account cookie JSON"} required={!account&&!(useImport&&imported)} disabled={!!(useImport&&imported)} spellCheck={false} autoComplete="off" rows={3} value={cookies} onChange={e=>setCookies(e.target.value)} placeholder={account?"Saved session encrypted. Paste replacement cookie JSON, or leave blank to keep it.":"Paste exported cookie JSON array here"} />
  <div className="cookie-account-actions">
   {account&&<span>{account.used||0}{account.capacity===null?"":" / "+account.capacity} in use</span>}
   {account&&account.capacity!==null&&(account.used||0)>=account.capacity&&<span>Full</span>}
   <label className="check"><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)} />Enabled</label>
   <button disabled={busy}>{account?"Save":"+ Add account"}</button>
  </div>
 </form>;
}
export function PhraslyCookieAccounts(props:Props) {
 const used=props.accounts.reduce((n,a)=>n+(a.used||0),0),unlimited=props.accounts.some(a=>a.enabled&&a.capacity===null);
 const total=props.accounts.filter(a=>a.enabled).reduce((n,a)=>n+(a.capacity||0),0);
 return <section className="cookie-tools" aria-label="Cookie-Based Tools">
  <div className="section-heading"><h2>Phrasly</h2><span>{used} in use {unlimited?"(unlimited capacity)":"/ "+total+" capacity"}</span></div>
  <p>Update an account below, or add another Phrasly account. Leave capacity blank for unlimited reuse.</p>
  {props.imported&&<div className="message" role="status">{props.imported.count} cookies received. Select “Use the received cookies” on the account you want to update.</div>}
  {props.accounts.map(a=><AccountRow key={a.id+":"+a.label+":"+a.target_url+":"+a.capacity+":"+a.enabled} {...props} account={a} />)}
  {!props.accounts.length&&<p>No accounts added yet.</p>}
  <AccountRow {...props} />
 </section>;
}
