/** Phase 4 browser-side AWS extension integration. No account cookies pass through this page. */
import { supabase } from "@/integrations/supabase/client";
import { createPhraslyLauncher, type LaunchFeature } from "@/lib/phrasly-extension/launcher";

const EXTENSION_ID = "lpgnjkafilbopdojcfnagooojifkccek";
type ChromeRuntime = { lastError?:{message?:string}; sendMessage:(id:string,msg:unknown,cb:(reply:unknown)=>void)=>void };
function runtime():ChromeRuntime|undefined {
  const w=window as typeof window & {chrome?:{runtime?:ChromeRuntime}};
  return w.chrome?.runtime;
}
export async function launchPhraslyAwsFeature(feature:LaunchFeature) {
  const instance=createPhraslyLauncher({
    extensionId:EXTENSION_ID,
    runtime:runtime(),
    requestHandoff:async selected=>{
      const {data,error}=await supabase.auth.getSession();
      if(error||!data.session?.access_token) throw new Error("not_signed_in");
      const params=new URLSearchParams({tool_id:"phrasly",feature:selected});
      const response=await fetch("/ext-handoff.php?"+params,{headers:{
        Authorization:"Bearer "+data.session.access_token
      },cache:"no-store",credentials:"same-origin"});
      const result=await response.json();
      if(!response.ok||result?.ok!==true)throw new Error(result?.error||"handoff_unavailable");
      return {payload:result.payload,signature:result.signature};
    }
  });
  return instance.launch(feature);
}
