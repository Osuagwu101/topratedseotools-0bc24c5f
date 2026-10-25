import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
type Purchase={id:string;user_id:string;quantity:number;total_amount_ngn:number;status:string;payment_gateway:string|null;payment_reference:string|null;gateway_reference:string|null;created_at:string;paid_at:string|null;last_error:string|null};
type Batch={id:string;purchase_id:string|null;granted_credits:number;created_at:string};
export const getTurnitinAdminPurchases=createServerFn({method:"GET"}).middleware([requireSupabaseAuth]).handler(async ({context})=>{
 const role=await context.supabase.rpc("has_role",{_user_id:context.userId,_role:"admin"});
 if(role.error || !role.data) throw new Error("Admin access required");
 const {supabaseAdmin}=await import("@/integrations/supabase/client.server");
 // Database type definitions predate installed Turnitin tables.
 // eslint-disable-next-line @typescript-eslint/no-explicit-any
 const db=supabaseAdmin as any;
 const [p,b]=await Promise.all([
  db.from("turnitin_credit_purchases").select("id,user_id,quantity,total_amount_ngn,status,payment_gateway,payment_reference,gateway_reference,created_at,paid_at,last_error").order("created_at",{ascending:false}).limit(1000),
  db.from("turnitin_credit_batches").select("id,purchase_id,granted_credits,created_at").not("purchase_id","is",null).limit(1000)
 ]);
 if(p.error) throw new Error(p.error.message);
 if(b.error) throw new Error(b.error.message);
 const purchases=(p.data??[]) as Purchase[];
 const batches=(b.data??[]) as Batch[];
 const ids=[...new Set(purchases.map(r=>r.user_id))];
 const pr=ids.length?await db.from("profiles").select("id,email,full_name").in("id",ids):{data:[],error:null};
 if(pr.error) throw new Error(pr.error.message);
 const profiles=new Map(((pr.data??[]) as {id:string;email:string|null;full_name:string|null}[]).map(x=>[x.id,x]));
 const counts=new Map<string,{quantity:number;batches:number}>();
 for(const row of batches)if(row.purchase_id){const v=counts.get(row.purchase_id)??{quantity:0,batches:0};v.quantity+=row.granted_credits;v.batches++;counts.set(row.purchase_id,v);}
 const rows=purchases.map(row=>{
  const credited=counts.get(row.id)??{quantity:0,batches:0};
  const profile=profiles.get(row.user_id);
  return {...row,email:profile?.email??null,name:profile?.full_name??null,credited_credits:credited.quantity,batch_count:credited.batches,
   exception: row.status==="paid" && credited.quantity!==row.quantity?"Paid purchase credit mismatch":row.status!=="paid"&&credited.quantity>0?"Credits allocated to unpaid purchase":null};
 });
 return {rows,totals:{purchases:rows.length,paid:rows.filter(x=>x.status==="paid").length,paidNgn:rows.filter(x=>x.status==="paid").reduce((n,x)=>n+x.total_amount_ngn,0),creditsPurchased:rows.filter(x=>x.status==="paid").reduce((n,x)=>n+x.quantity,0),exceptions:rows.filter(x=>x.exception).length},limited:purchases.length===1000||batches.length===1000,generatedAt:new Date().toISOString()};
});
