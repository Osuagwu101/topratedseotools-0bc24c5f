async function probe(path) {
  const response=await fetch('http://127.0.0.1:6101/request',{method:'POST',headers:{Authorization:'Bearer '+process.env.CLAUDE_BROWSER_RELAY_KEY,'Content-Type':'application/json'},body:JSON.stringify({path,method:'GET',headers:{Accept:path.startsWith('/api/')?'application/json':'text/html'}}),signal:AbortSignal.timeout(60000)});
  const body=await response.text();
  let organizations=0;
  try {const json=JSON.parse(body);if(Array.isArray(json))organizations=json.filter(v=>typeof v?.uuid==='string').length;}catch{}
  const result={path,status:response.status,content_type:response.headers.get('content-type'),bytes:Buffer.byteLength(body),challenge:response.headers.get('cf-mitigated')==='challenge',organizations,final_path:response.headers.get('x-trst-browser-path')};
  console.log(JSON.stringify(result));
  return {result,body};
}
const first=await probe('/api/organizations');
if(first.result.status===200 && first.result.organizations>0 && !first.result.challenge) {
  const page=await probe('/new');
  console.log(JSON.stringify({html_document:/<!doctype html|<html/i.test(page.body),next_assets:(page.body.match(/_next\/static/g)||[]).length,contains_literal_session_key:/["']sessionKey["']\s*:/.test(page.body)}));
}
