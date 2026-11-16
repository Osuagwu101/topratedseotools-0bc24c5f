import {useState} from "react";
import {useQuery,useQueryClient} from "@tanstack/react-query";
import {toast} from "sonner";
import {adminListChatGptAccounts,adminSaveChatGptSession,adminRevokeChatGptSession,adminVerifyChatGptAccount} from "@/lib/chatgpt-session.functions";
export function ChatGptAccountsCard(){
 const key=["admin-chatgpt-provider-accounts"];
 const {data,error}=useQuery({queryKey:key,queryFn:()=>adminListChatGptAccounts()});
 const qc=useQueryClient();const [sessions,setSessions]=useState<Record<string,string>>({});const [busy,setBusy]=useState(false);
 async function action(account_key:"account_1"|"account_2",kind:"save"|"verify"|"revoke"){
 setBusy(true);try{
 if(kind==="save"){await adminSaveChatGptSession({data:{account_key,session_data:sessions[account_key]??""}});setSessions(s=>({...s,[account_key]:""}));toast.success("Account session saved securely");}
 else if(kind==="revoke"){await adminRevokeChatGptSession({data:{account_key}});toast.success("Account session revoked");}
 else{const r=await adminVerifyChatGptAccount({data:{account_key}});toast[r.ok?"success":"error"](r.message);}
 await qc.invalidateQueries({queryKey:key});await qc.invalidateQueries({queryKey:["admin-chatgpt-authorized-session"]});
 }catch(e){toast.error(e instanceof Error?e.message:"Could not update account");}finally{setBusy(false);}}
 return <div className="space-y-4"><h3 className="font-semibold">ChatGPT proxy accounts</h3><p className="text-sm text-muted-foreground">Save each account's authorised session separately. Verify Account 2 before assigning writers. Refreshing or revoking one account affects its own launches. Sessions are encrypted and never displayed after saving.</p>{error?<p role="alert">Could not load ChatGPT accounts.</p>:<div className="grid gap-4 lg:grid-cols-2">{data?.accounts.map(a=>{const account=a.account_key as "account_1"|"account_2";return <div key={account} className="rounded-2xl border bg-card p-5"><h4 className="font-semibold">{account==="account_1"?"Account 1":"Account 2"}</h4><p className="my-2 text-sm">{a.status.replaceAll("_"," ")}{a.verified_at?" · verified":""}</p><label className="text-xs" htmlFor={account+"-session"}>Authorised ChatGPT session JSON</label><textarea id={account+"-session"} rows={8} autoComplete="off" spellCheck={false} data-1p-ignore="true" disabled={!data.can_manage||busy} className="mt-2 w-full rounded border bg-background p-3 font-mono text-xs" value={sessions[account]??""} onChange={e=>setSessions(s=>({...s,[account]:e.target.value}))} placeholder={'{"version":2,"cookies":[...]}'} /><div className="mt-3 flex flex-wrap gap-2"><button className="rounded border px-3 py-2 text-sm" disabled={!data.can_manage||busy||!sessions[account]?.trim()} onClick={()=>action(account,"save")}>Save / replace</button><button className="rounded border px-3 py-2 text-sm" disabled={!data.can_manage||busy||!a.configured} onClick={()=>action(account,"verify")}>Verify connection</button><button className="rounded border px-3 py-2 text-sm" disabled={!data.can_manage||busy||!a.configured} onClick={()=>action(account,"revoke")}>Revoke</button></div></div>;})}</div>}</div>;
}
