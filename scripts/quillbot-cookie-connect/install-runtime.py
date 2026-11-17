"""Install committed cookie synchronisation into the dedicated QuillBot runtime."""
from pathlib import Path
import subprocess
root=Path(__file__).resolve().parents[2]
runtime=Path('/home/ubuntu/worktrees/quillbot-feasibility-20261006/runtime')
# Admin and the transport must decrypt the same saved account envelope.
import json,re,hmac,hashlib,base64,os
ps=json.loads(subprocess.check_output(['pm2','jlist']))
config=Path('/etc/nginx/sites-enabled/topratedseotools').read_text()
port=re.search(r'location / \{[^}]*?proxy_pass http://127.0.0.1:(\d+)',config).group(1)
active=next(x for x in ps if str(x['pm2_env'].get('PORT') or x['pm2_env'].get('env',{}).get('PORT'))==port and x['pm2_env']['status']=='online')
meta=active['pm2_env'];environment=dict(x.split('=',1) for x in Path('/proc/'+str(active['pid'])+'/environ').read_text().split('\0') if '=' in x)
for arg in meta.get('node_args') or []:
 if arg.startswith('--env-file='):
  for line in Path(arg.split('=',1)[1]).read_text().splitlines():
   if '=' in line and not line.lstrip().startswith('#'):
    name,value=line.split('=',1);environment.setdefault(name.strip(),value.strip().strip(chr(34)).strip(chr(39)))
raw=environment.get('QUILLBOT_SESSION_ENCRYPTION_KEY','')
if raw:vaultkey=bytes.fromhex(raw) if re.fullmatch('[0-9a-fA-F]{64}',raw) else base64.b64decode(raw)
else:
 prk=hmac.new(b'topratedseotools',environment['SUPABASE_SERVICE_ROLE_KEY'].encode(),hashlib.sha256).digest()
 vaultkey=hmac.new(prk,b'quillbot-session-encryption:v1'+bytes([1]),hashlib.sha256).digest()
assert len(vaultkey)==32
private=runtime/'.env';backup=runtime/'.env.before-admin-vault-key'
if not backup.exists():backup.write_bytes(private.read_bytes());backup.chmod(0o600)
private.write_text(re.sub(r'^QUILLBOT_SESSION_ENCRYPTION_KEY=.*\n?','',private.read_text(),flags=re.M)+'\nQUILLBOT_SESSION_ENCRYPTION_KEY='+vaultkey.hex()+'\n');private.chmod(0o600)
restart_environment=os.environ.copy();restart_environment['QUILLBOT_SESSION_ENCRYPTION_KEY']=vaultkey.hex()
p=runtime/'server-browser.mjs';s=p.read_text()
if 'syncBrowserSession' not in s:
 s=s.replace('import { browserFetch }','import { browserFetch, syncBrowserSession }').replace('import {browserFetch}','import {browserFetch, syncBrowserSession}')
 if 'syncBrowserSession' not in s.split('async function assignedAccount')[0]:raise RuntimeError('Unknown browserFetch import; refusing to patch')
 s=s.replace('async function assignedAccount(){','async function assignedAccount(){\n const saved=await loadProvider("account_1");\n await syncBrowserSession(saved.state,saved.envelope);')
 s=s.replace('  const path = url.pathname.slice(BASE.length);','  const path = url.pathname.slice(BASE.length);\n  if(path === "/__trst/internal/verify" && request.method === "POST"){if(request.headers.get("authorization") !== "Bearer "+key)return new Response("Forbidden",{status:403});accountCached=null;try{await assignedAccount();return Response.json({ok:true});}catch{return new Response("Connection could not be verified",{status:503});}}')
 backup=p.with_suffix('.mjs.before-cookie-connect');
 if not backup.exists():backup.write_text(p.read_text())
 p.write_text(s)
fetch=runtime.parent/'browser-transport/browser-fetch.mjs'
fetch.write_text((root/'browser-transport/browser-fetch.mjs').read_text())
subprocess.run(['sudo','cp',str(root/'browser-transport/relay.mjs'),'/var/lib/trst-quillbot-browser/relay.mjs'],check=True)
subprocess.run(['sudo','systemctl','restart','trst-quillbot-native-relay.service'],check=True)
subprocess.run(['pm2','restart','trst-quillbot-oneclick','--update-env'],env=restart_environment,stdout=subprocess.DEVNULL,check=True)
print('Installed cookie synchronisation. Fresh Admin cookies and live verification still required.')
