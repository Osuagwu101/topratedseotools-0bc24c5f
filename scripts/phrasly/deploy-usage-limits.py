"""Stage/activate only Phrasly endpoints and their Admin/writer entry assets on OVH."""
import pathlib,json,subprocess,hashlib,urllib.request,urllib.error,time,socket,sys
root=pathlib.Path('/home/ubuntu/releases/trst-phrasly-limits-20261028')
old=pathlib.Path('/home/ubuntu/releases/trst-phrasly-native-20261026')
public=pathlib.Path('/var/www/trst-phrasly-entry-20261026')
nginx=pathlib.Path('/etc/nginx/sites-enabled/topratedseotools')
name='trst-phrasly-limits-oct28';manifest=json.loads((root/'manifest.json').read_text())
assert manifest['source_commit']==sys.argv[2]
def run(args):return subprocess.run(args,check=True,capture_output=True,text=True,timeout=40).stdout
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def processes():return {p['name']:{'pid':p['pid'],'status':p['pm2_env']['status'],'restarts':p['pm2_env']['restart_time']} for p in json.loads(run(['pm2','jlist']))}
def request(route,port=None):
 url=('http://127.0.0.1:'+str(port) if port else 'https://topratedseotools.com')+route
 try:
  with urllib.request.urlopen(urllib.request.Request(url,headers={'Host':'topratedseotools.com'}),timeout=20) as r:return r.status,r.read()
 except urllib.error.HTTPError as e:return e.code,e.read()
def unchanged(before):
 after=processes();assert all(after.get(k)==v for k,v in before.items()),'existing service changed'
for file,digest in manifest['assets'].items():assert sha(root/'assets'/file)==digest
if sys.argv[1]=='stage':
 assert name not in processes(),'candidate already exists'
 settings=json.loads((old/'settings.private.json').read_text());settings['PORT']='3340';settings['HOST']='127.0.0.1'
 for key in ['SUPABASE_SERVICE_ROLE_KEY','PHRASLY_SESSION_ENCRYPTION_KEY','PHRASLY_AWS_EXTENSION_GATE_SECRET']:
  secret=settings[key].encode();assert len(secret)>=16
  for p in (root/'.output').rglob('*'):
   if p.is_file():assert secret not in p.read_bytes(),'operational secret in artifact'
 before=processes();(root/'processes-before.json').write_text(json.dumps(before))
 (root/'settings.private.json').write_text(json.dumps(settings));(root/'settings.private.json').chmod(0o600)
 (root/'run-phrasly.mjs').write_bytes((old/'run-phrasly.mjs').read_bytes())
 (root/'ecosystem.config.cjs').write_text('module.exports='+json.dumps({'apps':[{'name':name,'script':str(root/'run-phrasly.mjs'),'cwd':str(root),'interpreter':'node','autorestart':True,'max_restarts':10,'exp_backoff_restart_delay':1000,'time':True}]})+';\n')
 sock=socket.socket();sock.bind(('127.0.0.1',3340));sock.close()
 run(['pm2','start',str(root/'ecosystem.config.cjs')])
 for _ in range(50):
  try:
   if request('/ext-whoami.php',3340)[0]==200:break
  except OSError:pass
  time.sleep(.3)
 for route,status in [('/ext-admin',401),('/ext-status',401),('/admin/phrasly',200)]:assert request(route,3340)[0]==status,(route,status)
 unchanged(before);print(json.dumps({'status':'STAGED','port':3340,'existing_processes_unchanged':True,'source_commit':manifest['source_commit']}))
elif sys.argv[1]=='activate':
 before=json.loads((root/'processes-before.json').read_text());unchanged(before)
 original=nginx.read_text();start=original.index('    # BEGIN Phrasly AWS in-house release');end=original.index('    # END Phrasly AWS in-house release',start)
 block=original[start:end];assert block.count('127.0.0.1:3339')==12
 proposed=original[:start]+block.replace('127.0.0.1:3339','127.0.0.1:3340')+original[end:]
 assert sha(public/'admin.js')=='ec947e03d96182121ae44bbe354cd994959582436ecf7b4f65ac45d90f124b00'
 assert sha(public/'writer.js')=='427047f4c32d0e6356654c2cfeb34936d5380e64dfc2ce8468339454d0445b12'
 backup=root/'rollback';backup.mkdir(mode=0o700,exist_ok=False)
 (backup/'nginx.conf').write_text(original);(root/'nginx-proposed.conf').write_text(proposed)
 baseline={p.name:sha(p) for p in public.iterdir() if p.is_file()}
 for file in ['admin.js','writer.js']:(backup/file).write_bytes((public/file).read_bytes())
 (backup/'public-before.json').write_text(json.dumps(baseline))
 switched=False
 try:
  for file in manifest['assets']:
   run(['sudo','install','-m','644',str(root/'assets'/file),str(public/('.'+file+'.incoming'))]);run(['sudo','mv',str(public/('.'+file+'.incoming')),str(public/file)])
  assert nginx.read_text()==original,'nginx changed concurrently'
  run(['sudo','cp',str(root/'nginx-proposed.conf'),str(nginx)]);switched=True
  run(['sudo','nginx','-t']);run(['sudo','systemctl','reload','nginx'])
  for file,digest in manifest['assets'].items():assert hashlib.sha256(request('/phrasly-assets/'+file)[1]).hexdigest()==digest
  for route,status in [('/ext-admin',401),('/ext-status',401),('/admin/phrasly',200),('/tools/phrasly',200),('/',200),('/login',200),('/admin',200),('/tools/chatgpt',200),('/tools/stealthwriter',200),('/turnitin',200)]:assert request(route)[0]==status,route
  assert all(sha(public/file)==digest for file,digest in baseline.items() if file not in ['admin.js','writer.js']),'unrelated asset changed'
  unchanged(before);run(['pm2','save'])
  evidence={'status':'LIVE','utc':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'source_commit':manifest['source_commit'],'assets':manifest['assets'],'existing_processes_unchanged':True,'existing_process_count':len(before),'unrelated_public_assets_unchanged':True,'writer_extension_unchanged':True,'private_endpoints_require_login':True}
  (root/'activation-evidence.json').write_text(json.dumps(evidence,indent=2));print(json.dumps(evidence))
 except Exception:
  if switched:run(['sudo','cp',str(backup/'nginx.conf'),str(nginx)]);run(['sudo','nginx','-t']);run(['sudo','systemctl','reload','nginx'])
  for file in ['admin.js','writer.js']:run(['sudo','install','-m','644',str(backup/file),str(public/file)])
  run(['pm2','stop',name]);run(['pm2','save']);raise
else:raise SystemExit('Use stage or activate')
