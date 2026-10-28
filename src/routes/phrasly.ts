import {createFileRoute} from "@tanstack/react-router";
import {workspacePage} from "@/lib/phrasly-extension/release.server";
export const Route=createFileRoute("/phrasly")({server:{handlers:{GET:()=>workspacePage(false)}}});
