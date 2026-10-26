import { useState } from "react";
import { launchPhraslyAwsFeature } from "@/lib/phrasly-extension/launch-from-website";
import type { LaunchFeature } from "@/lib/phrasly-extension/launcher";

/** In-house feature controls. Deployment remains disabled until rollout approval. */
export function PhraslyOneClickActions() {
  const [busy,setBusy]=useState<LaunchFeature|null>(null);
  const [notice,setNotice]=useState("");
  const features: Array<{key:LaunchFeature;label:string}>=[
    {key:"humanizer",label:"Open Humanizer"},
    {key:"ai_detector",label:"Open AI Detector"}
  ];
  async function launch(key:LaunchFeature) {
    if(busy)return;
    setBusy(key);setNotice("");
    try{
      const result=await launchPhraslyAwsFeature(key);
      const messages:Record<string,string>={
        extension_unavailable:"The TopRated access extension is not installed or available in this browser.",
        extension_disabled:"The Phrasly extension is not yet enabled for use.",
        handoff_unavailable:"Phrasly access could not be verified. Contact your administrator.",
        launch_state_unknown:"The request may have started. Check your browser tabs before trying again.",
        limit_reached:"Today's allowance has been used. Try again after the daily reset.",
        no_access:"Phrasly feature access has not been assigned to this account."
      };
      setNotice(result.ok?"The Phrasly window has been requested.":messages[result.error||""]||"Phrasly could not be opened. Please contact your administrator.");
    } finally {setBusy(null);}
  }
  return <div className="mt-4 space-y-3">
    <div className="flex flex-wrap gap-2">
      {features.map(item=><button key={item.key} type="button" disabled={busy!==null}
        onClick={()=>void launch(item.key)}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
        {busy===item.key?"Preparing…":item.label}
      </button>)}
    </div>
    {notice&&<p role="status" aria-live="polite" className="text-sm text-muted-foreground">{notice}</p>}
  </div>;
}
