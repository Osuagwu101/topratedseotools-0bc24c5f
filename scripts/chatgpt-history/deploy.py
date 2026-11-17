"""Activate a clean GitHub release after migration, backfill and validation.
Only the main/Admin and ChatGPT vhosts change. Every other provider stays running.
"""
import json,subprocess,time,urllib.request
from pathlib import Path
root=Path(__file__).resolve().parents[2]
def run(*a):return subprocess.check_output(a,text=True)
assert not run('git','-C',str(root),'status','--porcelain').strip()
assert (root/'.output/server/index.mjs').exists()
processes=json.loads(run('pm2','jlist'))
backup=Path('/home/ubuntu/deploy-backups/chatgpt-history-20261117');backup.mkdir(exist_ok=True)
for name,source,port in [('trst-history-main','trst-grammarly-two-main','3294'),('trst-history-chatgpt','trst-two-accounts-chatgpt','3295')]:
 old=next(p for p in processes if p['name']==source)
 env=dict(old['pm2_env'].get('env',{}))
 for k,v in old['pm2_env'].items():
  if isinstance(v,str) and k.startswith(('SUPABASE_','VITE_','CLAUDE_','CHATGPT_','GRAMMARLY_','STEALTHWRITER_','PHRASLY_','PAYSTACK_','TURNITIN_')):env[k]=v
 env.update(PORT=port,NITRO_PORT=port,HOST='127.0.0.1',NITRO_HOST='127.0.0.1',CHATGPT_DURABLE_HISTORY='1')
 private=root/'.deploy-private.json'
 private.write_text(json.dumps({'apps':[{'name':name,'cwd':str(root),'script':'.output/server/index.mjs','node_args':old['pm2_env'].get('node_args',[]),'env':env}]}));private.chmod(0o600)
 try:
  if any(p['name']==name for p in processes):raise RuntimeError('Release process already exists; inspect it before redeploying.')
  subprocess.check_call(['pm2','start',str(private)],stdout=subprocess.DEVNULL)
 finally:private.unlink()
 for attempt in range(20):
  try:
   with urllib.request.urlopen('http://127.0.0.1:'+port+'/login',timeout=10) as response:assert response.status==200
   break
  except Exception:
   if attempt==19:raise
   time.sleep(1)
subprocess.check_call(['sudo','cp','-an',str(root/'.output/public/assets')+'/.','/var/www/trst-assets-unified-20261015/assets/'])
configs=[]
for name,oldport,newport in [('topratedseotools','3283','3294'),('chatgpt-proxy','3282','3295')]:
 path='/etc/nginx/sites-enabled/'+name;original=run('sudo','cat',path)
 assert '127.0.0.1:'+oldport in original
 saved=backup/name
 if not saved.exists():saved.write_text(original)
 staged=backup/(name+'.candidate');staged.write_text(original.replace('127.0.0.1:'+oldport,'127.0.0.1:'+newport));configs.append((path,saved,staged))
try:
 for path,saved,staged in configs:subprocess.check_call(['sudo','cp',str(staged),path])
 subprocess.check_call(['sudo','nginx','-t']);subprocess.check_call(['sudo','systemctl','reload','nginx'])
except Exception:
 for path,saved,staged in configs:subprocess.check_call(['sudo','cp',str(saved),path])
 subprocess.check_call(['sudo','nginx','-t']);subprocess.check_call(['sudo','systemctl','reload','nginx']);raise
subprocess.check_call(['pm2','save'],stdout=subprocess.DEVNULL)
print('ChatGPT durable history activated; original processes retained for rollback.')
