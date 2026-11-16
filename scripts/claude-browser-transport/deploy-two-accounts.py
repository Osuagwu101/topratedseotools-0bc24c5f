"""Run as ubuntu from the verified GitHub checkout on OVH. Never prints secrets."""
import json,os,secrets,subprocess,time
from pathlib import Path
root=Path(__file__).resolve().parents[2]
def run(*args): return subprocess.check_output(args,text=True)
assert run('git','-C',str(root),'status','--porcelain').strip()==''
assert (root/'.output/server/index.mjs').exists()
# Account 2 is configured independently. Account 1 processes are untouched.
key=secrets.token_hex(32)
envfile=Path('/etc/trst-claude-account-2-relay.env')
if envfile.exists():
 key=run('sudo','cat',str(envfile)).strip().split('=',1)[1]
else:
 private=root/'.relay-setup.env'
 private.write_text('CLAUDE_BROWSER_RELAY_KEY='+key+'\n');private.chmod(0o600)
 subprocess.check_call(['sudo','install','-m','600',str(private),str(envfile)]);private.unlink()
subprocess.check_call(['sudo','mkdir','-p','/opt/trst-claude-account-2-relay'])
base=root/'scripts/claude-browser-transport'
for source,target in [('relay.mjs','/opt/trst-claude-account-2-relay/relay.mjs'),('account-2-browser.service','/etc/systemd/system/trst-claude-account-2-browser.service'),('account-2-relay.service','/etc/systemd/system/trst-claude-account-2-relay.service')]:
 subprocess.check_call(['sudo','install','-m','644',str(base/source),target])
subprocess.check_call(['sudo','systemctl','daemon-reload'])
subprocess.check_call(['sudo','systemctl','enable','--now','trst-claude-account-2-browser','trst-claude-account-2-relay'])
processes=json.loads(run('pm2','jlist'))
old=next(p for p in processes if p['name']=='trst-info-main')
env=dict(old['pm2_env'].get('env',{}))
# PM2 retains server-side environment alongside env on some versions.
for k,v in old['pm2_env'].items():
 if isinstance(v,str) and (k.startswith(('SUPABASE_','VITE_','CLAUDE_','CHATGPT_','GRAMMARLY_','STEALTHWRITER_','PHRASLY_','PAYSTACK_','TURNITIN_'))):env[k]=v
env.update(PORT='3280',HOST='127.0.0.1',CLAUDE_ACCOUNT_2_RELAY_URL='http://127.0.0.1:6102/request',CLAUDE_ACCOUNT_2_RELAY_KEY=key)
config=root/'.deploy-private.json'
config.write_text(json.dumps({'apps':[{'name':'trst-claude-two-accounts','cwd':str(root),'script':'.output/server/index.mjs','env':env}]}));config.chmod(0o600)
try: subprocess.check_call(['pm2','start',str(config)])
finally: config.unlink()
# Verify app before making the vhost change.
import urllib.request,urllib.error
for attempt in range(15):
 try:
  with urllib.request.urlopen('http://127.0.0.1:3280/login',timeout=10) as response: assert response.status==200
  break
 except Exception:
  if attempt==14:raise
  time.sleep(1)
backup=Path('/home/ubuntu/deploy-backups/claude-two-accounts-20261116');backup.mkdir(exist_ok=True)
files=['/etc/nginx/sites-available/topratedseotools','/etc/nginx/sites-available/claude-proxy']
for filename in files:
 target=Path(filename)
 original=run('sudo','cat',str(target))
 assert '127.0.0.1:3276' in original
 saved=backup/target.name
 if not saved.exists():saved.write_text(original)
 staged=backup/(target.name+'.candidate')
 staged.write_text(original.replace('127.0.0.1:3276','127.0.0.1:3280'))
 subprocess.check_call(['sudo','cp',str(staged),str(target)])
try: subprocess.check_call(['sudo','nginx','-t'])
except Exception:
 for filename in files:subprocess.check_call(['sudo','cp',str(backup/Path(filename).name),filename])
 raise
subprocess.check_call(['sudo','systemctl','reload','nginx'])
subprocess.check_call(['pm2','save'])
print('Committed two-account release activated; Account 2 still requires sign-in and verification.')
