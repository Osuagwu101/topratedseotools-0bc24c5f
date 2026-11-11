import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type PostpaidCustomerInvoice = {
  id: string;
  invoiceRef: string;
  issuedAt: string;
  dueAt: string | null;
  fileCount: number;
  billedNgn: number;
  paidNgn: number;
  outstandingNgn: number;
  status: "due" | "overdue" | "paid" | "voided";
  triggerMode: string;
  triggerReason: string;
  lineItems: Array<{ usedAt: string; rateNgn: number; amountNgn: number; paidNgn: number; jobId: string | null }>;
};

export const getMyTurnitinPostpaidInvoiceOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any;
    const userId = context.userId;
    const { data: account, error: accountError } = await admin
      .from("turnitin_account_settings").select("billing_mode").eq("user_id", userId).maybeSingle();
    if (accountError) throw new Error(accountError.message);
    if (account?.billing_mode !== "postpaid") {
      return { postpaid: false as const, policy: null, invoices: [] as PostpaidCustomerInvoice[], totalOutstandingNgn: 0, customerName: "" };
    }
    const policyRes = await admin.rpc("turnitin_postpaid_policy_status", { _user_id: userId });
    if (policyRes.error) throw new Error(policyRes.error.message);
    const [invoiceRes, chargeRes, profileRes] = await Promise.all([
      admin.from("turnitin_postpaid_cycle_invoices")
        .select("id,invoice_ref,issued_at,due_at,file_count,amount_due_ngn,trigger_mode,trigger_reason")
        .eq("user_id", userId).order("issued_at", { ascending: false }).limit(100),
      admin.from("turnitin_postpaid_charges")
        .select("id,amount_ngn,paid_amount_ngn,status")
        .eq("user_id", userId).limit(5000),
      admin.from("profiles").select("full_name").eq("id",userId).maybeSingle(),
    ]);
    if (invoiceRes.error || chargeRes.error) throw new Error(invoiceRes.error?.message ?? chargeRes.error?.message);
    const allCharges = chargeRes.data ?? [];
    if (allCharges.length >= 5000) throw new Error("Billing history is too large to verify safely.");
    const chargeById = new Map(allCharges.map((c: any) => [c.id,c]));
    const invoicesRaw = invoiceRes.data ?? [];
    const ids = invoicesRaw.map((i: any) => i.id);
    const { data: lines, error: linesError } = ids.length
      ? await admin.from("turnitin_postpaid_cycle_invoice_lines")
        .select("invoice_id,charge_id,job_id,rate_ngn_at_use,amount_ngn,used_at")
        .in("invoice_id",ids).limit(5000)
      : { data: [], error: null };
    if (linesError) throw new Error(linesError.message);
    if ((lines ?? []).length >= 5000) throw new Error("Invoice lines exceed the safe reading limit.");
    const byInvoice = new Map<string,any[]>();
    for (const l of lines ?? []) {
      const arr=byInvoice.get(l.invoice_id)??[];
      arr.push(l);byInvoice.set(l.invoice_id,arr);
    }
    const invoices: PostpaidCustomerInvoice[] = invoicesRaw.map((i: any) => {
      const invoiceLines = byInvoice.get(i.id) ?? [];
      let billed=0,paid=0,liveCount=0;
      const items = invoiceLines.map((l: any) => {
        const c=chargeById.get(l.charge_id) as any;
        const live=!!c && c.status!=="void";
        const amount=live?Number(l.amount_ngn):0;
        const paidAmount=live?Math.min(amount,Number(c.paid_amount_ngn??0)):0;
        billed+=amount;paid+=paidAmount;if(live) liveCount++;
        return {usedAt:l.used_at,rateNgn:Number(l.rate_ngn_at_use??0),
          amountNgn:amount,paidNgn:paidAmount,jobId:l.job_id??null};
      }).filter((l:any)=>l.amountNgn>0);
      const balance=Math.max(0,billed-paid);
      const status: PostpaidCustomerInvoice["status"] =
        invoiceLines.length && !liveCount ? "voided" :
        balance===0 ? "paid" :
        i.due_at && new Date(i.due_at).getTime()<Date.now() ? "overdue" : "due";
      return {id:i.id,invoiceRef:i.invoice_ref,issuedAt:i.issued_at,
        dueAt:i.due_at,fileCount:i.file_count,billedNgn:billed,paidNgn:paid,
        outstandingNgn:balance,status,triggerMode:i.trigger_mode,
        triggerReason:i.trigger_reason,lineItems:items};
    });
    const totalOutstandingNgn=allCharges
      .filter((c:any)=>c.status!=="void")
      .reduce((s:number,c:any)=>s+Math.max(0,Number(c.amount_ngn)-Number(c.paid_amount_ngn??0)),0);
    return {postpaid:true as const,policy:policyRes.data,customerName:String(profileRes.data?.full_name??""),
      invoices,totalOutstandingNgn};
  });


/** JSON-serialisable event row from turnitin_postpaid_customer_history. */
export type PostpaidHistoryEvent = { type: string; at: string } & Record<string, string | number | boolean | null>;

export const getMyTurnitinPostpaidBillingHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = supabaseAdmin as any;
    const userId = context.userId;
    const { data: account, error: accountError } = await admin
      .from("turnitin_account_settings").select("billing_mode").eq("user_id", userId).maybeSingle();
    if (accountError) throw new Error(accountError.message);
    const { data, error } = await admin.rpc("turnitin_postpaid_customer_history", { _user_id: userId });
    if (error) throw new Error("Unable to load your billing history.");
    const events = (Array.isArray(data) ? data : []) as PostpaidHistoryEvent[];
    return { postpaid: account?.billing_mode === "postpaid", events: events.slice(0, 1000) };
  });
