import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { requireAdminOrRedirect } from "@/lib/admin-gate";
import { getTurnitinAdminOverview } from "@/lib/turnitin-admin-phase2.functions";

export const Route=createFileRoute("/admin/turnitin")({
  ssr:false,beforeLoad:async()=>{await requireAdminOrRedirect();},
  head:()=>({meta:[{title:"Turnitin Checks — Admin"},{name:"robots",content:"noindex"}]}),
  component:TurnitinChecksAdmin
});
function TurnitinChecksAdmin(){
 const params=new URLSearchParams(typeof window==="undefined"?"":window.location.search);
 const [view,setView]=useState(params.get("view")||"dashboard");
 const [search,setSearch]=useState("");
 const [status,setStatus]=useState("all");
 const {data,error,isLoading,refetch}=useQuery({queryKey:["turnitin-admin-phase2"],queryFn:()=>getTurnitinAdminOverview(),refetchInterval:60000});
 const rows=(view==="attention"?data?.attention:data?.jobs)??[];
 const filtered=rows.filter(j=>(status==="all"||j.status===status)&&[j.id,j.email,j.original_filename,j.display_name].join(" ").toLowerCase().includes(search.toLowerCase()));
 return <AdminShell><div className="mx-auto max-w-[1500px] space-y-4 p-6">
  <header className="flex items-center justify-between"><div><h1 className="text-2xl font-semibold">Turnitin Checks</h1><p className="text-sm text-muted-foreground">Read-only administrative monitoring</p></div><button className="rounded border px-3 py-2" onClick={()=>void refetch()}>Refresh</button></header>
  <nav className="flex flex-wrap gap-2">{[["dashboard","Dashboard"],["submissions","All Submissions"],["reports","Reports & Results"],["attention","Attention Queue"]].map(([key,label])=><button key={key} className={"rounded border px-3 py-2 text-sm "+(view===key?"bg-primary text-primary-foreground":"")} onClick={()=>{setView(key);window.history.replaceState(null,"","/admin/turnitin"+(key==="dashboard"?"":"?view="+key));}}>{label}</button>)}</nav>
  {isLoading&&<p>Loading Turnitin records…</p>}
  {error&&<p role="alert" className="text-destructive">{error instanceof Error?error.message:"Unable to load records"}</p>}
  {data&&<>
   {data.limited&&<p className="text-amber-700">More than 1,000 records exist; displayed totals may be partial.</p>}
   {view==="dashboard"&&<section className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Object.entries(data.totals).map(([k,v])=><div className="rounded-lg border bg-card p-4" key={k}><p className="text-xs capitalize text-muted-foreground">{k}</p><p className="text-2xl font-semibold">{Number(v).toLocaleString()}</p></div>)}</section>}
   {view==="reports"?<div className="overflow-x-auto rounded border"><table className="w-full text-left text-sm"><thead><tr><th className="p-3">Report</th><th className="p-3">Submission</th><th className="p-3">Type</th><th className="p-3">Created</th></tr></thead><tbody>{data.reports.map(r=><tr key={r.id} className="border-t"><td className="p-3 font-mono">{r.id.slice(0,12)}</td><td className="p-3 font-mono">{r.job_id.slice(0,12)}</td><td className="p-3">{r.report_type}</td><td className="p-3">{new Date(r.created_at).toLocaleString()}</td></tr>)}</tbody></table></div>:<section className="space-y-3">
    {view==="attention"&&<p className="text-sm text-muted-foreground">Failed or long-running jobs only. No retries or credit adjustments are performed.</p>}
    <div className="flex gap-2"><input className="min-w-0 flex-1 rounded border bg-background p-2" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search customer, file or ID"/><select className="rounded border bg-background p-2" value={status} onChange={e=>setStatus(e.target.value)}>{["all","completed","failed","uploading","queued","processing"].map(x=><option key={x}>{x}</option>)}</select></div>
    <div className="overflow-x-auto rounded border"><table className="w-full text-left text-sm"><thead><tr>{["Created","Customer","Document","Status","Credit","Similarity / AI"].map(t=><th key={t} className="p-3">{t}</th>)}</tr></thead><tbody>{filtered.slice(0,250).map(j=><tr className="border-t" key={j.id}><td className="p-3">{new Date(j.created_at).toLocaleString()}</td><td className="p-3">{j.email??j.user_id}</td><td className="p-3">{j.display_name||j.original_filename}<div className="font-mono text-xs opacity-60">{j.id.slice(0,12)}</div></td><td className="p-3">{j.status}</td><td className="p-3">{j.credit_state}</td><td className="p-3">{j.similarity_percentage??"—"} / {j.ai_percentage??"—"}</td></tr>)}</tbody></table></div>
    </section>}
   <p className="text-xs text-muted-foreground">As of {new Date(data.generatedAt).toLocaleString()}; no changes to credit balances or submissions.</p>
  </>}
 </div></AdminShell>;
}
