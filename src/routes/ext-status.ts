import {createFileRoute} from "@tanstack/react-router";
import {staffStatus} from "@/lib/phrasly-extension/release.server";
import {oneclickFailure} from "@/lib/phrasly-extension/backend.server";
export const Route=createFileRoute("/ext-status")({server:{handlers:{GET:async({request})=>{try{return await staffStatus(request);}catch(error){return oneclickFailure(error);}}}}});
