"""Deploy the bounded QuillBot relay and versioned dashboard bridge only."""
from pathlib import Path
import hashlib, subprocess
root=Path(__file__).resolve().parents[2]
bridge=root/'browser-transport/dashboard-bridge.js'
name='quillbot-oneclick-'+hashlib.sha256(bridge.read_bytes()).hexdigest()[:12]+'.js'
asset=Path('/var/www/trst-assets-unified-20261015/assets')/name
subprocess.run(['sudo','cp',str(bridge),str(asset)],check=True)
config=Path('/etc/nginx/sites-enabled/topratedseotools')
import re
text=config.read_text()
updated=re.sub(r'quillbot-oneclick-[a-f0-9]+\.js',name,text)
assert updated!=text or name in text
backup=Path('/home/ubuntu/quillbot-launch-nginx-backup.conf')
if not backup.exists():backup.write_text(text)
prepared=Path('/tmp/quillbot-launch-nginx.conf');prepared.write_text(updated)
subprocess.run(['sudo','cp',str(prepared),str(config)],check=True)
if subprocess.run(['sudo','nginx','-t']).returncode:
 prepared.write_text(text)
 subprocess.run(['sudo','cp',str(prepared),str(config)],check=True)
 raise RuntimeError('Nginx validation failed; restored previous configuration')
subprocess.run(['sudo','cp',str(root/'browser-transport/relay.mjs'),'/var/lib/trst-quillbot-browser/relay.mjs'],check=True)
runtime=Path('/home/ubuntu/worktrees/quillbot-feasibility-20261006/runtime/server-browser.mjs')
for name in ['client-auth-adapter.mjs','client-auth-pin.json']:
 (runtime.parent.parent/'browser-transport'/name).write_bytes((root/'browser-transport'/name).read_bytes())
source=runtime.read_text()
old='res.writeHead(status, Object.fromEntries(quillBotResponseHeaders()));'
new="""const errorHeaders=Object.fromEntries(quillBotResponseHeaders());
    if(['/__qbtest/__trst/launch','/__trst/launch'].includes(new URL(req.url,PUBLIC).pathname)&&['https://topratedseotools.com','https://www.topratedseotools.com',PUBLIC].includes(req.headers.origin)){
      errorHeaders['access-control-allow-origin']=req.headers.origin;errorHeaders['access-control-allow-credentials']='true';errorHeaders.vary='Origin';
    }
    res.writeHead(status,errorHeaders);"""
assert old in source or 'res.writeHead(status,errorHeaders);' in source
if old in source:
 backup=runtime.with_suffix('.mjs.before-launch-error-fix')
 if not backup.exists():backup.write_text(source)
 runtime.write_text(source.replace(old,new))
subprocess.run(['node','--check',str(runtime)],check=True)
subprocess.run(['sudo','systemctl','restart','trst-quillbot-native-browser.service','trst-quillbot-native-relay.service'],check=True)
subprocess.run(['pm2','restart','trst-quillbot-oneclick'],stdout=subprocess.DEVNULL,check=True)
subprocess.run(['sudo','systemctl','reload','nginx'],check=True)
print('Installed bounded relay and versioned dashboard bridge.')
