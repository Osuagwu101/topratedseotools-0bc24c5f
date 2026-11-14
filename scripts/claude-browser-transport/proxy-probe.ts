import {createClaudeProxyLaunch} from '../../src/lib/claude-proxy.server';
const launch=await createClaudeProxyLaunch('34e53d10-e2d4-4fb7-a341-cbe6e44f6513');
const entry=await fetch(launch.launchUrl,{redirect:'manual'});
const cookie=entry.headers.get('set-cookie')?.split(';')[0];
console.log(JSON.stringify({entry_status:entry.status,redirect:entry.headers.get('location'),has_app_cookie:!!cookie}));
if(!cookie)throw Error('No pilot cookie');
const origin=new URL(launch.launchUrl).origin;
for(const path of ['/new','/api/bootstrap']){
 const response=await fetch(origin+path,{headers:{Cookie:cookie,Accept:path.startsWith('/api/')?'application/json':'text/html'},signal:AbortSignal.timeout(45000)});
 const text=await response.text();let shape;
 try{const data=JSON.parse(text);shape={keys:Object.keys(data),account_present:!!data.account,error:typeof data.error==='string'?data.error:undefined};}catch{}
 console.log(JSON.stringify({path,status:response.status,type:response.headers.get('content-type'),bytes:Buffer.byteLength(text),shape}));
}
