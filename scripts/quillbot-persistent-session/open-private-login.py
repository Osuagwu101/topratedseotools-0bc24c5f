"""Expose the dedicated provider browser only through an operator SSH tunnel."""
import subprocess
for name in ['trst-quillbot-admin-vnc','trst-quillbot-admin-web']:
 subprocess.run(['sudo','systemctl','stop',name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 subprocess.run(['sudo','systemctl','reset-failed',name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
common=['sudo','systemd-run','--collect','--uid=trst-quillbot-browser','--property=RuntimeMaxSec=3600']
subprocess.run(common+['--unit=trst-quillbot-admin-vnc','--setenv=DISPLAY=:96','--setenv=XAUTHORITY=/var/lib/trst-quillbot-browser/.Xauthority','/usr/bin/x11vnc','-display',':96','-auth','/var/lib/trst-quillbot-browser/.Xauthority','-listen','127.0.0.1','-localhost','-rfbport','5906','-nopw','-forever','-shared','-noxdamage'],check=True)
subprocess.run(common+['--unit=trst-quillbot-admin-web','/usr/bin/websockify','--web=/usr/share/novnc','127.0.0.1:6096','127.0.0.1:5906'],check=True)
print('Private login ready on server loopback port 6096; use SSH forwarding only. Expires after one hour.')
