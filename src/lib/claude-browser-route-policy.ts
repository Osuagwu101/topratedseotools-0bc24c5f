import type {ClaudeRoute} from "./claude-proxy-policy";
import {claudeRoutePolicy} from "./claude-proxy-policy";
export type ClaudeBrowserRoute=Omit<ClaudeRoute,"kind">&{kind:ClaudeRoute["kind"]|"rpc"};
export function claudeBrowserRoutePolicy(method:string,path:string):ClaudeBrowserRoute|null{
 if(method==="POST"&&/^\/claudeai-rpc\/anthropic\.bard\.api\.v1alpha\.ConversationService\/(StreamTimeline|PerformAction)$/.test(path))return {kind:"rpc"};
 const p=path.startsWith("/edge-api/")?"/api/"+path.slice(10):path;
 const v2=p.match(/^\/api\/organizations\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/chat_conversations_v2$/i);
 if(method==="GET"&&v2)return {kind:"list",org:v2[1].toLowerCase()};
 const standard=claudeRoutePolicy(method,p);if(standard)return standard;
 if(method==="GET"&&p==="/api/bootstrap")return {kind:"bootstrap"};
 if(method==="GET"&&/^\/api\/bootstrap\/[0-9a-f-]{36}\/app_start$/.test(p))return {kind:"bootstrap"};
 return null;
}
