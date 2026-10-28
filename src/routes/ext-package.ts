import {createFileRoute} from "@tanstack/react-router";
import {downloadPackage} from "@/lib/phrasly-extension/release.server";
import {oneclickFailure} from "@/lib/phrasly-extension/backend.server";
export const Route=createFileRoute("/ext-package")({server:{handlers:{POST:async({request})=>{try{return await downloadPackage(request);}catch(error){return oneclickFailure(error);}}}}});
