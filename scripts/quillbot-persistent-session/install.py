"""Install the private renewal monitor without restarting the provider browser."""
from pathlib import Path
import subprocess
root=Path(__file__).resolve().parents[2]
runtime=Path('/home/ubuntu/worktrees/quillbot-feasibility-20261006/runtime')
for name in ['relay.mjs','session-renewal.mjs']:
 target='/var/lib/trst-quillbot-browser/'+name
 subprocess.run(['sudo','cp',str(root/'browser-transport'/name),target],check=True)
subprocess.run(['sudo','systemctl','restart','trst-quillbot-native-relay.service'],check=True)
helper=runtime/'persistent-session-setup.mjs'
helper.write_bytes((root/'scripts/quillbot-persistent-session/seed-binding.mjs').read_bytes())
subprocess.run(['node','--experimental-strip-types',str(helper)],cwd=runtime,check=True)
print('Renewal monitor installed. Native browser profile was retained.')
