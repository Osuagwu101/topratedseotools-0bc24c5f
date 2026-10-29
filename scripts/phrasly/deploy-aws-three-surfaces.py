"""Stage and publish the original AWS extensions and source-rendered Cookie-Based Tools page."""
import pathlib,json,hashlib,subprocess,socket,time,urllib.request,urllib.error,zipfile,sys
root=pathlib.Path("/home/ubuntu/releases/trst-phrasly-aws-three-surfaces-20261029")
old=pathlib.Path("/home/ubuntu/releases/trst-phrasly-aws-exact-20261029")
public=pathlib.Path("/var/www/trst-phrasly-entry-20261026")
nginx=pathlib.Path("/etc/nginx/sites-enabled/topratedseotools")
name="trst-phrasly-aws-three-surfaces-oct29";port=3345
manifest=json.loads((root/"manifest.json").read_text())
def run(args):return subprocess.run(args,check=True,capture_output=True,text=True,timeout=40).stdout
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def processes():return {p["name"]:{"pid":p["pid"],"status":p["pm2_env"]["status"],"restarts":p["pm2_env"]["restart_time"]} for p in json.loads(run(["pm2","jlist"]))}
def request(route,local=False,token=None):
 url=("http://127.0.0.1:"+str(port) if local else "https://topratedseotools.com")+route
 try:
  with urllib.request.urlopen(urllib.request.Request(url,headers={"Host":"topratedseotools.com",**({"Authorization":"Bearer "+token} if token else {})}),timeout=25) as r:return r.status,r.read()
 except urllib.error.HTTPError as e:return e.code,e.read()
def unchanged(before):assert all(processes().get(k)==v for k,v in before.items()),"existing process changed"
for file,digest in manifest["assets"].items():assert sha(root/"assets"/file)==digest,file
assert sha(root/"TopRated-Phrasly-Access.zip")==manifest["writer_sha256"]
with zipfile.ZipFile(root/"TopRated-Phrasly-Access.zip") as z:
 assert len([i for i in z.infolist() if not i.is_dir()])==12
 assert not any(pathlib.PurePosixPath(n.replace(chr(92),"/")).name in ["config.js","BUILD-MANIFEST.json"] for n in z.namelist())
if sys.argv[1]=="stage":
 assert name not in processes()
 sock=socket.socket();sock.bind(("127.0.0.1",port));sock.close()
 before=processes();(root/"processes-before.json").write_text(json.dumps(before))
 settings=json.loads((old/"settings.private.json").read_text());settings.update({"PORT":str(port),"HOST":"127.0.0.1","PHRASLY_EXTENSION_PACKAGE_PATH":str(root/"TopRated-Phrasly-Access.zip")})
 (root/"settings.private.json").write_text(json.dumps(settings));(root/"settings.private.json").chmod(0o600)
 (root/"run-phrasly.mjs").write_bytes((old/"run-phrasly.mjs").read_bytes())
 for key in ["SUPABASE_SERVICE_ROLE_KEY","PHRASLY_SESSION_ENCRYPTION_KEY","PHRASLY_AWS_EXTENSION_GATE_SECRET"]:
  secret=settings[key].encode()
  for p in (root/"assets").rglob("*"):
   if p.is_file():assert secret not in p.read_bytes(),"operational secret in public asset"
 (root/"ecosystem.config.cjs").write_text("module.exports="+json.dumps({"apps":[{"name":name,"script":str(root/"run-phrasly.mjs"),"cwd":str(root),"interpreter":"node","autorestart":True,"max_restarts":10,"time":True}]})+";")
 run(["pm2","start",str(root/"ecosystem.config.cjs")])
 for _ in range(50):
  try:
   if request("/ext-admin?interface=aws",True)[0]==401:break
  except OSError:pass
  time.sleep(.2)
 assert request("/ext-admin?interface=aws",True)[0]==401
 status,html=request("/admin/phrasly",True);assert status==200 and b"aws-cookie-tools-20261029.js" in html and b"oc-theme-toggle" in html
 unchanged(before)
 print(json.dumps({"status":"STAGED","port":port,"original_interface":True,"private_api_requires_login":True,"source_commit":manifest["source_commit"]}))
elif sys.argv[1]=="activate":
 before=json.loads((root/"processes-before.json").read_text());unchanged(before)
 original=nginx.read_text();start=original.index("    # BEGIN Phrasly AWS in-house release");end=original.index("    # END Phrasly AWS in-house release",start)
 block=original[start:end];assert block.count("127.0.0.1:3344")==11
 newblock=block.replace("127.0.0.1:3344","127.0.0.1:"+str(port))
 assert 'types { application/javascript js; text/css css; }' in newblock
 newblock=newblock.replace('types { application/javascript js; text/css css; }','types { application/javascript js; text/css css; image/webp webp; image/png png; image/x-icon ico; }')
 proposed=original[:start]+newblock+original[end:]
 if "location = /login.php" not in proposed:
  marker="    # BEGIN Phrasly AWS in-house release 20261026"
  proposed=proposed.replace(marker,marker+"\n    location = /login.php { return 302 /login; }\n    location = /dashboard.php { return 302 /dashboard; }",1)
 backup=root/"rollback-three-surfaces";backup.mkdir(mode=0o700,exist_ok=False)
 (backup/"nginx.conf").write_text(original);(root/"nginx-proposed.conf").write_text(proposed)
 baseline={p.relative_to(public).as_posix():sha(p) for p in public.rglob("*") if p.is_file()}
 (backup/"public-before.json").write_text(json.dumps(baseline))
 for file in manifest["assets"]:
  if (public/file).exists():
   p=backup/"assets"/file;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes((public/file).read_bytes())
 changed=False
 try:
  for file in manifest["assets"]:
   incoming=public/pathlib.Path(file).parent/("."+pathlib.Path(file).name+".incoming")
   run(["sudo","install","-D","-m","644",str(root/"assets"/file),str(incoming)]);run(["sudo","mv",str(incoming),str(public/file)])
  assert nginx.read_text()==original
  run(["sudo","cp",str(root/"nginx-proposed.conf"),str(nginx)]);changed=True
  run(["sudo","nginx","-t"]);run(["sudo","systemctl","reload","nginx"])
  for file,digest in manifest["assets"].items():
   status,body=request("/phrasly-assets/"+file);assert status==200 and hashlib.sha256(body).hexdigest()==digest,file
  for route,status in [("/admin/phrasly",200),("/phrasly",200),("/ext-admin",401),("/ext-admin?interface=aws",401),("/ext-status",401),("/",200),("/login",200),("/admin",200),("/turnitin",200),("/tools/stealthwriter",200)]:
   assert request(route)[0]==status,route
  assert b"aws-cookie-tools-20261029.js" in request("/admin/phrasly")[1]
  for file,digest in baseline.items():
   if file not in manifest["assets"]:assert sha(public/file)==digest,"unrelated public asset changed"
  unchanged(before);run(["pm2","save"])
  evidence={"status":"LIVE","source_commit":manifest["source_commit"],"writer_files":12,"admin_files":4,"extension_change_scope":"domain replacements only","original_interface_templates":6,"assets":manifest["assets"],"writer_sha256":manifest["writer_sha256"],"existing_application_processes_unchanged":True,"production_account_mutations":False,"financial_mutations":False,"schema_changes":False}
  (root/"activation-evidence.json").write_text(json.dumps(evidence,indent=2));print(json.dumps(evidence))
 except Exception:
  if changed:run(["sudo","cp",str(backup/"nginx.conf"),str(nginx)]);run(["sudo","nginx","-t"]);run(["sudo","systemctl","reload","nginx"])
  for file in manifest["assets"]:
   if (backup/"assets"/file).exists():run(["sudo","install","-D","-m","644",str(backup/"assets"/file),str(public/file)])
  run(["pm2","stop",name]);raise
else:raise SystemExit("stage or activate")
