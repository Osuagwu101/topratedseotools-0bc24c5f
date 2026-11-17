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
subprocess.run(['sudo','systemctl','restart','trst-quillbot-native-relay.service'],check=True)
subprocess.run(['sudo','systemctl','reload','nginx'],check=True)
print('Installed bounded relay and versioned dashboard bridge.')
