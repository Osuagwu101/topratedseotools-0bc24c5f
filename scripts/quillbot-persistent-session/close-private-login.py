"""Close the temporary owner login display without stopping the signed-in browser."""
import subprocess
for name in ['trst-quillbot-admin-vnc','trst-quillbot-admin-web']:
 subprocess.run(['sudo','systemctl','stop',name],check=True)
print('Temporary login display closed; persistent browser profile retained.')
