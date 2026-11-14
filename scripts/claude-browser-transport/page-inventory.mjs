import {mkdir,writeFile} from 'node:fs/promises';
const r=await fetch('http://127.0.0.1:6101/request',{method:'POST',headers:{Authorization:'Bearer '+process.env.CLAUDE_BROWSER_RELAY_KEY,'Content-Type':'application/json'},body:JSON.stringify({path:'/new',method:'GET',headers:{Accept:'text/html'}}),signal:AbortSignal.timeout(30000)});
if(r.status!==200)throw Error('Page request failed: '+r.status);
const text=await r.text();
const folder='/home/ubuntu/qa/claude-browser-transport-20261114';
await mkdir(folder,{recursive:true,mode:0o700});await writeFile(folder+'/page.html',text,{mode:0o600});
const assets=new Set();
for(const m of text.matchAll(/<(?:script|link)\b[^>]*(?:src|href)=["']([^"']+)["']/gi)){try{const u=new URL(m[1],'https://claude.ai');if(['http:','https:'].includes(u.protocol))assets.add(u.origin+u.pathname);}catch{}}
console.log(JSON.stringify({status:r.status,assets:[...assets].slice(0,50),framework:{next:text.includes('__NEXT_DATA__')||text.includes('__next_f'),reactRouter:text.includes('__reactRouterContext'),remix:text.includes('__remixContext'),svelte:text.includes('__svelte')},integrityAttributes:(text.match(/ integrity=/g)||[]).length}));
