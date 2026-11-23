import http from "node:http";
import { createRequire } from "node:module";
const require=createRequire(new URL("../../package.json", import.meta.url));
const WebSocket=require("ws");
const sent=[];let opens=0,closes=0;
// fake app (voice-auth) on 4401
http.createServer((req,res)=>{if(req.url==="/__trst/voice-auth"&&/trst_claude_proxy=good/.test(req.headers.cookie||"")){res.writeHead(200,{"content-type":"application/json"});res.end('{"account":"account_1"}');}else{res.writeHead(401);res.end();}}).listen(4401,"127.0.0.1");
// fake relay on 6101
const streams=new Map();
http.createServer(async(req,res)=>{
  if(req.headers.authorization!=="Bearer k".padEnd(7+32,"x")){res.writeHead(401);res.end();return;}
  let b="";for await(const c of req)b+=c;const j=JSON.parse(b||"{}");
  if(req.url==="/voice/open"){opens++;res.writeHead(200,{"content-type":"application/x-ndjson"});res.write(JSON.stringify({t:"id",id:"a".repeat(32)})+"\n");setTimeout(()=>res.write(JSON.stringify({t:"open",p:""})+"\n"),50);streams.set("a".repeat(32),res);res.on("close",()=>streams.delete("a".repeat(32)));return;}
  if(req.url==="/voice/send"){sent.push(...j.frames);const s=streams.get(j.id);for(const f of j.frames){if(f.t==="text")s.write(JSON.stringify({t:"text",d:"echo:"+f.d})+"\n");else s.write(JSON.stringify({t:"text",d:"bytes:"+Buffer.from(f.d,"base64").length})+"\n");}res.writeHead(204);res.end();return;}
  if(req.url==="/voice/close"){closes++;streams.get(j.id)?.end();res.writeHead(204);res.end();return;}
  res.writeHead(404);res.end();
}).listen(6101,"127.0.0.1");
process.env.CLAUDE_PUBLIC_ORIGIN="http://127.0.0.1:4401";process.env.CLAUDE_RELAY_KEY_ACCOUNT_1="Bearer k".padEnd(7+32,"x").slice(7);
const {startBridge,isDictationPath}=await import("./bridge.mjs");
startBridge({port:4402});
const assert=(c,m)=>{if(!c){console.error("FAIL",m);process.exit(1)}};
assert(isDictationPath("/api/ws/speech_to_text/voice_stream?lang=en"),"path ok");
assert(!isDictationPath("/api/ws/other/x"),"other path refused");
const connect=(cookie,origin="http://127.0.0.1:4401",p="/api/ws/speech_to_text/voice_stream?language=en")=>new Promise(r=>{const ws=new WebSocket("ws://127.0.0.1:4402"+p,{headers:{cookie,origin}});const got=[];ws.on("open",()=>r({ws,got,ok:true}));ws.on("message",d=>got.push(String(d)));ws.on("unexpected-response",(q,res)=>r({ok:false,status:res.statusCode}));ws.on("error",()=>r({ok:false}));});
let x=await connect("trst_claude_proxy=bad");assert(!x.ok&&x.status===401,"bad session refused "+x.status);
x=await connect("trst_claude_proxy=good","https://evil.test");assert(!x.ok&&x.status===403,"foreign origin refused");
x=await connect("trst_claude_proxy=good",undefined,"/api/ws/other/x");assert(!x.ok&&x.status===404,"path refused");
x=await connect("trst_claude_proxy=good");assert(x.ok,"opened");
x.ws.send("hello");x.ws.send(Buffer.alloc(3200));x.ws.send('{"type":"end"}');
await new Promise(r=>setTimeout(r,400));
assert(x.got.join("|")==='echo:hello|bytes:3200|echo:{"type":"end"}',"ordered echo: "+x.got.join("|"));
assert(sent[1].t==="bin","binary preserved");
x.ws.close();await new Promise(r=>setTimeout(r,300));
assert(closes===1,"relay close called "+closes);
console.log("dictation bridge e2e passed: auth, origin, path, ordered text+binary frames, close");process.exit(0);
