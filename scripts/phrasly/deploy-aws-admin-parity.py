"""Stage and activate the isolated AWS Admin parity build with rollback."""
import pathlib,json,hashlib,subprocess,urllib.request,urllib.error,time,socket,sys
root=pathlib.Path("/home/ubuntu/releases/trst-phrasly-aws-parity-20261029")
old=pathlib.Path("/home/ubuntu/releases/trst-phrasly-import-validation-20261029")
public=pathlib.Path("/var/www/trst-phrasly-entry-20261026")
nginx=pathlib.Path("/etc/nginx/sites-enabled/topratedseotools")
name="trst-phrasly-aws-parity-oct29";port=3343
manifest=json.loads((root/"manifest.json").read_text())
def run(args):return subprocess.run(args,check=True,capture_output=True,text=True,timeout=40).stdout
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def procs():return {x["name"]:{"pid":x["pid"],"status":x["pm2_env"]["status"],"restarts":x["pm2_env"]["restart_time"]} for x in json.loads(run(["pm2","jlist"]))}
def request(route,local=False,token=None,body=None):
 url=("http://127.0.0.1:"+str(port) if local else "https://topratedseotools.com")+route
 headers={"Host":"topratedseotools.com",**({"Authorization":"Bearer "+token} if token else {}),**({"Content-Type":"application/json"} if body else {})}
 try:
  with urllib.request.urlopen(urllib.request.Request(url,headers=headers,data=json.dumps(body).encode() if body else None),timeout=25) as r:return r.status,r.read()
 except urllib.error.HTTPError as e:return e.code,e.read()
def unchanged(before):
 after=procs()
 assert all(after.get(k)==v for k,v in before.items()),"existing process changed"
for file,digest in manifest["assets"].items():assert sha(root/"assets"/file)==digest
if sys.argv[1]=="stage":
 assert name not in procs()
 sock=socket.socket();sock.bind(("127.0.0.1",port));sock.close()
 before=procs();(root/"processes-before.json").write_text(json.dumps(before))
 settings=json.loads((old/"settings.private.json").read_text());settings["PORT"]=str(port);settings["HOST"]="127.0.0.1"
 for key in ["SUPABASE_SERVICE_ROLE_KEY","PHRASLY_SESSION_ENCRYPTION_KEY","PHRASLY_AWS_EXTENSION_GATE_SECRET"]:
  secret=settings[key].encode();assert len(secret)>15
  for p in (root/"assets").iterdir():assert secret not in p.read_bytes(),"secret in public asset"
 (root/"settings.private.json").write_text(json.dumps(settings));(root/"settings.private.json").chmod(0o600)
 (root/"run-phrasly.mjs").write_bytes((old/"run-phrasly.mjs").read_bytes())
 (root/"ecosystem.config.cjs").write_text("module.exports="+json.dumps({"apps":[{"name":name,"script":str(root/"run-phrasly.mjs"),"cwd":str(root),"interpreter":"node","autorestart":True,"max_restarts":10,"time":True}]})+";")
 run(["pm2","start",str(root/"ecosystem.config.cjs")])
 for _ in range(50):
  try:
   if request("/ext-admin",True)[0]==401:break
  except OSError:pass
  time.sleep(.2)
 assert request("/ext-admin",True)[0]==401
 assert b"admin-aws-parity-20261029.js" in request("/admin/phrasly",True)[1]
 status,body=request("/ext-admin",True,VERIFY_TOKEN);assert status==200
 state=json.loads(body);assert state["accounts"] and all("used" in a for a in state["accounts"])
 assert "encrypted_cookies" not in body.decode()
 # Invalid URL must be rejected before any account change.
 a=state["accounts"][0]
 bad={"action":"save_account","account_id":a["id"],"label":a["label"],"capacity":a["capacity"],"enabled":a["enabled"],"target_url":"https://evil.test","cookies":""}
 assert request("/ext-admin",True,VERIFY_TOKEN,bad)[0]==400
 unchanged(before)
 print(json.dumps({"status":"STAGED","port":port,"source_commit":manifest["source_commit"],"authorized_admin_state":True,"account_usage_counts":True,"invalid_url_rejected":True,"existing_services_unchanged":True}))
elif sys.argv[1]=="activate":
 before=json.loads((root/"processes-before.json").read_text());unchanged(before)
 original=nginx.read_text();start=original.index("    # BEGIN Phrasly AWS in-house release");end=original.index("    # END Phrasly AWS in-house release",start)
 block=original[start:end];assert block.count("127.0.0.1:3342")==11
 proposed=original[:start]+block.replace("127.0.0.1:3342","127.0.0.1:"+str(port))+original[end:]
 needle='<script defer src="/phrasly-assets/customer-tools-summary-v1.js"></script>'
 assert proposed.count(needle)==2
 proposed=proposed.replace(needle,needle+'<script defer src="/phrasly-assets/cookie-tools-navigation-20261029.js"></script>')
 backup=root/"rollback";backup.mkdir(mode=0o700,exist_ok=False)
 (backup/"nginx.conf").write_text(original);(root/"nginx-proposed.conf").write_text(proposed)
 baseline={p.name:sha(p) for p in public.iterdir() if p.is_file()}
 assert (root/"assets/workspace.css").read_bytes().startswith((public/"workspace.css").read_bytes()),"base stylesheet changed"
 for file in manifest["assets"]:
  if (public/file).exists():(backup/file).write_bytes((public/file).read_bytes())
 switched=False
 try:
  for file in manifest["assets"]:
   run(["sudo","install","-m","644",str(root/"assets"/file),str(public/("."+file+".incoming"))]);run(["sudo","mv",str(public/("."+file+".incoming")),str(public/file)])
  assert nginx.read_text()==original,"nginx changed concurrently"
  run(["sudo","cp",str(root/"nginx-proposed.conf"),str(nginx)]);switched=True
  run(["sudo","nginx","-t"]);run(["sudo","systemctl","reload","nginx"])
  for file,digest in manifest["assets"].items():
   status,body=request("/phrasly-assets/"+file);assert status==200 and hashlib.sha256(body).hexdigest()==digest,file
  for route,status in [("/ext-admin",401),("/ext-status",401),("/admin/phrasly",200),("/",200),("/login",200),("/admin",200),("/turnitin",200),("/tools/stealthwriter",200)]:
   assert request(route)[0]==status,route
  assert request("/ext-admin",token=VERIFY_TOKEN)[0]==200
  for file,digest in baseline.items():
   if file not in manifest["assets"]:assert sha(public/file)==digest,"unrelated asset changed"
  unchanged(before);run(["pm2","save"])
  evidence={"status":"LIVE","source_commit":manifest["source_commit"],"utc":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),"assets":manifest["assets"],"nginx_validated":True,"existing_processes_unchanged":True,"financial_mutations":False,"schema_changes":False}
  (root/"activation-evidence.json").write_text(json.dumps(evidence,indent=2));print(json.dumps(evidence))
 except Exception:
  if switched:
   run(["sudo","cp",str(backup/"nginx.conf"),str(nginx)]);run(["sudo","nginx","-t"]);run(["sudo","systemctl","reload","nginx"])
  for file in manifest["assets"]:
   if (backup/file).exists():run(["sudo","install","-m","644",str(backup/file),str(public/file)])
  run(["pm2","stop",name]);raise
else:raise SystemExit("stage or activate")
