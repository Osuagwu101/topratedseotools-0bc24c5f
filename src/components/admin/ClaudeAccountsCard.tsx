import {useState} from "react";
import {useQuery,useQueryClient} from "@tanstack/react-query";
import {toast} from "sonner";
import {adminListClaudeAccounts,adminVerifyClaudeAccount,adminDisableClaudeAccount} from "@/lib/claude-accounts.functions";
export function ClaudeAccountsCard(){
 const qc=useQueryClient(),queryKey=["admin-claude-provider-accounts"];
 const {data,error}=useQuery({queryKey,queryFn:()=>adminListClaudeAccounts()});
 const [busy,setBusy]=useState(false);
 async function action(account_key:"account_1"|"account_2",disable=false){
  setBusy(true);try{if(disable){await adminDisableClaudeAccount({data:{account_key}});toast.success("Account disabled");}else{const r=await adminVerifyClaudeAccount({data:{account_key}});toast[r.ok?"success":"error"](r.message);}await qc.invalidateQueries({queryKey});}catch(e){toast.error(e instanceof Error?e.message:"Could not update account");}finally{setBusy(false);}
 }
 return <div className="rounded-2xl border bg-card p-5"><h3 className="font-semibold">Claude proxy accounts</h3><p className="my-2 text-sm text-muted-foreground">Connect and verify each account separately. Assign writers to an account from their customer page.</p>{error?<p role="alert">Could not load accounts.</p>:<div className="grid gap-4 sm:grid-cols-2">{data?.map(a=><div key={a.account_key} className="rounded border p-4"><h4 className="font-medium">{a.account_key==="account_1"?"Account 1":"Account 2"}</h4><p className="mt-2 text-sm text-muted-foreground">{a.account_key === "account_1"
 ? "Sign in to Claude in the Account 1 server browser, then verify here. The saved-session form below belongs to Account 1."
 : "Sign in to Claude in the Account 2 server browser, then verify here. This account has no session JSON form."}</p><p className="my-2 text-sm">Status: {a.status.replaceAll("_"," ")}</p><button disabled={busy} className="rounded border px-3 py-2 text-sm" onClick={()=>action(a.account_key)}>Verify connection</button><button disabled={busy} className="ml-2 rounded border px-3 py-2 text-sm" onClick={()=>action(a.account_key,true)}>Disable</button></div>)}</div>}</div>;
}
