"""Deploy only the Grammarly HTTP and checking processes; preserve rollback."""
import json,subprocess,urllib.request,time,socket,hashlib,sys
from pathlib import Path
root=Path(__file__).resolve().parents[2]
def run(*args):return subprocess.check_output(args,text=True)
assert not run('git','-C',str(root),'status','--porcelain','--untracked-files=no').strip()
assert (root/'.output/server/index.mjs').is_file()
backup=Path('/home/ubuntu/deploy-backups/grammarly-docs-20261117');backup.mkdir(parents=True,exist_ok=True)
manifest=backup/'candidate.json'
config='/etc/nginx/sites-enabled/grammarly-proxy'
if '--activate' not in sys.argv:
 ps=json.loads(run('pm2','jlist'));old=next(p for p in ps if p['name']=='trst-grammarly-two-http')['pm2_env']
 ports=[]
 for port in range(3310,3400):
  with socket.socket() as s:
   try:s.bind(('127.0.0.1',port))
   except OSError:continue
   ports.append(port)
  if len(ports)==2:break
 assert len(ports)==2
 for name,script,port in [('trst-grammarly-docs-http','.output/server/index.mjs',ports[0]),('trst-grammarly-docs-ws','scripts/grammarly-ws-relay.mjs',ports[1])]:
  env=dict(old.get('env',{}))
  env.update({k:v for k,v in old.items() if isinstance(v,str) and k.startswith(('SUPABASE_','VITE_','GRAMMARLY_'))})
  env.update(PORT=str(port),NITRO_PORT=str(port),HOST='127.0.0.1',NITRO_HOST='127.0.0.1',GRAMMARLY_WS_RELAY_PORT=str(port))
  private=root/'.deploy-private.json';private.write_text(json.dumps({'apps':[{'name':name,'script':script,'cwd':str(root),'node_args':old.get('node_args',[]),'env':env}]}));private.chmod(0o600)
  try:subprocess.check_call(['pm2','start',str(private)],stdout=subprocess.DEVNULL)
  finally:private.unlink()
  for attempt in range(20):
   try:
    with urllib.request.urlopen(f'http://127.0.0.1:{port}'+('/__health' if 'ws' in name else '/login'),timeout=10) as r:assert r.status==200
    break
   except Exception:
    if attempt==19:raise
    time.sleep(1)
 manifest.write_text(json.dumps({'http':ports[0],'ws':ports[1],'release':str(root)}))
 print('Prepared Grammarly HTTP and WebSocket candidates:',ports)
else:
 candidate=json.loads(manifest.read_text());assert candidate['release']==str(root)
 before={str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in Path('/etc/nginx/sites-enabled').iterdir() if str(p)!=config}
 original=run('sudo','cat',config);saved=backup/'grammarly-proxy'
 assert not saved.exists(),'Activation already has a saved rollback config'
 saved.write_text(original)
 assert '127.0.0.1:3284' in original and '127.0.0.1:3293' in original
 new=original.replace('127.0.0.1:3284','127.0.0.1:'+str(candidate['http'])).replace('127.0.0.1:3293','127.0.0.1:'+str(candidate['ws']))
 staged=backup/'grammarly-proxy.candidate';staged.write_text(new)
 try:
  subprocess.check_call(['sudo','cp',str(staged),config]);subprocess.check_call(['sudo','nginx','-t']);subprocess.check_call(['sudo','systemctl','reload','nginx'])
 except Exception:
  subprocess.check_call(['sudo','cp',str(saved),config]);subprocess.check_call(['sudo','nginx','-t']);subprocess.check_call(['sudo','systemctl','reload','nginx']);raise
 assert all(hashlib.sha256(Path(p).read_bytes()).hexdigest()==h for p,h in before.items())
 subprocess.check_call(['pm2','save'],stdout=subprocess.DEVNULL)
 print('Activated Grammarly only; every other vhost hash is unchanged. Prior processes retained.')
