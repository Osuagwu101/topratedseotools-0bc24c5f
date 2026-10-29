"""Replace only the authenticated writer-extension download, retaining the old ZIP."""
from pathlib import Path
import json,hashlib,subprocess,shutil,os,urllib.request,urllib.error,zipfile,time
repo=Path(__file__).resolve().parents[2];root=Path('/home/ubuntu/releases/trst-phrasly-cookie-replacement-20261029')
env=json.loads(Path('/home/ubuntu/releases/trst-phrasly-session-paste-20261029/settings.private.json').read_text())
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def processes():return {p['name']:{'pid':p['pid'],'status':p['pm2_env']['status'],'restarts':p['pm2_env']['restart_time']} for p in json.loads(subprocess.check_output(['pm2','jlist'],text=True))}
def req(url,body=None,headers=None):
 data=json.dumps(body).encode() if body is not None else None
 request=urllib.request.Request(url,data=data,headers={**(headers or {}),**({'Content-Type':'application/json'} if data is not None else {})})
 with urllib.request.urlopen(request,timeout=30) as r:return r.status,r.read()
root.mkdir(mode=0o700);package=root/'TopRated-Phrasly-Access.zip'
subprocess.run(['python3',str(repo/'scripts/phrasly/package-native-extension.py'),'--origin','https://topratedseotools.com','--enabled','--out',str(package)],check=True,capture_output=True,text=True)
with zipfile.ZipFile(package) as z:
 manifest=json.loads(z.read('manifest.json'));assert manifest['version']=='1.0.2'
 assert manifest['permissions']==['cookies','tabs','webNavigation','storage']
 assert manifest['key']==json.loads((repo/'extensions/phrasly-oneclick/manifest.json').read_text())['key']
for key in ['SUPABASE_SERVICE_ROLE_KEY','PHRASLY_SESSION_ENCRYPTION_KEY','PHRASLY_AWS_EXTENSION_GATE_SECRET']:assert env[key].encode() not in package.read_bytes()
active=Path(env['PHRASLY_EXTENSION_PACKAGE_PATH']);previous=sha(active);assert previous=='07fb62c132bca769a1b4adc5aec4731ba5f312abbe07b022ce5bb1cbd0f5f3b3'
backup=root/'previous-package.zip';shutil.copy2(active,backup);backup.chmod(0o600);before=processes()
actor=json.loads(Path('/home/ubuntu/state/phrasly-launch-test-20261029/test-user.private.json').read_text());publishable=actor['publishable'];token=None;switched=False
try:
 code,raw=req(actor['api']+'/auth/v1/token?grant_type=password',{'email':actor['user']['email'],'password':actor['password']},{'apikey':publishable});assert code==200
 session=json.loads(raw);token=session['access_token']
 incoming=active.with_name(active.name+'.incoming-cookie-fix');shutil.copyfile(package,incoming);incoming.chmod(0o600);assert sha(incoming)==sha(package);assert sha(active)==previous;os.replace(incoming,active);switched=True
 code,download=req('https://topratedseotools.com/ext-package',{}, {'Authorization':'Bearer '+token});assert code==200 and hashlib.sha256(download).hexdigest()==sha(package)
 try:req('https://topratedseotools.com/ext-package',{});raise AssertionError('anonymous download permitted')
 except urllib.error.HTTPError as error:assert error.code==401
 assert processes()==before
 report={'status':'LIVE','utc':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'version':'1.0.2','sha256':sha(package),'previous_sha256':previous,'existing_processes_unchanged':len(before),'authorized_download_verified':True,'anonymous_download_denied':True,'extension_identity_unchanged':True,'extension_permissions_unchanged':True,'provider_network_requests':0,'installed_browsers_require_extension_update':True}
 (root/'activation-evidence.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
except Exception:
 if switched:
  shutil.copyfile(backup,active.with_name(active.name+'.rollback'));os.replace(active.with_name(active.name+'.rollback'),active)
 raise
finally:
 if token:req(actor['api']+'/auth/v1/logout?scope=local',{}, {'apikey':publishable,'Authorization':'Bearer '+token})
