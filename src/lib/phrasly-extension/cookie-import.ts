/** First-party receiver for the explicitly initiated Admin cookie-exporter handoff. */
export const PHRASLY_COOKIE_EXPORTER_ID = "eohjplbcofclaeblcbdaoijfcdjpmmnl";
export type ImportedPhraslyCookies = {cookies:Record<string,unknown>[];capturedAt:number;count:number};
type Runtime = {lastError?:unknown;sendMessage:(id:string,message:unknown,callback:(response:any)=>void)=>void};
export function cookieImportNonce(hash:string) {
 const found=/^#cookie-import=([a-f0-9]{64})$/.exec(hash);
 return found?found[1]:null;
}
export function validateImportedPhraslyCookies(value:any):ImportedPhraslyCookies {
 const cookies=value?.cookies;
 if(value?.ok!==true||!Array.isArray(cookies)||!cookies.length||cookies.length>100||
  !cookies.every((c:any)=>c&&typeof c.name==="string"&&typeof c.value==="string"&&typeof c.domain==="string"&&
   (c.domain.replace(/^\./,"").toLowerCase()==="phrasly.ai"||c.domain.toLowerCase().endsWith(".phrasly.ai")))||
  !cookies.some((c:any)=>c.name==="session"&&c.value.length>0)||
  new TextEncoder().encode(JSON.stringify(cookies)).length>200000||
  !Number.isFinite(value.capturedAt)||value.capturedAt>Date.now()+30000||Date.now()-value.capturedAt>5*60*1000)
  throw new Error("cookie_import_invalid");
 return {cookies,capturedAt:value.capturedAt,count:cookies.length};
}
export function receivePhraslyCookieImport(nonce:string,runtime?:Runtime):Promise<ImportedPhraslyCookies> {
 return new Promise((resolve,reject)=>{
  if(!cookieImportNonce("#cookie-import="+nonce))return reject(new Error("cookie_import_invalid"));
  const api=runtime||(window as any).chrome?.runtime;
  if(!api)return reject(new Error("cookie_import_unavailable"));
  let finished=false;
  const finish=(error:Error|null,result?:ImportedPhraslyCookies)=>{
   if(finished)return;finished=true;clearTimeout(timer);
   if(error)reject(error);else resolve(result!);
  };
  const timer=setTimeout(()=>finish(new Error("cookie_import_unavailable")),8000);
  try{
   api.sendMessage(PHRASLY_COOKIE_EXPORTER_ID,{type:"TOPRATED_PHRASLY_COOKIE_IMPORT",version:1,nonce},(response:any)=>{
    if(api.lastError)return finish(new Error("cookie_import_unavailable"));
    if(response?.error==="import_expired")return finish(new Error("cookie_import_expired"));
    try{finish(null,validateImportedPhraslyCookies(response));}
    catch{finish(new Error("cookie_import_invalid"));}
   });
  }catch{finish(new Error("cookie_import_unavailable"));}
 });
}
