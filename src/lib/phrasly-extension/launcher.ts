/** The AWS dashboard sequence: handoff, then one trst_access message. */
export type LaunchFeature = "humanizer" | "ai_detector" | "default";
export interface ExtensionRuntime {
 readonly lastError?: {message?:string};
 sendMessage(id:string,message:unknown,reply:(response:unknown)=>void):void;
}
export interface Handoff {payload:string;signature:string}
export interface LaunchResult {ok:boolean;error?:string}
interface Options {extensionId:string;runtime?:ExtensionRuntime;requestHandoff:(feature:LaunchFeature)=>Promise<Handoff>}
export function createPhraslyLauncher(options:Options) {
 async function launch(feature:LaunchFeature):Promise<LaunchResult>{
  if(!options.runtime)return {ok:false,error:"extension_unavailable"};
  let token:Handoff;
  try{token=await options.requestHandoff(feature);}catch{return {ok:false,error:"handoff_unavailable"};}
  return new Promise(resolve=>{
   try{options.runtime!.sendMessage(options.extensionId,{type:"trst_access",payload:token.payload,signature:token.signature},response=>{
    if(options.runtime?.lastError)return resolve({ok:false,error:"extension_unavailable"});
    const result=response as {ok?:boolean;error?:string}|undefined;
    if(!result?.ok)return resolve({ok:false,error:result?.error||"launch_failed"});
    resolve({ok:true});
   });}catch{resolve({ok:false,error:"extension_unavailable"});}
  });
 }
 return {launch};
}
