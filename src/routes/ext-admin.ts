import {createFileRoute} from "@tanstack/react-router";
import {adminState,adminChange} from "@/lib/phrasly-extension/release.server";
import {oneclickFailure} from "@/lib/phrasly-extension/backend.server";
export const Route=createFileRoute("/ext-admin")({server:{handlers:{GET:async({request})=>{try{return await adminState(request);}catch(error){return oneclickFailure(error);}},POST:async({request})=>{try{return await adminChange(request);}catch(error){return oneclickFailure(error);}}}}});
