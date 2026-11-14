import {fetchClaudeProvider} from '../../src/lib/claude-browser-fetch.server';
const orgResponse=await fetchClaudeProvider('https://claude.ai/api/organizations',{method:'GET'});
const orgs=await orgResponse.json(); if(!Array.isArray(orgs)||!orgs[0]?.uuid)throw Error('No organization');
const path='/api/organizations/'+orgs[0].uuid+'/chat_conversations/51294a90-0b55-4766-80a2-c28c1d16eda0?tree=True';
const r=await fetchClaudeProvider('https://claude.ai'+path,{method:'GET'});
const raw=await r.text();let d;try{d=JSON.parse(raw)}catch{}
console.log(JSON.stringify({status:r.status,type:r.headers.get('content-type'),bytes:raw.length,reply_marker_present:raw.includes('NATIVE_PROXY_OK'),keys:d?Object.keys(d):[],messages:d?.chat_messages?.map((m:any)=>({sender:m.sender,marker:JSON.stringify(m).includes('NATIVE_PROXY_OK')}))}));
