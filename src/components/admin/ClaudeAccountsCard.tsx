import {useState} from "react";
import {useQuery,useQueryClient} from "@tanstack/react-query";
import {useServerFn} from "@tanstack/react-start";
import {Save} from "lucide-react";
import {toast} from "sonner";
import {
 adminListClaudeAccounts,
 adminSaveClaudeAccountSession,
 adminVerifyClaudeAccount,
 adminRevokeClaudeAccountSession,
 adminDisableClaudeAccount,
 type ClaudeAccountView,
} from "@/lib/claude-accounts.functions";

const queryKey=["admin-claude-provider-accounts"];

function formatTime(value:string|null){
 return value?new Date(value).toISOString().replace("T"," ").replace(/\.\d{3}Z$/," UTC"):"Never";
}

/** Claude provider accounts: one session JSON card per account, like StealthWriter. */
export function ClaudeAccountsCard(){
 const {data,error,isLoading}=useQuery({queryKey,queryFn:()=>adminListClaudeAccounts()});
 return (
  <div className="space-y-4">
   <div className="rounded-2xl border bg-card p-5 shadow-card">
    <h3 className="text-sm font-semibold">Claude proxy accounts</h3>
    <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">
     Each proxy account stores its own authorised Claude session securely. Pasting a session JSON
     on a card saves it, loads it into that account's server browser and activates the account.
     Secret values are encrypted server-side and are never displayed back in the browser.
    </p>
    <div className="mt-3 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
     Writers launch through claude.topratedseotools.com and use the account selected on their customer
     page. Replacing a session signs out writers assigned to that account; they relaunch from their dashboard.
    </div>
   </div>
   {error?<p role="alert" className="text-sm text-destructive">Could not load Claude accounts.</p>
    :isLoading||!data?<p className="text-sm text-muted-foreground">Loading accounts…</p>
    :data.accounts.map(a=><ClaudeAccountSessionCard key={a.account_key} account={a} canManage={data.can_manage}/>)}
  </div>
 );
}

function ClaudeAccountSessionCard({account,canManage}:{account:ClaudeAccountView;canManage:boolean}){
 const qc=useQueryClient();
 const saveSession=useServerFn(adminSaveClaudeAccountSession);
 const verify=useServerFn(adminVerifyClaudeAccount);
 const revoke=useServerFn(adminRevokeClaudeAccountSession);
 const disable=useServerFn(adminDisableClaudeAccount);
 const [sessionData,setSessionData]=useState("");
 const [busy,setBusy]=useState<null|"save"|"verify"|"revoke"|"disable">(null);
 const name=account.display_name;
 const key=account.account_key;

 async function run(kind:NonNullable<typeof busy>,fn:()=>Promise<void>){
  setBusy(kind);
  try{await fn();}catch(e){toast.error(e instanceof Error?e.message:"Could not update the account.");}
  finally{setBusy(null);await qc.invalidateQueries({queryKey});}
 }
 const save=()=>{
  if(!sessionData.trim()){toast.error(`Paste the authorised session JSON for ${name} first.`);return;}
  return run("save",async()=>{
   const r=await saveSession({data:{account_key:key,session_data:sessionData.trim()}});
   setSessionData("");
   toast[r.ok?"success":"error"](r.message);
  });
 };

 const connected=account.status==="connected";
 const statusClass=connected?"bg-success/15 text-success":account.status==="disabled"?"bg-destructive/10 text-destructive":"bg-muted text-muted-foreground";
 return (
  <div className="rounded-2xl border bg-card p-5 shadow-card">
   <div className="flex flex-wrap items-start justify-between gap-3">
    <div>
     <div className="flex flex-wrap items-center gap-2">
      <h3 className="text-sm font-semibold">{name}</h3>
      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-primary">
       {key==="account_1"?"Routing + rollback bridge":"Routing enabled"}
      </span>
     </div>
     <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
      Writers assigned to {name} use this session. Saving a new session here replaces only {name}'s login.
     </p>
    </div>
    <div className="text-right">
     <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase ${statusClass}`}>
      {connected?"Active":account.status==="disabled"?"Disabled":"Needs session"}
     </span>
     <div className="mt-1 text-[11px] text-muted-foreground">
      Session: {account.session_configured?"Stored":account.session_status==="revoked"?"Revoked":"Not configured"}
     </div>
     <div className="text-[11px] text-muted-foreground">Last replaced: {formatTime(account.session_updated_at)}</div>
     <div className="text-[11px] text-muted-foreground">Last verified: {formatTime(account.verified_at)}</div>
    </div>
   </div>

   <div className="mt-5 rounded-xl border border-dashed bg-muted/20 p-4">
    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{name} session JSON</div>
    <textarea
     value={sessionData}
     onChange={e=>setSessionData(e.target.value)}
     rows={7}
     autoComplete="off"
     spellCheck={false}
     data-1p-ignore="true"
     data-lpignore="true"
     disabled={!canManage||!!busy}
     placeholder={'{"version":2,"cookies":[{"name":"sessionKey","value":"...","domain":".claude.ai","path":"/"}]}'}
     className="mt-2 w-full resize-y rounded-md border bg-background px-3 py-2 font-mono text-xs leading-relaxed"
    />
    <p className="mt-2 text-xs text-muted-foreground">
     Paste the multi-cookie session JSON or a browser cookie-export array for {name}.
     It must contain a current sessionKey cookie. Only claude.ai cookies are kept; analytics and challenge
     cookies are discarded. The stored session is write-only from this page.
    </p>
   </div>

   <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
    <span className="text-xs text-muted-foreground">
     {canManage?`Save & activate loads this login into the ${name} server browser and verifies it.`:"Only a Super Admin can replace Claude account sessions."}
    </span>
    <div className="flex flex-wrap gap-2">
     <button type="button" disabled={!canManage||!!busy} className="rounded-full border px-4 py-2 text-sm disabled:opacity-50"
      onClick={()=>run("verify",async()=>{const r=await verify({data:{account_key:key}});toast[r.ok?"success":"error"](r.message);})}>
      {busy==="verify"?"Verifying…":"Verify connection"}
     </button>
     {account.status!=="disabled"?(
      <button type="button" disabled={!canManage||!!busy} className="rounded-full border px-4 py-2 text-sm disabled:opacity-50"
       onClick={()=>{if(!confirm(`Disable ${name}? Writers assigned to it will be signed out.`))return;void run("disable",async()=>{await disable({data:{account_key:key}});toast.success(`${name} disabled.`);});}}>
       {busy==="disable"?"Disabling…":"Disable"}
      </button>
     ):null}
     {account.session_configured?(
      <button type="button" disabled={!canManage||!!busy}
       className="rounded-full border border-destructive/40 px-4 py-2 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
       onClick={()=>{if(!confirm(`Revoke the stored ${name} session?`))return;void run("revoke",async()=>{await revoke({data:{account_key:key}});toast.success(`${name} session revoked.`);});}}>
       {busy==="revoke"?"Revoking…":"Revoke session"}
      </button>
     ):null}
     <button type="button" onClick={save} disabled={!canManage||!!busy||!sessionData.trim()}
      className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-glow hover:opacity-90 disabled:opacity-50">
      <Save className="h-4 w-4"/>
      {busy==="save"?"Activating…":account.session_configured?"Replace & activate":"Save & activate"}
     </button>
    </div>
   </div>
  </div>
 );
}
