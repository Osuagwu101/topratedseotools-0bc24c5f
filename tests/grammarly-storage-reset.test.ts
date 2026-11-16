import {strict as assert} from "node:assert";
import {Script} from "node:vm";
import {grammarlyStorageResetPage,hashGrammarlyProxyToken} from "../src/lib/grammarly-proxy.server";
const marker=hashGrammarlyProxyToken("writer:account_2").slice(0,24);
const html=await grammarlyStorageResetPage("writer","account_2").text();
const source=html.match(/<script>([\s\S]*?)<\/script>/)![1];
async function run(same=false,fail=false){
 const local=new Map<string,string>([["draft","old document"],...(same?[["trstGrammarlyAccount",marker] as [string,string]]:[])]);
 const events:string[]=[];const status={textContent:""};
 const caches={keys:async()=>["old-account-cache"],delete:async(k:string)=>{events.push("cache:"+k);return true}};
 const document={cookie:"",getElementById:()=>status};
 const result=new Script(source).runInNewContext({window:{caches},caches,document,
 localStorage:{getItem:(k:string)=>local.get(k)??null,clear:()=>{local.clear();events.push("local")},setItem:(k:string,v:string)=>local.set(k,v)},
 sessionStorage:{clear:()=>events.push("session")},
 navigator:{serviceWorker:{getRegistrations:async()=>{if(fail)throw Error("blocked");return [{unregister:async()=>{events.push("worker");return true}}]}}},
 indexedDB:{databases:async()=>[{name:"old-account-db"}],deleteDatabase:(name:string)=>{events.push("database:"+name);const request:any={};queueMicrotask(()=>request.onsuccess?.());return request}},
 location:{replace:(url:string)=>{assert.equal(url,"/");events.push("navigate")}}
 });await result;return {events,local,document,status};
}
const changed=await run();assert.deepEqual(changed.events,["local","session","worker","cache:old-account-cache","database:old-account-db","navigate"]);assert.equal(changed.local.has("draft"),false);assert.equal(changed.local.get("trstGrammarlyAccount"),marker);assert(changed.document.cookie.includes(marker));
const unchanged=await run(true);assert.equal(unchanged.local.get("draft"),"old document");assert.deepEqual(unchanged.events,["navigate"]);
const blocked=await run(false,true);assert(!blocked.events.includes("navigate"));assert(!blocked.document.cookie);assert(blocked.status.textContent.includes("Could not prepare"));
console.log("Grammarly workspace transition: clears previous-account offline state before navigation, preserves same-account drafts and stops on cleanup failure.");
