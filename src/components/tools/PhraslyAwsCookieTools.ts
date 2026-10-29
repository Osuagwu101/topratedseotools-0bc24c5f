import {supabase} from "@/integrations/supabase/client";
const main=document.querySelector("main")!;
const tool=main.querySelector(".rounded-2xl.border") as HTMLElement;
const firstUpdate=Array.from(tool.querySelectorAll<HTMLFormElement>("form")).find(f=>f.querySelector<HTMLInputElement>('input[name="action"]')?.value==="update_account")!;
const rowTemplate=firstUpdate.parentElement!.cloneNode(true) as HTMLElement;
const rows=firstUpdate.parentElement!.parentElement!;
const addForm=Array.from(tool.querySelectorAll<HTMLFormElement>("form")).find(f=>f.querySelector<HTMLInputElement>('input[name="action"]')?.value==="add_account")!;
const summary=tool.firstElementChild!.querySelector("span")!;
let busy=false;
const errors:Record<string,string>={url_and_cookies_required:"URL and cookies are both required.",bad_cookie_json:"Cookies must be valid JSON (an array of cookie objects).",account_in_use:"Can't remove an account that's already assigned to a customer.",account_not_found:"Account not found.",forbidden:"Admin access is required.",service_unavailable:"The account configuration could not be saved."};
function flash(message:string,error=false){
 main.querySelector("[data-aws-flash]")?.remove();
 const div=document.createElement("div");div.dataset.awsFlash="1";
 div.className="mb-4 rounded-lg px-4 py-3 text-sm "+(error?"bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300":"bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300");
 div.textContent=message;main.prepend(div);
}
async function request(body?:Record<string,unknown>){
 const {data}=await supabase.auth.getSession();
 if(!data.session?.access_token){location.assign("/admin");throw Error("not_signed_in");}
 const response=await fetch("/ext-admin?interface=aws",{method:body?"POST":"GET",headers:{Authorization:"Bearer "+data.session.access_token,...(body?{"Content-Type":"application/json"}:{})},...(body?{body:JSON.stringify({...body,aws_interface:true})}:{}),credentials:"same-origin",cache:"no-store"});
 const value=await response.json();
 if(!response.ok||value.ok===false)throw Error(value.error||"service_unavailable");
 return value;
}
function field(form:Element,name:string){return form.querySelector<HTMLInputElement>('[name="'+name+'"]')!;}
async function load(){
 const state=await request();
 if(state.accounts.some((a:any)=>typeof a.cookie_json!=="string"))throw Error("service_unavailable");
 let used=0,room=0,unlimited=false;rows.replaceChildren();
 for(const account of state.accounts){
  used+=Number(account.used||0);if(account.capacity===null)unlimited=true;else room+=Number(account.capacity);
  const row=rowTemplate.cloneNode(true) as HTMLElement;
  const form=Array.from(row.querySelectorAll<HTMLFormElement>("form")).find(f=>field(f,"action")?.value==="update_account")!;
  const formId="oc-cookie-acct-"+account.id;form.id=formId;
  row.querySelectorAll("[form]").forEach(e=>e.setAttribute("form",formId));
  row.querySelectorAll<HTMLInputElement>('input[name="account_id"]').forEach(e=>e.value=account.id);
  row.querySelectorAll<HTMLInputElement>('input[name="csrf"]').forEach(e=>e.value=crypto.randomUUID());
  field(form,"label").value=account.label;field(form,"target_url").value=account.target_url;
  field(form,"capacity").value=account.capacity===null?"":String(account.capacity);
  row.querySelector<HTMLTextAreaElement>('textarea[name="cookie_json"]')!.value=account.cookie_json;
  const actions=row.lastElementChild!;
  actions.querySelector("span")!.textContent=String(account.used||0)+(account.capacity===null?"":" / "+account.capacity)+" in use";
  if(account.capacity===null||Number(account.used||0)<Number(account.capacity))actions.querySelector(".bg-slate-100")?.remove();
  if(Number(account.used||0)!==0)actions.querySelector("form")?.remove();
  rows.append(row);
 }
 if(!state.accounts.length){const empty=document.createElement("div");empty.className="py-3 text-slate-500 text-sm";empty.textContent="No accounts added yet.";rows.append(empty);}
 summary.textContent=used+" in use"+(unlimited?" (unlimited capacity)":" / "+room+" capacity");
 addForm.reset();field(addForm,"csrf").value=crypto.randomUUID();field(addForm,"tool_id").value="phrasly";
 main.hidden=false;
}
main.addEventListener("submit",async event=>{
 if(event.defaultPrevented)return;
 const form=event.target as HTMLFormElement;if(!(form instanceof HTMLFormElement))return;
 event.preventDefault();if(busy)return;busy=true;
 const body=Object.fromEntries(new FormData(form).entries()),action=String(body.action);
 const buttons=main.querySelectorAll<HTMLButtonElement>("button");buttons.forEach(b=>b.disabled=true);
 try{await request(body);await load();flash(action==="add_account"?"Account added.":action==="delete_account"?"Account removed.":"Account updated.");}
 catch(error){const code=error instanceof Error?error.message:"service_unavailable";try{await load();}catch{}main.hidden=false;flash(errors[code]||"The account configuration could not be saved.",true);}
 finally{busy=false;buttons.forEach(b=>b.disabled=false);window.scrollTo(0,0);}
});
document.querySelector('a[href="/admin?aws-logout=1"]')?.addEventListener("click",async event=>{event.preventDefault();await supabase.auth.signOut({scope:"local"});location.assign("/admin");});
void load().catch(error=>{main.hidden=false;tool.hidden=true;flash(errors[error?.message]||"Sign in to TopRated Admin to continue.",true);});
