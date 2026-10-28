# One-time activation procedure for the prepared, versioned OVH release.
# Reads only protected operational snapshots; never includes credentials in output.
import pathlib,json,hashlib,subprocess,urllib.request,urllib.error,time,signal,os
root=pathlib.Path("/home/ubuntu/releases/trst-phrasly-aws-20261026")
backup=pathlib.Path("/home/ubuntu/backups/phrasly-phase6-live-20261026")
prepared=json.loads((root/"prepare-evidence.json").read_text())
active=pathlib.Path(prepared["active_nginx"])
assert hashlib.sha256(active.read_bytes()).hexdigest()==prepared["original_nginx_sha256"],"active Nginx changed since preparation"
proposed=backup/"nginx-proposed.conf"
assert hashlib.sha256(proposed.read_bytes()).hexdigest()==prepared["proposed_nginx_sha256"]
baseline=json.loads((backup/"pm2-before.json").read_text())
def statuses():
 rows=json.loads(subprocess.check_output(["pm2","jlist"],text=True))
 return {p["name"]:{"name":p["name"],"pid":p["pid"],"status":p["pm2_env"].get("status"),"restarts":p["pm2_env"].get("restart_time")} for p in rows}
current=statuses();assert all(current[p["name"]]==p for p in baseline)
assert current["trst-phrasly-aws-oct26"]["status"]=="online"
def request(route):
 try:
  with urllib.request.urlopen("https://topratedseotools.com"+route,timeout=25) as r:return {"route":route,"status":r.status,"bytes":len(r.read())}
 except urllib.error.HTTPError as e:return {"route":route,"status":e.code,"bytes":len(e.read())}
ordinary=["/","/login","/admin","/tools/stealthwriter","/tools/chatgpt","/turnitin","/turnitin/buy","/api/phrasly-proxy"]
before=[request(route) for route in ordinary]
assert all(r["status"]==200 for r in before[:-1]) and before[-1]["status"]==410
def sudo(args):
 r=subprocess.run(["sudo","-n"]+args,capture_output=True,text=True,timeout=35)
 if r.returncode:raise RuntimeError(r.stderr[-1000:])
 return r
activated=False
try:
 sudo(["cp",str(proposed),str(active)])
 sudo(["nginx","-t"])
 sudo(["systemctl","reload","nginx"]);activated=True
 warmup=[]
 for attempt in range(20):
  status=request("/phrasly")["status"];warmup.append(status)
  if status==200:break
  time.sleep(.5)
 assert warmup[-1]==200,"new Nginx worker did not serve the workspace"
 checks=[request(r) for r in ["/phrasly","/admin/phrasly","/phrasly-assets/writer.js","/phrasly-assets/admin.js","/phrasly-assets/workspace.css","/ext-whoami.php","/ext-status","/ext-admin"]]
 expected=[200,200,200,200,200,200,401,401]
 assert [r["status"] for r in checks]==expected,str(checks)
 after=[request(route) for route in ordinary]
 assert [(r["route"],r["status"],r["bytes"]) for r in before]==[(r["route"],r["status"],r["bytes"]) for r in after],"ordinary route regression"
 current=statuses();assert all(current[p["name"]]==p for p in baseline),"existing PM2 regression"
 sudo_result=subprocess.run(["pm2","save"],capture_output=True,text=True,timeout=30);assert sudo_result.returncode==0
 candidate=pathlib.Path("/home/ubuntu/staging/phrasly-phase6-20261026/candidate.pid")
 if candidate.exists():
  pid=int(candidate.read_text())
  cmd=pathlib.Path("/proc")/str(pid)/"cmdline"
  if cmd.exists() and b"/home/ubuntu/staging/phrasly-phase6-20261026/.output/server/index.mjs" in cmd.read_bytes():
   os.kill(pid,signal.SIGTERM)
 evidence={"utc":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),"status":"LIVE","source_commit":prepared["source_commit"],"active_nginx":str(active),"active_nginx_sha256":hashlib.sha256(active.read_bytes()).hexdigest(),"reload_warmup_statuses":warmup,"private_routes":checks,"ordinary_routes":after,"all_60_original_processes_unchanged":True,"pm2_service":"trst-phrasly-aws-oct26","pm2_persisted":True,"rollback_snapshot":str(backup),"financial_mutations":False}
except Exception as error:
 sudo(["cp",str(backup/"nginx-active.conf"),str(active)])
 sudo(["nginx","-t"])
 if activated:sudo(["systemctl","reload","nginx"])
 evidence={"status":"ROLLED_BACK","error":str(error)}
 (root/"activation-evidence.json").write_text(json.dumps(evidence,indent=2));print(json.dumps(evidence));raise
(root/"activation-evidence.json").write_text(json.dumps(evidence,indent=2));(root/"activation-evidence.json").chmod(0o600)
print(json.dumps(evidence))
