import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AdminShell } from "@/components/admin/AdminShell";
import { requireAdminOrRedirect } from "@/lib/admin-gate";
import { getTurnitinAdminCredits } from "@/lib/turnitin-admin-credit-overview.functions";
export const Route=createFileRoute("/admin/turnitin-credits")({ssr:false,beforeLoad:async()=>{await requireAdminOrRedirect();},head:()=>({meta:[{title:"Turnitin Customer Credits — Admin"},{name:"robots",content:"noindex"}]}),component:CreditsPage});
function CreditsPage(){
 const {data,error,isLoading,refetch}=useQuery({queryKey:["turnitin-admin-credits"],queryFn:()=>getTurnitinAdminCredits(),refetchInterval:60000});
 const [search,setSearch]=useState("");const [selected,setSelected]=useState<string|null>(null);
 const customer=data?.customers.find(c=>c.user_id===selected);
 return <AdminShell><main className="mx-auto max-w-[1500px] space-y-5 p-6">
 <header className="flex flex-wrap justify-between gap-2"><div><h1 className="text-2xl font-semibold">Customers & Checking Slots</h1><p className="text-sm text-muted-foreground">Read-only credit balances, batches, expiry dates and audit history.</p></div><button className="rounded border px-3 py-2" onClick={()=>void refetch()}>Refresh</button></header>
 {isLoading&&<p>Loading customer credits…</p>}{error&&<p role="alert" className="text-destructive">{error instanceof Error?error.message:"Could not load credits"}</p>}
 {data&&<>
 {data.limited&&<p className="text-amber-700">The 1,000-batch or 2,000-event limit was reached; results may be incomplete.</p>}
 <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{[
 ["Customers",data.customers.length],["Available",data.customers.reduce((v,c)=>v+c.available,0)],["Reserved",data.customers.reduce((v,c)=>v+c.reserved,0)],["Ledger discrepancies",data.discrepancies]
 ].map(([label,value])=><div key={label} className="rounded-lg border bg-card p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="text-2xl font-semibold">{Number(value).toLocaleString()}</p></div>)}</div>
 <input aria-label="Search customers" className="w-full rounded-md border bg-background p-2" placeholder="Search customer name or email" value={search} onChange={e=>setSearch(e.target.value)}/>
 <div className="overflow-x-auto rounded-lg border"><table className="w-full text-left text-sm"><thead><tr>{["Customer","Granted","Used","Reserved","Available","Expired","Details"].map(v=><th key={v} className="p-3">{v}</th>)}</tr></thead><tbody>{data.customers.filter(c=>[c.email,c.name,c.user_id].join(" ").toLowerCase().includes(search.toLowerCase())).map(c=><tr key={c.user_id} className="border-t"><td className="p-3">{c.email??c.user_id}<div className="text-xs text-muted-foreground">{c.name}</div></td>{[c.granted,c.used,c.reserved,c.available,c.expired].map((n,i)=><td className="p-3" key={i}>{n.toLocaleString()}</td>)}<td className="p-3"><button className="text-primary underline" onClick={()=>setSelected(c.user_id)}>View history</button></td></tr>)}</tbody></table></div>
 {customer&&<section className="space-y-3 rounded-lg border bg-card p-4"><div className="flex items-center justify-between"><h2 className="font-semibold">Credit history: {customer.email??customer.user_id}</h2><button className="rounded border px-2 py-1" onClick={()=>setSelected(null)}>Close</button></div>
 <h3 className="font-medium">Credit batches and expiry</h3><div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{["Source","Granted","Available","Reserved","Used","Expired","Expires"].map(x=><th key={x} className="p-2">{x}</th>)}</tr></thead><tbody>{data.batches.filter(b=>b.user_id===selected).map(b=><tr key={b.id} className="border-t"><td className="p-2">{b.source}</td>{[b.granted_credits,b.available_credits,b.reserved_credits,b.consumed_credits,b.expired_credits].map((n,i)=><td key={i} className="p-2">{n}</td>)}<td className="p-2">{b.expires_at?new Date(b.expires_at).toLocaleString():"No expiry recorded"}</td></tr>)}</tbody></table></div>
 <h3 className="font-medium">Ledger events</h3><div className="max-h-72 overflow-auto"><table className="w-full text-left text-sm"><thead><tr>{["Date","Event","Available Δ","Reserved Δ","Used Δ","Note"].map(x=><th key={x} className="p-2">{x}</th>)}</tr></thead><tbody>{data.ledger.filter(e=>e.user_id===selected).map(e=><tr key={e.id} className="border-t"><td className="p-2">{new Date(e.created_at).toLocaleString()}</td><td className="p-2">{e.event_type}</td><td className="p-2">{e.available_delta}</td><td className="p-2">{e.reserved_delta}</td><td className="p-2">{e.consumed_delta}</td><td className="p-2">{e.note??"—"}</td></tr>)}</tbody></table></div>
 </section>}
 <p className="text-xs text-muted-foreground">Generated {new Date(data.generatedAt).toLocaleString()}. This screen cannot modify credit balances.</p>
 </>}
 </main></AdminShell>;
}
