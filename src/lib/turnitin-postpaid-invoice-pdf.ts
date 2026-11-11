import type { PostpaidCustomerInvoice } from "@/lib/turnitin-postpaid-invoices.functions";

function pdfAscii(value: unknown): string {
  return String(value ?? "").replace(/[^\x20-\x7E]/g," ").replace(/\\/g,"\\\\")
    .replace(/\(/g,"\\(").replace(/\)/g,"\\)").slice(0,220);
}
export function makeTopRatedPostpaidInvoicePdf(inv: PostpaidCustomerInvoice, customerName: string, totalAccountDue: number): Blob {
  const money=(n:number)=>"NGN "+Math.round(n).toLocaleString("en-US");
  const issueDate=new Date(inv.issuedAt).toLocaleDateString("en-GB");
  const dueDate=inv.dueAt?new Date(inv.dueAt).toLocaleDateString("en-GB"):"Payable on invoice";
  const text=(x:number,y:number,size:number,raw:string)=>
    "BT /F1 "+size+" Tf 1 0 0 1 "+x+" "+y+" Tm ("+pdfAscii(raw)+") Tj ET\n";
  let stream="q 0.08 0.23 0.45 rg 0 705 612 87 re f Q\n";
  stream+="q 1 1 1 rg\n"+text(45,752,23,"TOP RATED SEO TOOLS")+text(45,728,11,"Turnitin Checks - Postpaid Invoice")+"Q\n";
  stream+="q 0.1 0.1 0.1 rg\n";
  stream+=text(45,673,19,"INVOICE")+"q 0.20 0.25 0.36 rg\n";
  stream+=text(45,646,11,"Invoice Number: "+inv.invoiceRef);
  stream+=text(45,626,11,"Customer: "+(customerName||"TopRated customer"));
  stream+=text(45,606,11,"Issued: "+issueDate);
  stream+=text(45,586,11,"Due: "+dueDate);
  stream+=text(45,566,11,"Billing trigger: "+(inv.triggerReason==="file_threshold"?"File limit reached":"Monthly period end"));
  stream+="Q\n";
  stream+="q 0.91 0.94 0.98 rg 40 470 532 56 re f Q\n";
  stream+=text(55,505,12,"Successful checks: "+inv.fileCount);
  stream+=text(55,483,12,"Invoice charges: "+money(inv.billedNgn));
  stream+=text(45,442,12,"Payments applied to this invoice: "+money(inv.paidNgn));
  stream+=text(45,416,14,"INVOICE BALANCE: "+money(inv.outstandingNgn));
  stream+=text(45,385,12,"TOTAL ACCOUNT OUTSTANDING: "+money(totalAccountDue));
  stream+=text(45,347,11,"Payment: https://topratedseotools.com/turnitin?invoice="+inv.invoiceRef);
  stream+=text(45,309,10,"Full account settlement is required to restore restricted checking access.");
  stream+=text(45,279,10,"Payment is recorded only after gateway verification.");
  stream+=text(45,108,11,"TopRatedSEOTools | https://topratedseotools.com");
  stream+=text(45,90,10,"Billing enquiries: support@topratedseotools.com");
  stream+="Q\n";
  const objects=[
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Length "+new TextEncoder().encode(stream).length+" >>\nstream\n"+stream+"endstream"
  ];
  let pdf="%PDF-1.4\n";
  const offsets=[0];
  for(let i=0;i<objects.length;i++){
    offsets.push(new TextEncoder().encode(pdf).length);
    pdf+=(i+1)+" 0 obj\n"+objects[i]+"\nendobj\n";
  }
  const xref=new TextEncoder().encode(pdf).length;
  pdf+="xref\n0 6\n0000000000 65535 f \n";
  for(const off of offsets.slice(1)) pdf+=String(off).padStart(10,"0")+" 00000 n \n";
  pdf+="trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n"+xref+"\n%%EOF";
  return new Blob([pdf],{type:"application/pdf"});
}
export function downloadTopRatedInvoice(inv: PostpaidCustomerInvoice,customerName:string,totalAccountDue:number){
  const pdf=makeTopRatedPostpaidInvoicePdf(inv,customerName,totalAccountDue);
  const url=URL.createObjectURL(pdf);
  const a=document.createElement("a");
  a.href=url;a.download="TopRated_Invoice_"+inv.invoiceRef.replace(/[^a-z0-9-]/gi,"")+".pdf";
  document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),120000);
}
