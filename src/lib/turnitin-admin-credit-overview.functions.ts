import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Batch = { id:string;user_id:string;source:string;granted_credits:number;available_credits:number;reserved_credits:number;consumed_credits:number;expired_credits:number;refunded_credits:number;created_at:string;expires_at:string|null;note:string|null };
type Event = {id:string;user_id:string;batch_id:string;event_type:string;available_delta:number;reserved_delta:number;consumed_delta:number;expired_delta:number;refunded_delta:number;created_at:string;note:string|null};
export const getTurnitinAdminCredits = createServerFn({method:"GET"}).middleware([requireSupabaseAuth]).handler(async ({context}) => {
 const {data:allowed,error:roleError}=await context.supabase.rpc("has_role",{_user_id:context.userId,_role:"admin"});
 if(roleError || !allowed) throw new Error("Admin access required");
 const {supabaseAdmin}=await import("@/integrations/supabase/client.server");
 // The generated database types predate these installed Turnitin tables.
 // eslint-disable-next-line @typescript-eslint/no-explicit-any
 const db=supabaseAdmin as any;
 const [br,lr]=await Promise.all([
  db.from("turnitin_credit_batches").select("id,user_id,source,granted_credits,available_credits,reserved_credits,consumed_credits,expired_credits,refunded_credits,created_at,expires_at,note").order("created_at",{ascending:false}).limit(1000),
  db.from("turnitin_credit_ledger").select("id,user_id,batch_id,event_type,available_delta,reserved_delta,consumed_delta,expired_delta,refunded_delta,created_at,note").order("created_at",{ascending:false}).limit(2000),
 ]);
 if(br.error) throw new Error(br.error.message);
 if(lr.error) throw new Error(lr.error.message);
 const batches=(br.data??[]) as Batch[];
 const ledger=(lr.data??[]) as Event[];
 const ids=[...new Set(batches.map(b=>b.user_id))];
 const pr=ids.length ? await db.from("profiles").select("id,email,full_name").in("id",ids) : {data:[],error:null};
 if(pr.error) throw new Error(pr.error.message);
 const profiles=new Map(((pr.data??[]) as {id:string;email:string|null;full_name:string|null}[]).map(x=>[x.id,x]));
 const people=new Map<string,{user_id:string;email:string|null;name:string|null;granted:number;available:number;reserved:number;used:number;expired:number;refunded:number;batchCount:number}>();
 for (const b of batches){
  if(!people.has(b.user_id)){const profile=profiles.get(b.user_id);people.set(b.user_id,{user_id:b.user_id,email:profile?.email??null,name:profile?.full_name??null,granted:0,available:0,reserved:0,used:0,expired:0,refunded:0,batchCount:0});}
  const x=people.get(b.user_id)!;
  x.granted+=b.granted_credits;x.available+=b.available_credits;x.reserved+=b.reserved_credits;x.used+=b.consumed_credits;x.expired+=b.expired_credits;x.refunded+=b.refunded_credits;x.batchCount++;
 }
 const sums=new Map<string,{available:number;reserved:number;used:number;expired:number;refunded:number}>();
 for(const e of ledger){const old=sums.get(e.batch_id)??{available:0,reserved:0,used:0,expired:0,refunded:0};old.available+=e.available_delta;old.reserved+=e.reserved_delta;old.used+=e.consumed_delta;old.expired+=e.expired_delta;old.refunded+=e.refunded_delta;sums.set(e.batch_id,old);}
 const discrepancies=batches.filter(b=>{const s=sums.get(b.id);return !s || b.available_credits!==s.available || b.reserved_credits!==s.reserved || b.consumed_credits!==s.used || b.expired_credits!==s.expired || b.refunded_credits!==s.refunded;}).length;
 return {customers:[...people.values()].sort((a,b)=>b.available-a.available),batches,ledger,discrepancies,limited:batches.length===1000||ledger.length===2000,generatedAt:new Date().toISOString()};
});
