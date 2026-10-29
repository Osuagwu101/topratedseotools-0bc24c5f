"""Stage a guarded Phrasly-only runtime repair; preserve installed writer assets."""
import pathlib,json,subprocess,hashlib,urllib.request,urllib.error,time,shutil,sys,re
repo=pathlib.Path(__file__).resolve().parents[2]
old=pathlib.Path('/home/ubuntu/releases/trst-phrasly-session-paste-20261029')
root=pathlib.Path('/home/ubuntu/releases/trst-phrasly-import-validation-20261029')
public=pathlib.Path('/var/www/trst-phrasly-entry-20261026')
nginx=pathlib.Path('/etc/nginx/sites-enabled/topratedseotools')
name='trst-phrasly-import-validation-oct29'
def run(args,**kwargs):return subprocess.run(args,cwd=repo,check=True,capture_output=True,text=True,timeout=60,**kwargs).stdout
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def processes():return {p['name']:{'pid':p['pid'],'status':p['pm2_env']['status'],'restarts':p['pm2_env']['restart_time']} for p in json.loads(run(['pm2','jlist']))}
def request(path,port=None):
 url=('http://127.0.0.1:'+str(port) if port else 'https://topratedseotools.com')+path
 try:
  with urllib.request.urlopen(urllib.request.Request(url,headers={'Host':'topratedseotools.com'}),timeout=20) as r:return r.status,r.read()
 except urllib.error.HTTPError as e:return e.code,e.read()
def compile_function(file,func):
 js="const fs=require('fs'),ts=require('typescript');const text=fs.readFileSync(process.argv[1],'utf8'),s=ts.createSourceFile('input.ts',text,ts.ScriptTarget.Latest,true);const f=s.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name.text===process.argv[2]);if(!f)throw Error('function missing');process.stdout.write(ts.transpileModule(f.getText(s),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replace(/^export /,''));"
 return run(['node','-e',js,str(file),func])
def replace_function(text,func,replacement):
 js="const fs=require('fs'),ts=require('typescript'),text=fs.readFileSync(0,'utf8'),s=ts.createSourceFile('runtime.js',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);const f=s.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name.text===process.argv[1]);if(!f)throw Error('runtime function missing');process.stdout.write(JSON.stringify([f.getStart(s),f.end]));"
 start,end=json.loads(run(['node','-e',js,func],input=text));return text[:start]+replacement+text[end:]
if sys.argv[1]=='stage':
 assert not root.exists() and name not in processes()
 root.mkdir(mode=0o700);shutil.copytree(old/'.output',root/'.output')
 before=processes();(root/'processes-before.json').write_text(json.dumps(before))
 settings=json.loads((old/'settings.private.json').read_text());settings['PORT']='3342';settings['HOST']='127.0.0.1'
 (root/'settings.private.json').write_text(json.dumps(settings));(root/'settings.private.json').chmod(0o600)
 shutil.copy2(old/'run-phrasly.mjs',root/'run-phrasly.mjs')
 router=next(p for p in (root/'.output/server/_ssr').glob('router-*.mjs') if 'async function adminChange(request)' in p.read_text())
 original=router.read_text();s=replace_function(original,'adminChange',compile_function(repo/'src/lib/phrasly-extension/release.server.ts','adminChange'))
 s=replace_function(s,'workspacePage',compile_function(repo/'src/lib/phrasly-extension/release.server.ts','workspacePage').replace('admin-session-paste-20261029','admin-import-validation-20261029'))
 s=replace_function(s,'parsePhraslySessionInput',compile_function(repo/'src/lib/phrasly-extension/session-input.ts','parsePhraslySessionInput'))
 assert 'admin-import-validation-20261029' in s
 router.write_text(s);run(['node','--check',str(router)])
 assets=repo/'public/phrasly-assets';entry=assets/'admin.js'
 dependencies=re.findall(r'from\s+[\"\']\./([^\"\']+\.js)[\"\']',entry.read_text());assert len(dependencies)==1
 files={'admin-import-validation-20261029.js':entry,'Osuagwu-Solomon-TopRated.zip':assets/'Osuagwu-Solomon-TopRated.zip',**{f:assets/f for f in dependencies}}
 (root/'assets').mkdir()
 for dest,source in files.items():shutil.copy2(source,root/'assets'/dest)
 manifest={'source_commit':run(['git','rev-parse','HEAD']).strip(),'runtime_before_sha256':hashlib.sha256(original.encode()).hexdigest(),'runtime_after_sha256':sha(router),'assets':{f:sha(root/'assets'/f) for f in files}}
 (root/'manifest.json').write_text(json.dumps(manifest,indent=2))
 for key in ['SUPABASE_SERVICE_ROLE_KEY','PHRASLY_SESSION_ENCRYPTION_KEY','PHRASLY_AWS_EXTENSION_GATE_SECRET']:
  secret=settings[key].encode();assert len(secret)>=16
  assert all(secret not in p.read_bytes() for p in (root/'assets').iterdir())
 config={'apps':[{'name':name,'script':str(root/'run-phrasly.mjs'),'cwd':str(root),'interpreter':'node','autorestart':True,'max_restarts':10,'exp_backoff_restart_delay':1000,'time':True}]}
 (root/'ecosystem.config.cjs').write_text('module.exports='+json.dumps(config)+';\n')
 run(['pm2','start',str(root/'ecosystem.config.cjs')])
 for _ in range(30):
  try:
   if request('/ext-whoami.php',3342)[0]==200:break
  except OSError:pass
  time.sleep(.3)
 for route,status in [('/ext-admin',401),('/ext-status',401),('/admin/phrasly',200)]:assert request(route,3342)[0]==status,route
 assert b'admin-import-validation-20261029.js' in request('/admin/phrasly',3342)[1]
 assert all(processes().get(k)==v for k,v in before.items())
 print(json.dumps({'status':'STAGED','port':3342,'existing_processes_unchanged':True,**manifest}))
elif sys.argv[1]=='activate':
 manifest=json.loads((root/'manifest.json').read_text());before=json.loads((root/'processes-before.json').read_text());assert all(processes().get(k)==v for k,v in before.items())
 original=nginx.read_text();start=original.index('    # BEGIN Phrasly AWS in-house release');end=original.index('    # END Phrasly AWS in-house release',start)
 block=original[start:end];assert block.count('127.0.0.1:3341')==11
 proposed=original[:start]+block.replace('127.0.0.1:3341','127.0.0.1:3342')+original[end:]
 backup=root/'rollback';backup.mkdir(mode=0o700);(backup/'nginx.conf').write_text(original);(root/'nginx-proposed.conf').write_text(proposed)
 baseline={p.name:sha(p) for p in public.iterdir() if p.is_file()};(backup/'public-before.json').write_text(json.dumps(baseline))
 switched=False
 try:
  for file,digest in manifest['assets'].items():
   assert sha(root/'assets'/file)==digest
   assert file=='Osuagwu-Solomon-TopRated.zip' or not (public/file).exists() or sha(public/file)==digest
   if (public/file).exists():shutil.copy2(public/file,backup/file)
   run(['sudo','install','-m','644',str(root/'assets'/file),str(public/file)])
  assert nginx.read_text()==original
  run(['sudo','cp',str(root/'nginx-proposed.conf'),str(nginx)]);switched=True
  run(['sudo','nginx','-t']);run(['sudo','systemctl','reload','nginx'])
  for file,digest in manifest['assets'].items():assert hashlib.sha256(request('/phrasly-assets/'+file)[1]).hexdigest()==digest
  for route,status in [('/ext-admin',401),('/ext-status',401),('/admin/phrasly',200),('/tools/phrasly',200),('/',200),('/login',200),('/admin',200),('/tools/stealthwriter',200),('/turnitin',200)]:assert request(route)[0]==status,route
  assert b'admin-import-validation-20261029.js' in request('/admin/phrasly')[1]
  assert all(sha(public/file)==digest for file,digest in baseline.items() if file!='Osuagwu-Solomon-TopRated.zip')
  assert all(processes().get(k)==v for k,v in before.items());run(['pm2','save'])
  evidence={'status':'LIVE','utc':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),**manifest,'existing_processes_unchanged':len(before),'existing_public_assets_unchanged':True,'private_endpoints_require_login':True}
  (root/'activation-evidence.json').write_text(json.dumps(evidence,indent=2));print(json.dumps(evidence))
 except Exception:
  if switched:
   for file in manifest['assets']:
    if (backup/file).exists():run(['sudo','install','-m','644',str(backup/file),str(public/file)])
   run(['sudo','cp',str(backup/'nginx.conf'),str(nginx)]);run(['sudo','nginx','-t']);run(['sudo','systemctl','reload','nginx'])
  raise
else:raise SystemExit('Use stage or activate')
