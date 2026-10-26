/** TopRated adapters for the AWS cookie-account / staff-feature administration. */
import {readFile} from "node:fs/promises";
import {supabaseAdmin} from "@/integrations/supabase/client.server";
import {encryptPhraslySession} from "@/lib/phrasly-session.server";
import {verifiedWriter,writerStatus,OneclickError,oneclickJson} from "./backend.server";
const db=supabaseAdmin as any;
async function checked(query:any) {
 const {data,error}=await query;
 if(error)throw new OneclickError("service_unavailable",503);
 return data;
}
export async function owner(request:Request) {
 if(process.env.PHRASLY_EXTENSION_ENABLED!=="true")throw new OneclickError("service_unavailable",503);
 const uid=await verifiedWriter(request);
 const role=await checked(db.from("user_roles").select("is_active,is_super_admin").eq("user_id",uid).eq("role","admin").maybeSingle());
 const account=await checked(db.from("admin_accounts").select("user_id").eq("user_id",uid).maybeSingle());
 if(!role?.is_active||!role?.is_super_admin||!account)throw new OneclickError("forbidden",403);
 return uid;
}
async function audit(uid:string,event:string) {
 await checked(db.from("phrasly_oneclick_activity").insert({user_id:uid,event_type:event}));
}
export async function staffStatus(request:Request) {return oneclickJson(await writerStatus(request));}
export async function downloadPackage(request:Request) {
 await writerStatus(request);
 const file=process.env.PHRASLY_EXTENSION_PACKAGE_PATH;
 if(!file)throw new OneclickError("service_unavailable",503);
 const bytes=await readFile(file);
 return new Response(new Uint8Array(bytes),{headers:{"Content-Type":"application/zip","Content-Disposition":'attachment; filename="TopRated-Phrasly-Access.zip"',"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
}
export async function adminState(request:Request) {
 const uid=await owner(request);
 const accounts=await checked(db.from("phrasly_oneclick_accounts").select("id,label,target_url,capacity,enabled,created_at").eq("tool_id","phrasly").order("created_at"));
 const grants=await checked(db.from("phrasly_oneclick_feature_grants").select("user_id,feature_key,daily_limit,enabled").eq("tool_id","phrasly"));
 const ids=[...new Set((grants||[]).map((g:any)=>g.user_id))];
 const profiles=ids.length?await checked(db.from("profiles").select("id,email,full_name").in("id",ids)):[];
 const staff=ids.map(id=>({id,...profiles.find((p:any)=>p.id===id),features:grants.filter((g:any)=>g.user_id===id)}));
 return oneclickJson({ok:true,owner_id:uid,accounts,staff});
}
function identifier(raw:unknown) {
 if(typeof raw!=="string"||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw))throw new OneclickError("bad_request",400);
 return raw;
}
function allowance(raw:unknown) {
 if(!Number.isInteger(raw)||Number(raw)<1||Number(raw)>10000)throw new OneclickError("bad_request",400);
 return Number(raw);
}
export async function adminChange(request:Request) {
 const uid=await owner(request);
 const text=await request.text();
 if(text.length>256000)throw new OneclickError("bad_request",400);
 let input:any;
 try{input=JSON.parse(text);}catch{throw new OneclickError("bad_request",400);}
 if(!input||typeof input!=="object")throw new OneclickError("bad_request",400);
 if(input.action==="grant") {
  const email=typeof input.email==="string"?input.email.trim().toLowerCase():"";
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)throw new OneclickError("bad_request",400);
  const humanizer=allowance(input.humanizer),detector=allowance(input.ai_detector);
  const profile=await checked(db.from("profiles").select("id,account_status").eq("email",email).maybeSingle());
  if(!profile||profile.account_status!=="active")throw new OneclickError("writer_not_found",404);
  let expires:string|null=null;
  if(input.expires_at) {
   const ms=Date.parse(input.expires_at);
   if(!Number.isFinite(ms)||ms<=Date.now())throw new OneclickError("bad_request",400);
   expires=new Date(ms).toISOString();
  }
  const reference=await checked(db.from("tool_accounts").select("id").eq("tool_slug","phrasly").order("created_at").limit(1).maybeSingle());
  if(!reference)throw new OneclickError("service_unavailable",503);
  const existing=await checked(db.from("tool_access_grants").select("id").eq("user_id",profile.id).eq("tool_slug","phrasly").maybeSingle());
  const record={user_id:profile.id,tool_slug:"phrasly",account_id:reference.id,access_type:"shared",status:"active",expires_at:expires,granted_by:uid,notes:"In-house Phrasly writer access"};
  await checked(existing?db.from("tool_access_grants").update(record).eq("id",existing.id):db.from("tool_access_grants").insert(record));
  await checked(db.from("phrasly_oneclick_feature_grants").upsert([
   {user_id:profile.id,tool_id:"phrasly",feature_key:"humanizer",daily_limit:humanizer,enabled:true},
   {user_id:profile.id,tool_id:"phrasly",feature_key:"ai_detector",daily_limit:detector,enabled:true}
  ]));
  await audit(uid,"admin_staff_granted:"+profile.id);
 } else if(input.action==="revoke") {
  const target=identifier(input.user_id);
  await checked(db.from("phrasly_oneclick_feature_grants").update({enabled:false}).eq("user_id",target).eq("tool_id","phrasly"));
  await audit(uid,"admin_staff_revoked:"+target);
 } else if(input.action==="save_account") {
  const id=identifier(input.account_id);
  const label=typeof input.label==="string"?input.label.trim():"";
  if(!label||label.length>120)throw new OneclickError("bad_request",400);
  if(input.capacity!==null&&(!Number.isInteger(input.capacity)||input.capacity<1||input.capacity>10000))throw new OneclickError("bad_request",400);
  let cookies=input.cookies;
  if(typeof cookies==="string")try{cookies=JSON.parse(cookies);}catch{throw new OneclickError("bad_cookie_json",400);}
  if(!Array.isArray(cookies)||!cookies.length||cookies.length>100||
    !cookies.some(c=>c?.name==="session"&&typeof c.value==="string"&&c.value.length>0)||
    !cookies.every(c=>c&&typeof c.name==="string"&&typeof c.value==="string"&&typeof c.domain==="string"&&
      (c.domain.replace(/^\./,"")==="phrasly.ai"||c.domain.endsWith(".phrasly.ai"))))
    throw new OneclickError("bad_cookie_json",400);
  const existing=await checked(db.from("phrasly_oneclick_accounts").select("id").eq("id",id).eq("tool_id","phrasly").maybeSingle());
  if(!existing)throw new OneclickError("account_not_found",404);
  const state={authenticated_cookies:cookies,session_tokens:{storage:{localStorage:{},sessionStorage:{}}}};
  await checked(db.from("phrasly_oneclick_accounts").update({
    label,capacity:input.capacity,enabled:input.enabled===true,encrypted_cookies:encryptPhraslySession(JSON.stringify(state))
  }).eq("id",id).eq("tool_id","phrasly"));
  await audit(uid,"admin_account_updated:"+id);
 } else throw new OneclickError("bad_request",400);
 return oneclickJson({ok:true});
}
export function workspacePage(admin=false) {
 const title=admin?"Phrasly administration":"Writer workspace";
 return new Response('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>'+title+' — TopRated</title><link rel="stylesheet" href="/phrasly-assets/workspace.css"></head><body><div id="root"></div><script type="module" src="/phrasly-assets/'+(admin?"admin":"writer")+'.js"></script></body></html>',{headers:{
  "Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store","X-Robots-Tag":"noindex, nofollow","X-Content-Type-Options":"nosniff","X-Frame-Options":"SAMEORIGIN",
  "Content-Security-Policy":"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' https://vuhnvsejdszfvwicflbb.supabase.co; frame-ancestors 'self'; base-uri 'self'; form-action 'self'"
 }});
}
