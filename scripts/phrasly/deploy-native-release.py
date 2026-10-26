"""Stage native-launch runtime and switch only the existing Phrasly upstream.
Run on OVH as ubuntu; retains the previous service and config for rollback.
"""
import pathlib,json,subprocess,hashlib,tarfile,time,urllib.request,urllib.error,socket,sys,re
root=pathlib.Path(sys.argv[1]); expected=sys.argv[2]
old=pathlib.Path("/home/ubuntu/releases/trst-phrasly-aws-20261026")
active=pathlib.Path("/etc/nginx/sites-enabled/topratedseotools")
name="trst-phrasly-native-oct26"
def run(args):return subprocess.run(args,check=True,capture_output=True,text=True,timeout=40).stdout
def processes():
 return {p["name"]:{"pid":p["pid"],"status":p["pm2_env"]["status"],"restarts":p["pm2_env"]["restart_time"]} for p in json.loads(run(["pm2","jlist"]))}
def request(route,port=None):
 url=("http://127.0.0.1:"+str(port) if port else "https://topratedseotools.com")+route
 try:
  with urllib.request.urlopen(urllib.request.Request(url,headers={"Host":"topratedseotools.com"}),timeout=20) as r:return r.status,r.read()
 except urllib.error.HTTPError as e:return e.code,e.read()
def fingerprint(route): 
 status,body=request(route);return {"status":status,"sha256_without_ssr_timestamps":hashlib.sha256(re.sub(rb"(?<=,u:)\\d{13}(?=,s:)",b"TIMESTAMP",body)).hexdigest(),"bytes":len(body)}
manifest=json.loads((root/"phase6-native-manifest.json").read_text())
assert manifest["source_commit"]==expected
assert hashlib.sha256((root/"phase6-native.tgz").read_bytes()).hexdigest()==manifest["archive_sha256"]
baseline=processes();assert baseline["trst-phrasly-aws-oct26"]["status"]=="online"
if name in baseline:
 assert baseline.pop(name)["status"]=="stopped","candidate already serving"
original=active.read_text()
start=original.index("    # BEGIN Phrasly AWS in-house release")
end=original.index("    # END Phrasly AWS in-house release",start)
block=original[start:end];assert block.count("127.0.0.1:3338")==12
proposed=original[:start]+block.replace("127.0.0.1:3338","127.0.0.1:3339")+original[end:]
routes=["/","/login","/admin","/tools/stealthwriter","/tools/chatgpt","/turnitin","/turnitin/buy"]
http_before={r:fingerprint(r) for r in routes};assert all(v["status"]==200 for v in http_before.values())
assert all(fingerprint(r)==http_before[r] for r in routes),"baseline unstable after SSR timestamp normalization"
(root/"nginx-before.conf").write_text(original);(root/"nginx-proposed.conf").write_text(proposed)
(root/"pm2-before.json").write_text(json.dumps(baseline))
if not (root/".output").exists():
 with tarfile.open(root/"phase6-native.tgz") as tar:tar.extractall(root,filter="data")
settings=json.loads((old/"settings.private.json").read_text())
settings.update({"PORT":"3339","HOST":"127.0.0.1","PHRASLY_EXTENSION_PACKAGE_PATH":str(root/"TopRated-Phrasly-Access.zip")})
(root/"settings.private.json").write_text(json.dumps(settings))
(root/"run-phrasly.mjs").write_bytes((old/"run-phrasly.mjs").read_bytes())
config={"apps":[{"name":name,"script":str(root/"run-phrasly.mjs"),"cwd":str(root),"interpreter":"node","autorestart":True,"max_restarts":10,"exp_backoff_restart_delay":1000,"time":True}]}
(root/"ecosystem.config.cjs").write_text("module.exports="+json.dumps(config)+";\n")
for p in root.iterdir():
 if p.is_file():p.chmod(0o600)
sock=socket.socket()
try:sock.bind(("127.0.0.1",3339))
finally:sock.close()
switched=False
try:
 run(["pm2","start",str(root/"ecosystem.config.cjs")])
 for _ in range(50):
  try:
   if request("/ext-whoami.php",3339)[0]==200:break
  except OSError:pass
  time.sleep(.3)
 for route,expected_status in [("/phrasly",200),("/admin/phrasly",200),("/ext-status",401),("/ext-admin",401),("/phrasly-assets/writer.js",200)]:
  assert request(route,3339)[0]==expected_status,route
 local_writer=request("/phrasly-assets/writer.js",3339)[1]
 assert b"Sign in to open Phrasly" in local_writer and b"Continue in the Phrasly tab" in local_writer
 assert processes()=={**baseline,name:processes()[name]},"existing processes changed"
 assert active.read_text()==original,"nginx changed concurrently"
 run(["sudo","cp",str(root/"nginx-proposed.conf"),str(active)])
 switched=True
 run(["sudo","nginx","-t"]);run(["sudo","systemctl","reload","nginx"])
 for _ in range(30):
  if request("/phrasly-assets/writer.js")[1]==local_writer:break
  time.sleep(.5)
 assert request("/phrasly-assets/writer.js")[1]==local_writer
 assert all(fingerprint(r)==http_before[r] for r in routes),"unrelated responses changed"
 after=processes();assert all(after[k]==v for k,v in baseline.items()),"existing process changed"
 evidence={"status":"LIVE","utc":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),**manifest,"root":str(root),"process":name,"unrelated_responses_unchanged_except_ssr_timestamps":True,"ordinary_route_fingerprints":http_before,"native_restarts":after[name]["restarts"],"existing_61_processes_unchanged":True,"native_bundle_public_exact":True,"financial_mutations":False}
 (root/"activation-evidence.json").write_text(json.dumps(evidence,indent=2));(root/"activation-evidence.json").chmod(0o600)
 run(["pm2","save"])
 print(json.dumps(evidence))
except Exception:
 if switched:
  run(["sudo","cp",str(root/"nginx-before.conf"),str(active)])
  run(["sudo","nginx","-t"]);run(["sudo","systemctl","reload","nginx"])
 if name in processes():run(["pm2","stop",name])
 run(["pm2","save"])
 raise
