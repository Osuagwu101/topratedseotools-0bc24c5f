"""Deploy only a clean, tested GitHub checkout; keep secrets server-side."""
import json,subprocess,time,urllib.request
from pathlib import Path
root=Path(__file__).resolve().parents[2]
def run(*a):return subprocess.check_output(a,text=True)
assert not run('git','-C',str(root),'status','--porcelain').strip()
assert (root/'.output/server/index.mjs').exists()
processes=json.loads(run('pm2','jlist'))
for name,source,port in [('trst-two-accounts-main','trst-claude-two-accounts','3281'),('trst-two-accounts-chatgpt','trst-info-chatgpt','3282')]:
 old=next(p for p in processes if p['name']==source)
 env=dict(old['pm2_env'].get('env',{}))
 for k,v in old['pm2_env'].items():
  if isinstance(v,str) and k.startswith(('SUPABASE_','VITE_','CLAUDE_','CHATGPT_','GRAMMARLY_','STEALTHWRITER_','PHRASLY_','PAYSTACK_','TURNITIN_')):env[k]=v
 env.update(PORT=port,NITRO_PORT=port,HOST='127.0.0.1',NITRO_HOST='127.0.0.1')
 private=root/'.deploy-private.json'
 private.write_text(json.dumps({'apps':[{'name':name,'cwd':str(root),'script':'.output/server/index.mjs','node_args':old['pm2_env'].get('node_args',[]),'env':env}]}));private.chmod(0o600)
 try:
  subprocess.run(['pm2','delete',name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  subprocess.check_call(['pm2','start',str(private)],stdout=subprocess.DEVNULL)
 finally:private.unlink()
 for attempt in range(20):
  try:
   with urllib.request.urlopen('http://127.0.0.1:'+port+'/login',timeout=10) as response:assert response.status==200
   break
  except Exception:
   if attempt==19:raise
   time.sleep(1)
# Collect new hashed assets; existing releases retain their assets.
subprocess.check_call(['sudo','cp','-an',str(root/'.output/public/assets')+'/.','/var/www/trst-assets-unified-20261015/assets/'])
backup=Path('/home/ubuntu/deploy-backups/chatgpt-two-accounts-20261116');backup.mkdir(exist_ok=True)
configs=[]
for name,oldport,newport in [('topratedseotools','3280','3281'),('claude-proxy','3280','3281'),('chatgpt-proxy','3277','3282')]:
 path='/etc/nginx/sites-enabled/'+name
 original=run('sudo','cat',path)
 assert '127.0.0.1:'+oldport in original or '127.0.0.1:'+newport in original
 saved=backup/name
 if not saved.exists():saved.write_text(original)
 staged=backup/(name+'.candidate');staged.write_text(original.replace('127.0.0.1:'+oldport,'127.0.0.1:'+newport))
 configs.append((path,saved,staged))
try:
 for path,saved,staged in configs:subprocess.check_call(['sudo','cp',str(staged),path])
 subprocess.check_call(['sudo','nginx','-t'])
 subprocess.check_call(['sudo','systemctl','reload','nginx'])
except Exception:
 for path,saved,staged in configs:subprocess.check_call(['sudo','cp',str(saved),path])
 subprocess.check_call(['sudo','nginx','-t']);subprocess.check_call(['sudo','systemctl','reload','nginx']);raise
subprocess.check_call(['pm2','save'])
print('ChatGPT two-account release activated from GitHub; existing writers remain on Account 1.')
