import {useEffect,useState} from "react";
import {useMutation,useQuery,useQueryClient} from "@tanstack/react-query";
import {toast} from "sonner";
import {adminGetGrammarlyControls,adminUpdateGrammarlyControls} from "@/lib/grammarly-controls.functions";
export function GrammarlyControlsCard({userId}:{userId:string}){
 const qc=useQueryClient(),key=["admin-grammarly-controls",userId];
 const {data,error}=useQuery({queryKey:key,queryFn:()=>adminGetGrammarlyControls({data:{userId}})});
 const [account,setAccount]=useState<"account_1"|"account_2">("account_1");
 useEffect(()=>{if(data)setAccount(data.provider_account_key)},[data,userId]);
 const save=useMutation({mutationFn:()=>adminUpdateGrammarlyControls({data:{userId,provider_account_key:account}}),onSuccess:()=>{toast.success("Grammarly account assignment saved");qc.invalidateQueries({queryKey:key});},onError:(e:Error)=>toast.error(e.message)});
 return <div className="mt-6 rounded-2xl border bg-card p-4"><h2 className="text-sm font-semibold">Grammarly proxy account</h2><p className="mt-1 text-xs text-muted-foreground">Choose the account this writer uses. Changing accounts revokes old launches and closes live checking connections. Open Grammarly again from the dashboard.</p>{error?<p role="alert">Could not load Grammarly controls.</p>:!data?<p>Loading…</p>:<div className="mt-3 flex gap-3"><label htmlFor="grammarly-provider-account" className="sr-only">Grammarly account</label><select id="grammarly-provider-account" className="rounded border bg-background p-2" value={account} onChange={e=>setAccount(e.target.value as typeof account)}><option value="account_1">Account 1</option><option value="account_2">Account 2</option></select><button className="rounded border px-3 py-2 text-sm" disabled={save.isPending} onClick={()=>save.mutate()}>{save.isPending?"Saving…":"Save Grammarly account"}</button></div>}</div>;
}
