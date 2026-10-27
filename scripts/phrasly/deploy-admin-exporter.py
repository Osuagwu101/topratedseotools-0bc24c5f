"""Activate only the Admin receiver and public exporter ZIP; preserve all writer assets."""
import pathlib,json,hashlib,subprocess,urllib.request,urllib.error,re,sys,time
stage=pathlib.Path(sys.argv[1]);expected=sys.argv[2]
public=pathlib.Path("/var/www/trst-phrasly-entry-20261026")
backup=pathlib.Path("/home/ubuntu/backups/phrasly-admin-exporter-20261027")
manifest=json.loads((stage/"manifest.json").read_text())
assert manifest["source_commit"]==expected
allowed={"admin.js","Osuagwu-Solomon-TopRated.zip"}
assert set(manifest["files"])==allowed
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def run(args):return subprocess.run(args,check=True,capture_output=True,text=True,timeout=30).stdout
def processes():
 return {p["name"]:{"pid":p["pid"],"status":p["pm2_env"]["status"],"restarts":p["pm2_env"]["restart_time"]} for p in json.loads(run(["pm2","jlist"]))}
def request(route):
 try:
  with urllib.request.urlopen("https://topratedseotools.com"+route,timeout=20) as response:return response.status,response.read()
 except urllib.error.HTTPError as e:return e.code,e.read()
for name,digest in manifest["files"].items():assert sha(stage/name)==digest
for name,digest in manifest["required_assets"].items():assert sha(public/name)==digest,"shared dependency mismatch"
assert sha(public/"admin.js")==manifest["previous_admin_sha256"],"Admin asset changed concurrently"
assert not (public/"Osuagwu-Solomon-TopRated.zip").exists(),"exporter already exists"
settings=json.loads(pathlib.Path("/home/ubuntu/releases/trst-phrasly-native-20261026/settings.private.json").read_text())
for key in ["SUPABASE_SERVICE_ROLE_KEY","PHRASLY_SESSION_ENCRYPTION_KEY","PHRASLY_AWS_EXTENSION_GATE_SECRET"]:
 secret=settings.get(key,"").encode()
 assert len(secret)>=16
 assert all(secret not in (stage/name).read_bytes() for name in allowed),"private value in public file"
writer_package=pathlib.Path(settings["PHRASLY_EXTENSION_PACKAGE_PATH"])
writer_sha=sha(writer_package)
assert writer_sha=="07fb62c132bca769a1b4adc5aec4731ba5f312abbe07b022ce5bb1cbd0f5f3b3"
before=processes()
asset_before={p.name:sha(p) for p in public.iterdir() if p.is_file()}
assert request("/ext-admin")[0]==401 and request("/ext-status")[0]==401
backup.mkdir(mode=0o700,parents=True,exist_ok=False)
(backup/"admin.js").write_bytes((public/"admin.js").read_bytes())
(backup/"baseline.json").write_text(json.dumps({"processes":before,"assets":asset_before,"writer_zip_sha256":writer_sha}))
for p in backup.iterdir():p.chmod(0o600)
activated=False
try:
 for name in ["Osuagwu-Solomon-TopRated.zip","admin.js"]:
  assert sha(stage/name)==manifest["files"][name]
  run(["sudo","install","-m","644",str(stage/name),str(public/("."+name+".incoming"))])
  run(["sudo","mv",str(public/("."+name+".incoming")),str(public/name)])
  if name=="admin.js":activated=True
 for name,digest in manifest["files"].items():
  code,body=request("/phrasly-assets/"+name)
  assert code==200 and hashlib.sha256(body).hexdigest()==digest,"public asset mismatch"
 assert all(sha(public/name)==digest for name,digest in asset_before.items() if name!="admin.js"),"writer/public dependency changed"
 assert processes()==before,"application process changed"
 assert sha(writer_package)==writer_sha,"writer extension changed"
 assert request("/ext-admin")[0]==401 and request("/ext-status")[0]==401
 for route in ["/","/login","/tools/phrasly","/admin/phrasly"]:assert request(route)[0]==200
 evidence={"status":"LIVE","utc":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),**manifest,"other_public_assets_unchanged":True,"all_application_processes_unchanged":True,"process_count":len(before),"writer_extension_sha256":writer_sha,"private_api_authentication_preserved":True,"backup":str(backup)}
 (stage/"activation-evidence.json").write_text(json.dumps(evidence,indent=2));(stage/"activation-evidence.json").chmod(0o600)
 print(json.dumps(evidence))
except Exception:
 if activated:
  run(["sudo","install","-m","644",str(backup/"admin.js"),str(public/"admin.js")])
 if (public/"Osuagwu-Solomon-TopRated.zip").exists():
  run(["sudo","rm","--",str(public/"Osuagwu-Solomon-TopRated.zip")])
 raise
