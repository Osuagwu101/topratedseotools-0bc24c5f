import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getTurnitinAdminOverview = createServerFn({ method: "GET" }).middleware([requireSupabaseAuth]).handler(async ({context}) => {
  const {data: allowed,error: authError} = await context.supabase.rpc("has_role",{_user_id:context.userId,_role:"admin"});
  if (authError || !allowed) throw new Error("Admin access required");
  const {supabaseAdmin} = await import("@/integrations/supabase/client.server");
  // Database type definitions are older than the installed Turnitin tables.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabaseAdmin as any;
  const [jr,rr,br,cr] = await Promise.all([
    db.from("turnitin_jobs").select("id,user_id,original_filename,display_name,status,credit_state,billing_mode,created_at,updated_at,similarity_percentage,ai_percentage,upstream_last_error").order("created_at",{ascending:false}).limit(1000),
    db.from("turnitin_reports").select("id,job_id,report_type,created_at").order("created_at",{ascending:false}).limit(1000),
    db.from("turnitin_credit_batches").select("available_credits,reserved_credits"),
    db.from("turnitin_postpaid_charges").select("amount_ngn,paid_amount_ngn,status"),
  ]);
  for (const item of [jr,rr,br,cr]) if(item.error) throw new Error(item.error.message);
  type Job = {
    id:string;user_id:string;original_filename:string;display_name:string|null;
    status:string;credit_state:string;billing_mode:string;created_at:string;updated_at:string;
    similarity_percentage:number|null;ai_percentage:number|null;upstream_last_error:string|null;
  };
  type Report = {id:string;job_id:string;report_type:string;created_at:string};
  type Batch = {available_credits:number;reserved_credits:number};
  type Charge = {status:string;amount_ngn:number;paid_amount_ngn:number};
  const jobs = (jr.data??[]) as unknown as Job[];
  const reports = (rr.data??[]) as unknown as Report[];
  const batches = (br.data??[]) as unknown as Batch[];
  const charges = (cr.data??[]) as unknown as Charge[];
  const userIds = [...new Set(jobs.map(j=>j.user_id))];
  const pr = userIds.length ? await db.from("profiles").select("id,email").in("id",userIds) : {data:[],error:null};
  if(pr.error) throw new Error(pr.error.message);
  const profiles = new Map(((pr.data??[]) as unknown as {id:string;email:string|null}[]).map(v=>[v.id,v.email]));
  const decorated = jobs.map(j=>({...j,email:profiles.get(j.user_id)??null}));
  const attention = decorated.filter(j=>j.status==="failed" || (["uploading","queued","processing"].includes(j.status) && Date.now()-Date.parse(j.created_at)>3600000));
  return {
    jobs:decorated,reports,attention,generatedAt:new Date().toISOString(),
    limited: jobs.length===1000 || reports.length===1000,
    totals: {
      submissions:jobs.length,completed:jobs.filter(j=>j.status==="completed").length,
      pending:jobs.filter(j=>["uploading","queued","processing"].includes(j.status)).length,
      failed:jobs.filter(j=>j.status==="failed").length,
      available:batches.reduce((a,b)=>a+(b.available_credits??0),0),
      reserved:batches.reduce((a,b)=>a+(b.reserved_credits??0),0),
      outstanding:charges.filter(c=>c.status!=="voided").reduce((a,c)=>a+(c.amount_ngn??0)-(c.paid_amount_ngn??0),0)
    }
  };
});
