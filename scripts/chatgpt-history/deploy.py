"""Activate a clean GitHub release after migration, backfill and validation.
Only the main/Admin and ChatGPT vhosts change. Every other provider stays running.
"""
import json,subprocess,time,urllib.request,re
from pathlib import Path
root=Path(__file__).resolve().parents[2]
def run(*a):return subprocess.check_output(a,text=True)
assert not run('git','-C',str(root),'status','--porcelain').strip()
assert (root/'.output/server/index.mjs').exists()
processes=json.loads(run('pm2','jlist'))
backup=Path('/home/ubuntu/deploy-backups/chatgpt-history-20261117');backup.mkdir(exist_ok=True)
configs=[];sources={}
for vhost,newport in [('topratedseotools','3294'),('chatgpt-proxy','3295')]:
 path='/etc/nginx/sites-enabled/'+vhost;original=run('sudo','cat',path)
 match=re.search(r'location / \{[^}]*?proxy_pass http://127\.0\.0\.1:(\d+);',original)
 assert match,'Could not identify the live '+vhost+' application.'
 oldport=match.group(1);assert oldport not in ('3294','3295'),'History release is already live; inspect before redeploying.'
 source=next(p['name'] for p in processes if p['pm2_env'].get('status')=='online' and str(p['pm2_env'].get('PORT') or p['pm2_env'].get('env',{}).get('PORT'))==oldport)
 sources[vhost]=source
 saved=backup/vhost
 if not saved.exists():saved.write_text(original)
 staged=backup/(vhost+'.candidate');staged.write_text(original.replace('127.0.0.1:'+oldport,'127.0.0.1:'+newport));configs.append((path,saved,staged))
for name,source,port in [('trst-history-main',sources['topratedseotools'],'3294'),('trst-history-chatgpt',sources['chatgpt-proxy'],'3295')]:
 old=next(p for p in processes if p['name']==source)
 env=dict(old['pm2_env'].get('env',{}))
 for k,v in old['pm2_env'].items():
  if isinstance(v,str) and re.fullmatch(r'[A-Z][A-Z0-9_]*',k):env[k]=v
 env.update(PORT=port,NITRO_PORT=port,HOST='127.0.0.1',NITRO_HOST='127.0.0.1',CHATGPT_DURABLE_HISTORY='1')
 private=root/'.deploy-private.json'
 private.write_text(json.dumps({'apps':[{'name':name,'cwd':str(root),'script':'.output/server/index.mjs','node_args':old['pm2_env'].get('node_args',[]),'env':env}]}));private.chmod(0o600)
 try:
  existing=next((p for p in processes if p['name']==name),None)
  if existing:
   assert existing['pm2_env']['pm_cwd']==str(root),'Refusing to replace a process from another release.'
   subprocess.check_call(['pm2','delete',name],stdout=subprocess.DEVNULL)
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
try:
 for path,saved,staged in configs:subprocess.check_call(['sudo','cp',str(staged),path])
 subprocess.check_call(['sudo','nginx','-t']);subprocess.check_call(['sudo','systemctl','reload','nginx'])
except Exception:
 for path,saved,staged in configs:subprocess.check_call(['sudo','cp',str(saved),path])
 subprocess.check_call(['sudo','nginx','-t']);subprocess.check_call(['sudo','systemctl','reload','nginx']);raise
subprocess.check_call(['pm2','save'],stdout=subprocess.DEVNULL)
print('ChatGPT durable history activated; original processes retained for rollback.')
