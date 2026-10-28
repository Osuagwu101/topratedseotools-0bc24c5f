import {useEffect,useState} from "react";
import {useQuery,useMutation,useQueryClient} from "@tanstack/react-query";
import {supabase} from "@/integrations/supabase/client";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";

type Feature={feature_key:string;daily_limit:number;is_unlimited:boolean;enabled:boolean};
async function adminRequest(body?:unknown){
 const {data}=await supabase.auth.getSession();if(!data.session)throw new Error("Sign in as Admin to manage Phrasly limits.");
 const r=await fetch('/ext-admin',{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+data.session.access_token,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),credentials:'same-origin',cache:'no-store'});
 const value=await r.json();if(!r.ok||value.ok===false)throw new Error(value.error==='forbidden'?'Only the account owner can manage Phrasly limits.':value.error==='feature_access_not_found'?'Assign Phrasly access to this customer first.':'Could not load or save Phrasly limits. Please try again.');return value;
}
export function PhraslyCustomerControlsCard({userId}:{userId:string}){
 const {data,isLoading,error,refetch}=useQuery<{features:Feature[]}>({queryKey:['admin-phrasly-controls',userId],queryFn:async()=>{const result=await adminRequest();return result.staff.find((w:{id:string})=>w.id===userId)||{features:[]};},refetchOnWindowFocus:true});
 return <div data-trst-phrasly-controls={userId} className="mt-6 rounded-2xl border bg-card p-4">
  <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Phrasly controls</h2><p className="mt-1 text-xs text-muted-foreground">Set this customer's Humanizer and AI Detector daily limits separately. Unlimited removes the daily cap. Usage resets at midnight Nigeria time.</p></div><Button size="sm" variant="outline" onClick={()=>void refetch()} disabled={isLoading}>Refresh Phrasly limits</Button></div>
  {isLoading?<div className="mt-4 text-xs text-muted-foreground">Loading Phrasly controls…</div>:error?<div className="mt-4 text-xs text-destructive" role="alert">{(error as Error).message}</div>:<div className="mt-4 grid gap-4 md:grid-cols-2">{(['humanizer','ai_detector'] as const).map(key=>{const feature=data?.features.find(f=>f.feature_key===key);return feature?<PhraslyFeatureLimit key={key} userId={userId} feature={feature}/>:<div key={key} className="rounded-xl border p-3"><strong className="text-sm">{key==='humanizer'?'Humanizer':'AI Detector'}</strong><p className="mt-2 text-xs text-muted-foreground">Assign Phrasly access to this customer to manage this feature.</p></div>;})}</div>}
  <p className="mt-3 text-xs text-muted-foreground">Changing a limit keeps access dates, current usage and revoked access unchanged. <a className="text-primary underline" href="/admin/phrasly">Phrasly account &amp; access settings</a></p>
 </div>;
}
function PhraslyFeatureLimit({userId,feature}:{userId:string;feature:Feature}){
 const qc=useQueryClient(),name=feature.feature_key==='humanizer'?'Humanizer':'AI Detector';
 const [value,setValue]=useState(String(feature.daily_limit)),[unlimited,setUnlimited]=useState(feature.is_unlimited),[notice,setNotice]=useState('');
 useEffect(()=>{setValue(String(feature.daily_limit));setUnlimited(feature.is_unlimited);},[userId,feature.daily_limit,feature.is_unlimited]);
 const save=useMutation({mutationFn:(limit:number|null)=>adminRequest({action:'set_limit',user_id:userId,feature:feature.feature_key,limit}),onSuccess:async()=>{setNotice(name+' limit saved.');await qc.invalidateQueries({queryKey:['admin-phrasly-controls',userId]});},onError:()=>setNotice('')});
 const number=Number(value),valid=unlimited||(value.trim()!==''&&Number.isInteger(number)&&number>=1&&number<=10000);
 return <form className="rounded-xl border p-3" aria-label={'Phrasly '+name+' limits'} onSubmit={e=>{e.preventDefault();if(valid&&!save.isPending)save.mutate(unlimited?null:number);}}>
  <div className="flex flex-wrap items-start justify-between gap-3"><strong className="text-sm font-medium">{name}</strong><span className="text-xs text-muted-foreground">{feature.enabled?'Access enabled':'Access revoked'}</span></div>
  <p className="mt-2 text-xs text-muted-foreground">Current limit: <strong>{feature.is_unlimited?'Unlimited':feature.daily_limit+' / day'}</strong></p>
  <div className="mt-3"><Label htmlFor={'phrasly-'+feature.feature_key+'-limit'}>{name} daily limit</Label><Input id={'phrasly-'+feature.feature_key+'-limit'} type="number" min={1} max={10000} step={1} value={value} required={!unlimited} disabled={unlimited||save.isPending} onChange={e=>{setValue(e.target.value);setNotice('');}}/></div>
  <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={unlimited} disabled={save.isPending} onChange={e=>{setUnlimited(e.target.checked);setNotice('');}}/>Unlimited {name}</label>
  <div className="mt-4 flex flex-wrap gap-2"><Button size="sm" type="submit" disabled={!valid||save.isPending}>{save.isPending?'Saving…':'Save '+name+' limit'}</Button><Button size="sm" type="button" variant="outline" disabled={save.isPending||feature.is_unlimited} onClick={()=>save.mutate(null)}>Remove {name} limit</Button></div>
  {notice&&<p role="status" className="mt-2 text-xs text-success">{notice}</p>}{save.error&&<p role="alert" className="mt-2 text-xs text-destructive">{(save.error as Error).message}</p>}
 </form>;
}
