/**
 * Dedicated postpaid billing notification worker.
 * Only sends when the existing production email switch is ON, domain verified,
 * RESEND_API_KEY is present, and site emails are not paused.
 * Start with: node --env-file=.env scripts/postpaid-notification-worker.mjs
 * Use flock at cron level to avoid concurrent dispatches.
 */
import { createClient } from "@supabase/supabase-js";

function esc(x) {
 return String(x ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;")
  .replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;");
}
function money(n){return "NGN "+Math.round(Number(n??0)).toLocaleString("en-NG");}
const key=process.env.RESEND_API_KEY;
const url=process.env.SUPABASE_URL;
const role=process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!url || !role){console.error("Postpaid notifications: Supabase server configuration unavailable");process.exit(1);}
const db=createClient(url,role,{auth:{persistSession:false,autoRefreshToken:false}});
const [{data:mail,error:mailErr},{data:site,error:siteErr}]=await Promise.all([
 db.from("email_settings").select("production_sending,from_email,sender_name,reply_to_email,resend_domain_status,enabled_types").eq("id",true).maybeSingle(),
 db.from("site_settings").select("emails_paused").eq("id",true).maybeSingle()
]);
if(mailErr||siteErr){console.error("Postpaid notifications: could not read email controls");process.exit(1);}
if(!key || !mail?.production_sending || site?.emails_paused || mail.resend_domain_status!=="verified"){
 console.log("Postpaid notifications skipped: outbound service disabled, paused, unverified, or unconfigured");
 process.exit(0);
}
const {data:rows,error:queueError}=await db.from("turnitin_postpaid_notifications")
 .select("id,invoice_id,user_id,recipient,kind,reminder_sequence,status,attempts")
 .in("status",["pending","retrying"])
 .lte("next_attempt_at",new Date().toISOString())
 .order("created_at",{ascending:true}).limit(30);
if(queueError){console.error("Postpaid notifications: queue read failed");process.exit(1);}
let sent=0,failed=0,skipped=0;
for(const item of rows??[]){
 const {data:invoice,error:invErr}=await db.from("turnitin_postpaid_cycle_invoices")
   .select("id,invoice_ref,file_count,amount_due_ngn,issued_at,due_at,trigger_reason")
   .eq("id",item.invoice_id).maybeSingle();
 if(invErr||!invoice){failed++;continue;}
 const [{data:items,error:lineError},{data:charges,error:chargeError},{data:profile}]=await Promise.all([
  db.from("turnitin_postpaid_cycle_invoice_lines").select("charge_id,amount_ngn").eq("invoice_id",invoice.id),
  db.from("turnitin_postpaid_charges").select("id,amount_ngn,paid_amount_ngn,status").eq("user_id",item.user_id).limit(5000),
  db.from("profiles").select("full_name,email").eq("id",item.user_id).maybeSingle()
 ]);
 if(lineError||chargeError||!items||!charges||charges.length>=5000){failed++;continue;}
 const byCharge=new Map(charges.map(c=>[c.id,c]));
 const billed=items.reduce((a,l)=>a+(byCharge.get(l.charge_id)?.status==="void"?0:Number(l.amount_ngn)),0);
 const invoiceOwed=items.reduce((a,l)=>{
  const c=byCharge.get(l.charge_id);
  if(!c || c.status==="void")return a;
  return a+Math.max(0,Number(l.amount_ngn)-Math.min(Number(l.amount_ngn),Number(c.paid_amount_ngn??0)));
 },0);
 const accountOwed=charges.filter(c=>c.status!=="void").reduce((a,c)=>a+Math.max(0,Number(c.amount_ngn)-Number(c.paid_amount_ngn??0)),0);
 const paidMessage=item.kind==="paid"||item.kind==="admin_paid";
 if((!paidMessage && invoiceOwed<=0)||(paidMessage && invoiceOwed>0)){
  await db.from("turnitin_postpaid_notifications").update({status:"cancelled",last_error:"invoice_no_longer_in_expected_state"}).eq("id",item.id);
  skipped++;continue;
 }
 const link="https://topratedseotools.com/turnitin?invoice="+encodeURIComponent(invoice.invoice_ref);
 const customer=esc(profile?.full_name || profile?.email || "Customer");
 const displayNumber=esc(invoice.invoice_ref);
 const isAdmin=item.kind.startsWith("admin");
 const reminder=item.kind==="reminder";
 const due=invoice.due_at?new Date(invoice.due_at).toLocaleDateString("en-NG"):"When billing limit is reached";
 const subject=paidMessage?"TopRated Invoice Paid - "+invoice.invoice_ref:
  reminder?"TopRated payment reminder - "+invoice.invoice_ref:
  isAdmin?"TopRated postpaid invoice issued - "+invoice.invoice_ref:
    "TopRated Invoice - "+invoice.invoice_ref+" - Payment Required";
 const first=paidMessage?"Payment received and verified":
  reminder?"Payment reminder for your Turnitin Checks":
  "Your Turnitin Checks invoice is ready";
 const description=paidMessage?"This invoice has been settled. Thank you.":
   isAdmin?"A postpaid customer has reached their configured billing threshold.":
   "Your billing threshold has been reached. To resume checks, settle the full outstanding account balance.";
 const html='<!doctype html><html lang="en"><body style="margin:0;background:#f3f5f9;font-family:Arial,sans-serif;color:#17233d">'+
  '<main style="max-width:600px;margin:30px auto;background:white;border:1px solid #dbe2eb;border-radius:12px;overflow:hidden">'+
  '<header style="background:#123b70;color:white;padding:24px"><h2 style="margin:0">TopRatedSEOTools</h2><div>Postpaid Turnitin Checks</div></header>'+
  '<div style="padding:26px"><h2>'+esc(first)+'</h2><p>Hello '+customer+',</p><p>'+esc(description)+'</p>'+
  '<table style="width:100%;border-collapse:collapse"><tr><td>Invoice</td><td><strong>'+displayNumber+'</strong></td></tr>'+
  '<tr><td>Successful checks</td><td>'+invoice.file_count+'</td></tr>'+
  '<tr><td>Invoice charges</td><td>'+esc(money(billed))+'</td></tr>'+
  '<tr><td>Invoice balance</td><td>'+esc(money(invoiceOwed))+'</td></tr>'+
  '<tr><td>Total account outstanding</td><td><strong>'+esc(money(accountOwed))+'</strong></td></tr>'+
  '<tr><td>Due date</td><td>'+esc(due)+'</td></tr></table>'+
  '<p style="margin-top:26px"><a href="'+esc(link)+'" style="display:inline-block;background:#124b92;color:white;border-radius:8px;padding:13px 20px;text-decoration:none">'+
  (paidMessage?"View paid invoice":"View invoice and pay full balance")+'</a></p>'+
  '<p style="font-size:12px;color:#667">Sign in to your TopRated account to view/download the PDF invoice. Do not pay through links sent by unknown contacts.</p></div>'+
  '<footer style="background:#f8fafc;padding:18px;color:#667;font-size:12px">TopRatedSEOTools | support@topratedseotools.com</footer></main></body></html>';
 try{
  const response=await fetch("https://api.resend.com/emails",{
    method:"POST",
    headers:{"Authorization":"Bearer "+key,"Content-Type":"application/json",
      "Idempotency-Key":"trst-postpaid-notice-"+item.id},
    body:JSON.stringify({from:(mail.sender_name||"TopRatedSEOTools")+" <"+mail.from_email+">",
      to:[item.recipient],reply_to:mail.reply_to_email,subject,html})
  });
  const result=await response.json().catch(()=>({}));
  if(!response.ok||!result.id)throw new Error("Resend HTTP "+response.status+": "+String(result.message||"rejected").slice(0,150));
  const update=await db.from("turnitin_postpaid_notifications").update({
    status:"sent",sent_at:new Date().toISOString(),provider_message_id:String(result.id),
    attempts:item.attempts+1,last_error:null
  }).eq("id",item.id);
  if(update.error)throw new Error("Message accepted but delivery log could not be saved");
  sent++;
 }catch(e){
  const attempts=item.attempts+1;
  const mins=[5,30,120,600,1440][Math.min(attempts-1,4)];
  await db.from("turnitin_postpaid_notifications").update({
    status:attempts>=5?"failed":"retrying",attempts,
    next_attempt_at:new Date(Date.now()+mins*60000).toISOString(),
    last_error:String(e?.message||e).slice(0,400)
  }).eq("id",item.id);
  failed++;
 }
}
console.log("Postpaid notices: sent="+sent+" failed="+failed+" cancelled="+skipped);
