import React,{useEffect,useState} from "react";

type Feature={feature_key:string;daily_limit:number;is_unlimited?:boolean;enabled:boolean};
export function PhraslyDailyLimitEditor({writer,feature,disabled,onSave}:{writer:string;feature:Feature;disabled:boolean;onSave:(limit:number|null)=>Promise<void>}){
 const [value,setValue]=useState(String(feature.daily_limit));
 const [unlimited,setUnlimited]=useState(feature.is_unlimited===true);
 useEffect(()=>{setValue(String(feature.daily_limit));setUnlimited(feature.is_unlimited===true);},[feature.daily_limit,feature.is_unlimited]);
 const label=feature.feature_key==="humanizer"?"Humanizer":"AI Detector";
 const name=writer+" "+label;
 const numeric=Number(value),valid=unlimited||(value.trim()!==""&&Number.isInteger(numeric)&&numeric>=1&&numeric<=10000);
 const changed=unlimited!==(feature.is_unlimited===true)||(!unlimited&&numeric!==feature.daily_limit);
 return <form aria-label={name+" limits"} onSubmit={e=>{e.preventDefault();if(valid&&!disabled)void onSave(unlimited?null:numeric);}}>
  <strong>{label}: {feature.is_unlimited?"Unlimited":feature.daily_limit+" / day"}{feature.enabled?"":" (revoked)"}</strong>
  <div className="row"><label>Requests per day<input aria-label={name+" daily limit"} type="number" min="1" max="10000" step="1" required={!unlimited} disabled={disabled||unlimited} value={value} onChange={e=>setValue(e.target.value)} /></label>
  <label className="check"><input aria-label={name+" unlimited"} type="checkbox" disabled={disabled} checked={unlimited} onChange={e=>setUnlimited(e.target.checked)} /> Unlimited</label></div>
  <div className="row"><button type="submit" disabled={disabled||!valid||!changed}>Save limit</button><button type="button" className="secondary" disabled={disabled||feature.is_unlimited===true} onClick={()=>void onSave(null)}>Remove limit</button></div>
 </form>;
}
