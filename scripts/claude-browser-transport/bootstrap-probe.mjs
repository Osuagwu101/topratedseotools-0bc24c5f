const r=await fetch('http://127.0.0.1:6101/request',{method:'POST',headers:{Authorization:'Bearer '+process.env.CLAUDE_BROWSER_RELAY_KEY,'Content-Type':'application/json'},body:JSON.stringify({path:'/api/bootstrap',method:'GET',headers:{Accept:'application/json'}}),signal:AbortSignal.timeout(30000)});
const text=await r.text();let shape;
try{const data=JSON.parse(text);shape={keys:Object.keys(data),account_present:!!data.account,error_type:typeof data.error};}catch{shape={json:false};}
console.log(JSON.stringify({path:'/api/bootstrap',status:r.status,type:r.headers.get('content-type'),bytes:Buffer.byteLength(text),shape}));
