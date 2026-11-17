"""Install committed cookie synchronisation into the dedicated QuillBot runtime."""
from pathlib import Path
import subprocess
root=Path(__file__).resolve().parents[2]
runtime=Path('/home/ubuntu/worktrees/quillbot-feasibility-20261006/runtime')
p=runtime/'server-browser.mjs';s=p.read_text()
if 'syncBrowserSession' not in s:
 s=s.replace('import { browserFetch }','import { browserFetch, syncBrowserSession }').replace('import {browserFetch}','import {browserFetch, syncBrowserSession}')
 if 'syncBrowserSession' not in s.split('async function assignedAccount')[0]:raise RuntimeError('Unknown browserFetch import; refusing to patch')
 s=s.replace('async function assignedAccount(){','async function assignedAccount(){\n const saved=await loadProvider("account_1");\n await syncBrowserSession(saved.state,saved.envelope);')
 backup=p.with_suffix('.mjs.before-cookie-connect');
 if not backup.exists():backup.write_text(p.read_text())
 p.write_text(s)
fetch=runtime.parent/'browser-transport/browser-fetch.mjs'
fetch.write_text((root/'browser-transport/browser-fetch.mjs').read_text())
subprocess.run(['sudo','cp',str(root/'browser-transport/relay.mjs'),'/var/lib/trst-quillbot-browser/relay.mjs'],check=True)
subprocess.run(['sudo','systemctl','restart','trst-quillbot-native-relay.service'],check=True)
subprocess.run(['pm2','restart','trst-quillbot-oneclick'],stdout=subprocess.DEVNULL,check=True)
print('Installed cookie synchronisation. Fresh Admin cookies and live verification still required.')
