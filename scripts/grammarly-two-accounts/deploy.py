"""Deploy the committed Grammarly account/HTTP/WebSocket changes together."""
import json,subprocess,time,urllib.request
from pathlib import Path
root=Path(__file__).resolve().parents[2]
def run(*a):return subprocess.check_output(a,text=True)
assert not run('git','-C',str(root),'status','--porcelain').strip()
assert (root/'.output/server/index.mjs').exists()
processes=json.loads(run('pm2','jlist'))
for name,source,port,script in [
 ('trst-grammarly-two-main','trst-two-accounts-main','3283','.output/server/index.mjs'),
 ('trst-grammarly-two-http','trst-grammarly-ws','3284','.output/server/index.mjs'),
 ('trst-grammarly-two-ws','trst-grammarly-ws','3293','scripts/grammarly-ws-relay.mjs')]:
 old=next(p for p in processes if p['name']==source)
 env=dict(old['pm2_env'].get('env',{}))
 for k,v in old['pm2_env'].items():
  if isinstance(v,str) and k.startswith(('SUPABASE_','VITE_','CLAUDE_','CHATGPT_','GRAMMARLY_','STEALTHWRITER_','PHRASLY_','PAYSTACK_','TURNITIN_')):env[k]=v
 env.update(PORT=port,NITRO_PORT=port,HOST='127.0.0.1',NITRO_HOST='127.0.0.1',GRAMMARLY_PROXY_PUBLIC_ORIGIN='https://grammarly.topratedseotools.com')
 if script.endswith('relay.mjs'):env['GRAMMARLY_WS_RELAY_PORT']=port
 private=root/'.deploy-private.json'
 private.write_text(json.dumps({'apps':[{'name':name,'cwd':str(root),'script':script,'node_args':old['pm2_env'].get('node_args',[]),'env':env}]}));private.chmod(0o600)
 try:
  subprocess.run(['pm2','delete',name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  subprocess.check_call(['pm2','start',str(private)],stdout=subprocess.DEVNULL)
 finally:private.unlink()
 path='/__health' if script.endswith('relay.mjs') else '/login'
 for attempt in range(20):
  try:
   with urllib.request.urlopen('http://127.0.0.1:'+port+path,timeout=10) as response:assert response.status==200
   break
  except Exception:
   if attempt==19:raise
   time.sleep(1)
subprocess.check_call(['sudo','cp','-an',str(root/'.output/public/assets')+'/.','/var/www/trst-assets-unified-20261015/assets/'])
backup=Path('/home/ubuntu/deploy-backups/grammarly-two-accounts-20261116');backup.mkdir(exist_ok=True)
configs=[]
for name,oldport,newport in [('topratedseotools','3281','3283'),('claude-proxy','3281','3283'),('grammarly-proxy','3270','3284')]:
 path='/etc/nginx/sites-enabled/'+name;original=run('sudo','cat',path)
 assert '127.0.0.1:'+oldport in original or '127.0.0.1:'+newport in original
 saved=backup/name
 if not saved.exists():saved.write_text(original)
 candidate=original.replace('127.0.0.1:'+oldport,'127.0.0.1:'+newport)
 if name=='grammarly-proxy':
  assert '127.0.0.1:3290' in original or '127.0.0.1:3293' in original
  candidate=candidate.replace('127.0.0.1:3290','127.0.0.1:3293')
  # Retired preview processes do not implement account routing. All users must
  # pass through the same account-aware HTTP and checking authorization.
  candidate='\n'.join(line for line in candidate.split('\n') if 'if ($cookie_trst_coda_preview = 1)' not in line)
 staged=backup/(name+'.candidate');staged.write_text(candidate);configs.append((path,saved,staged))
try:
 for path,saved,staged in configs:subprocess.check_call(['sudo','cp',str(staged),path])
 subprocess.check_call(['sudo','nginx','-t']);subprocess.check_call(['sudo','systemctl','reload','nginx'])
except Exception:
 for path,saved,staged in configs:subprocess.check_call(['sudo','cp',str(saved),path])
 subprocess.check_call(['sudo','nginx','-t']);subprocess.check_call(['sudo','systemctl','reload','nginx']);raise
# Disconnect sockets still attached to account-unaware relays after Nginx reload.
for legacy in ['trst-grammarly-ws','trst-grammarly-coda-preview-ws']:
 subprocess.run(['pm2','stop',legacy],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
subprocess.check_call(['pm2','save'])
print('Committed Grammarly two-account HTTP, Admin and checking relay release activated.')
