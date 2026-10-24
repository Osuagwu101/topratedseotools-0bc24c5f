import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { verifyTurnitinPurchaseGateway } from "@/lib/turnitin-admin-credit-actions.functions";
import { TurnitinJobCreditPanel } from "@/components/admin/TurnitinJobCreditPanel";
import { AdminShell } from "@/components/admin/AdminShell";
import { requireAdminOrRedirect } from "@/lib/admin-gate";
import { getTurnitinAdminPurchases } from "@/lib/turnitin-admin-purchases.functions";
export const Route=createFileRoute("/admin/turnitin-purchases")({ssr:false,beforeLoad:async()=>{await requireAdminOrRedirect();},head:()=>({meta:[{title:"Turnitin Purchases — Admin"},{name:"robots",content:"noindex"}]}),component:Purchases});
function Purchases(){
 const {data,error,isLoading,refetch}=useQuery({queryKey:["turnitin-admin-purchases"],queryFn:()=>getTurnitinAdminPurchases(),refetchInterval:60000});
 const [search,setSearch]=useState("");const [status,setStatus]=useState("all");
 const [verification,setVerification]=useState<string|null>(null);
 const verify=useMutation({mutationFn:(id:string)=>verifyTurnitinPurchaseGateway({data:{purchaseId:id}})});

 const rows=(data?.rows??[]).filter(x=>(status==="all"||status===x.status)&&[x.email,x.name,x.payment_reference,x.gateway_reference,x.id].join(" ").toLowerCase().includes(search.toLowerCase()));
 return <AdminShell><main className="mx-auto max-w-[1500px] space-y-4 p-6">
 <header className="flex flex-wrap justify-between gap-3"><div><h1 className="text-2xl font-semibold">Turnitin Purchases & Payments</h1><p className="text-sm text-muted-foreground">Read-only purchases, gateway references and checking-credit reconciliation.</p></div><button className="rounded border px-3 py-2" onClick={()=>void refetch()}>Refresh</button></header>
 {isLoading&&<p>Loading purchase records…</p>}{error&&<p role="alert" className="text-destructive">{error instanceof Error?error.message:"Unable to load purchases"}</p>}
 {data&&<>
 {data.limited&&<p className="text-amber-700">The 1,000 record limit was reached; displayed totals may be incomplete.</p>}
 <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">{Object.entries(data.totals).map(([k,v])=><div key={k} className="rounded-lg border bg-card p-3"><p className="text-xs capitalize text-muted-foreground">{k}</p><p className="text-xl font-semibold">{Number(v).toLocaleString()}</p></div>)}</section>
 <div className="flex flex-wrap gap-2"><input value={search} onChange={e=>setSearch(e.target.value)} aria-label="Search purchases" placeholder="Search customer, reference, ID" className="min-w-[250px] flex-1 rounded border bg-background p-2"/><select value={status} onChange={e=>setStatus(e.target.value)} aria-label="Purchase status" className="rounded border bg-background p-2">{["all","paid","pending","failed","refunded","cancelled"].map(x=><option key={x}>{x}</option>)}</select></div>
 <div className="overflow-x-auto rounded-lg border"><table className="w-full text-left text-sm"><thead><tr>{["Created","Customer","Reference","Gateway","Status","Amount (₦)","Credits bought","Credits issued","Reconciliation","Verify"].map(x=><th key={x} className="p-3">{x}</th>)}</tr></thead><tbody>{rows.map(x=><tr key={x.id} className="border-t"><td className="p-3 whitespace-nowrap">{new Date(x.created_at).toLocaleString()}</td><td className="p-3">{x.email??x.user_id}</td><td className="p-3 break-all font-mono text-xs">{x.payment_reference??x.gateway_reference??"—"}</td><td className="p-3">{x.payment_gateway??"—"}</td><td className="p-3">{x.status}</td><td className="p-3">{x.total_amount_ngn.toLocaleString()}</td><td className="p-3">{x.quantity}</td><td className="p-3">{x.credited_credits}</td><td className="p-3">{x.exception??"Matched"}</td><td className="p-3"><button type="button" disabled={verify.isPending} className="rounded border px-2 py-1" onClick={()=>{setVerification(x.id);verify.mutate(x.id);}}>Verify payment</button></td></tr>)}</tbody></table>{!rows.length&&<p className="p-5 text-center text-sm text-muted-foreground">No matching purchases.</p>}</div>
 {verify.isError&&<p role="alert" className="text-destructive">{verify.error instanceof Error?verify.error.message:"Verification failed"}</p>}
 {verify.data&&verification===verify.data.purchaseId&&<section className="rounded border p-3 text-sm" aria-live="polite">
  <strong>Live gateway result:</strong> {verify.data.gatewayStatus}. Reference {verify.data.referenceMatched?"matches":"does not match"}; amount {verify.data.amountMatched?"matches":"does not match"}; currency {verify.data.currencyMatched?"matches":"does not match"}; environment {verify.data.environmentMatched?"matches":"does not match"}. {verify.data.verifiedMatch?"Transaction details match.":"Mismatch: review manually; no credit changed."}
 </section>}
 <TurnitinJobCreditPanel onChanged={()=>void refetch()}/>
 <p className="text-xs text-muted-foreground">Generated {new Date(data.generatedAt).toLocaleString()}. Payments and credits cannot be modified here.</p>
 </>}
 </main></AdminShell>;
}
