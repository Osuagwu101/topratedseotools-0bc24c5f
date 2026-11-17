"""Publish the committed landing-page app on the main website only."""
import json,re,subprocess,socket,time,urllib.request,hashlib
from pathlib import Path
root=Path(__file__).resolve().parents[2]
def run(*args):return subprocess.check_output(args,text=True)
assert not run('git','-C',str(root),'status','--porcelain','--untracked-files=no').strip()
assert (root/'.output/server/index.mjs').is_file()
path=Path('/etc/nginx/sites-enabled/topratedseotools')
original=run('sudo','cat',str(path));oldport=re.search(r'location / \{[^}]*?proxy_pass http://127.0.0.1:(\d+)',original).group(1)
ps=json.loads(run('pm2','jlist'))
old=next(p['pm2_env'] for p in ps if str(p['pm2_env'].get('PORT') or p['pm2_env'].get('env',{}).get('PORT'))==oldport and p['pm2_env']['status']=='online')
for port in range(3400,3500):
 with socket.socket() as s:
  try:s.bind(('127.0.0.1',port));break
  except OSError:continue
else:raise RuntimeError('No free release port')
env=dict(old.get('env',{}));env.update({k:v for k,v in old.items() if isinstance(v,str) and k.startswith(('SUPABASE_','VITE_','CLAUDE_','CHATGPT_','GRAMMARLY_','STEALTHWRITER_','PHRASLY_','PAYSTACK_','TURNITIN_'))});env.update(PORT=str(port),NITRO_PORT=str(port),HOST='127.0.0.1',NITRO_HOST='127.0.0.1')
private=root/'.deploy-private.json';private.write_text(json.dumps({'apps':[{'name':'trst-grammarly-landing-main-'+str(port),'script':'.output/server/index.mjs','cwd':str(root),'node_args':old.get('node_args',[]),'env':env}]}));private.chmod(0o600)
try:subprocess.check_call(['pm2','start',str(private)],stdout=subprocess.DEVNULL)
finally:private.unlink()
for attempt in range(20):
 try:
  with urllib.request.urlopen(f'http://127.0.0.1:{port}/login',timeout=10) as r:assert r.status==200
  break
 except Exception:
  if attempt==19:raise
  time.sleep(1)
for route in ['/tools/grammarly','/tools/chatgpt','/turnitin','/login']:
 req=urllib.request.Request(f'http://127.0.0.1:{port}'+route,headers={'Host':'topratedseotools.com','X-Forwarded-Proto':'https'})
 with urllib.request.urlopen(req,timeout=60) as response:
  assert response.status==200
  html=response.read().decode()
  if route=='/tools/grammarly':
   assert 'Share the access.' in html and 'gr-plans' in html and '/order/grammarly?plan=' in html
  if route=='/tools/chatgpt':assert 'gr-hero-grid' not in html
backup=Path('/home/ubuntu/deploy-backups/grammarly-landing-20261117');backup.mkdir(parents=True,exist_ok=True)
saved=backup/'topratedseotools';assert not saved.exists(),'A rollback config already exists';saved.write_text(original)
others={str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in Path('/etc/nginx/sites-enabled').iterdir() if p!=path}
subprocess.check_call(['sudo','cp','-an',str(root/'.output/public/assets')+'/.','/var/www/trst-assets-unified-20261015/assets/'])
candidate=backup/'topratedseotools.candidate';candidate.write_text(original.replace('127.0.0.1:'+oldport,'127.0.0.1:'+str(port)))
try:
 subprocess.check_call(['sudo','cp',str(candidate),str(path)]);subprocess.check_call(['sudo','nginx','-t']);subprocess.check_call(['sudo','systemctl','reload','nginx'])
 with urllib.request.urlopen('https://topratedseotools.com/tools/grammarly',timeout=60) as r:assert r.status==200 and 'Share the access.' in r.read().decode()
except Exception:
 subprocess.check_call(['sudo','cp',str(saved),str(path)]);subprocess.check_call(['sudo','nginx','-t']);subprocess.check_call(['sudo','systemctl','reload','nginx']);raise
assert all(hashlib.sha256(Path(p).read_bytes()).hexdigest()==h for p,h in others.items())
subprocess.check_call(['pm2','save'],stdout=subprocess.DEVNULL)
print('Landing page published on main website. Other provider vhosts unchanged; previous process retained.',port)
