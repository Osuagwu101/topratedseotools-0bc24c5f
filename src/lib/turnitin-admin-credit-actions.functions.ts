import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { paystackAdapter } from "@/lib/gateways/paystack";

async function adminDb(context: any){
 const role=await context.supabase.rpc("has_role",{_user_id:context.userId,_role:"admin"});
 if(role.error || role.data!==true) throw new Error("Administrator access required.");
 const {supabaseAdmin}=await import("@/integrations/supabase/client.server");
 // eslint-disable-next-line @typescript-eslint/no-explicit-any
 return supabaseAdmin as any;
}

export const verifyTurnitinPurchaseGateway=createServerFn({method:"POST"})
 .middleware([requireSupabaseAuth])
 .inputValidator((data:{purchaseId:string})=>data)
 .handler(async ({context,data})=>{
   const db=await adminDb(context);
   const { loadGatewaySecrets } = await import("@/lib/gateways/secrets.server");
   await loadGatewaySecrets(db, true);
   if(!/^[0-9a-f-]{36}$/i.test(data.purchaseId)) throw new Error("Invalid purchase identifier.");
   const {data:purchase,error}=await db.from("turnitin_credit_purchases")
     .select("id,user_id,quantity,total_amount_ngn,status,payment_gateway,payment_reference,payment_currency,payment_amount,gateway_environment")
     .eq("id",data.purchaseId).single();
   if(error||!purchase) throw new Error("Purchase not found.");
   if(purchase.payment_gateway!=="paystack"||!purchase.payment_reference) throw new Error("This purchase does not have a Paystack reference.");
   const tx=await paystackAdapter.verify(purchase.payment_reference);
   const currency=String(purchase.payment_currency??"NGN").toUpperCase();
   const expectedMinor=Math.round(Number(purchase.payment_amount??purchase.total_amount_ngn)*100);
   const matches=tx.reference===purchase.payment_reference && tx.currency===currency && Number(tx.amount)===expectedMinor;
   const gatewayEnv=paystackAdapter.environment();
   const envMatches=!purchase.gateway_environment || purchase.gateway_environment===gatewayEnv;
   return {purchaseId:purchase.id,gatewayStatus:tx.status,gatewayReference:tx.reference,amountMinor:Number(tx.amount),currency:tx.currency,referenceMatched:tx.reference===purchase.payment_reference,amountMatched:Number(tx.amount)===expectedMinor,currencyMatched:tx.currency===currency,environmentMatched:envMatches,verifiedMatch:matches&&envMatches,localStatus:purchase.status,checkedAt:new Date().toISOString()};
 });

export const listRefundableTurnitinJobs=createServerFn({method:"GET"}).middleware([requireSupabaseAuth])
 .handler(async ({context})=>{
  const db=await adminDb(context);
  const {data,error}=await db.from("turnitin_jobs")
   .select("id,user_id,original_filename,status,credit_state,created_at,failed_at,failure_code")
   .eq("status","failed").eq("credit_state","consumed").order("created_at",{ascending:false}).limit(200);
  if(error) throw new Error(error.message);
  return {jobs:data??[],generatedAt:new Date().toISOString()};
 });

export const refundFailedTurnitinJobCredit=createServerFn({method:"POST"})
 .middleware([requireSupabaseAuth])
 .inputValidator((data:{jobId:string;reason:string})=>data)
 .handler(async ({context})=>{
  await adminDb(context);
  // Phase 4: retired. Credits may only be restored after live provider verification.
  throw new Error("Use 'Re-verify with provider' on the Turnitin Purchases page. Credits are restored only after the provider confirms failure.");
 });
