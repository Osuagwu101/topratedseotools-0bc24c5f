import {createHash} from "node:crypto";
import type {ChatGptProviderAccount} from "./chatgpt-account-policy";
const tokens=new Map<string,{token:string;identity:string|null;until:number}>();
/** Client bearer tokens cannot select another upstream account. */
export async function chatGptAccountSession(account:ChatGptProviderAccount,snapshot:string,headers:Headers){
 const key=account+":"+createHash("sha256").update(snapshot).digest("hex");
 const cached=tokens.get(key);if(cached&&cached.until>Date.now())return cached;
 const clean=new Headers(headers);clean.delete("authorization");clean.delete("chatgpt-account-id");
 clean.set("Accept","application/json");
 const response=await fetch("https://chatgpt.com/api/auth/session",{headers:clean,redirect:"manual",signal:AbortSignal.timeout(20000)});
 if(!response.ok||!(response.headers.get("content-type")??"").includes("json"))throw Error("Assigned ChatGPT account requires an Admin refresh.");
 const data=await response.json();
 if(typeof data?.accessToken!=="string"||!data.accessToken||/[\r\n]/.test(data.accessToken))throw Error("Assigned ChatGPT account has no valid access token.");
 const identity=typeof data?.user?.id==='string' && data.user.id ? createHash('sha256').update('chatgpt-user:'+data.user.id).digest('hex') : null;
 const result={token:data.accessToken,identity,until:Date.now()+15000};
 if(tokens.size>20)tokens.clear();tokens.set(key,result);
 return result;
}

export async function chatGptAccountAuthorization(account:ChatGptProviderAccount,snapshot:string,headers:Headers){return "Bearer "+(await chatGptAccountSession(account,snapshot,headers)).token;}
