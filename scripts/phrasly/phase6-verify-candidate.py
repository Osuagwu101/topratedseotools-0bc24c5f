# Run only on the authorized OVH host after the protected candidate package and settings are transferred.
# Credentials and account state are read from protected files and never emitted.
import pathlib,json,subprocess,hashlib,tarfile,os,time,socket,urllib.request,urllib.error,shutil
root=pathlib.Path("/home/ubuntu/staging/phrasly-phase6-20261026")
archive=root/"phase6-candidate.tgz"
manifest=json.loads((root/"phase6-package.json").read_text())
assert hashlib.sha256(archive.read_bytes()).hexdigest()==manifest["archive_sha256"]
for f in root.iterdir():
 if f.is_file():f.chmod(0o600)
assert not (root/".output").exists(),"candidate already extracted; inspect before replacing"
with tarfile.open(archive) as tar:tar.extractall(root,filter="data")
backup=pathlib.Path("/home/ubuntu/backups/phrasly-phase6-20261026")
backup.mkdir(mode=0o700,exist_ok=True);backup.chmod(0o700)
nginx=pathlib.Path("/etc/nginx/sites-available/topratedseotools")
assert not (backup/"nginx.conf").exists(),"backup exists; do not overwrite"
(backup/"nginx.conf").write_bytes(nginx.read_bytes());(backup/"nginx.conf").chmod(0o600)
pm=json.loads(subprocess.check_output(["pm2","jlist"],text=True))
baseline=[{"name":p["name"],"pid":p["pid"],"status":p["pm2_env"].get("status"),"restarts":p["pm2_env"].get("restart_time")} for p in pm]
(backup/"pm2-baseline.json").write_text(json.dumps(baseline));(backup/"pm2-baseline.json").chmod(0o600)
env=json.loads((root/"stage-env.private.json").read_text())
sock=socket.socket()
try:sock.bind(("127.0.0.1",3336))
finally:sock.close()
log=open(root/"candidate.log","ab");os.chmod(root/"candidate.log",0o600)
proc=subprocess.Popen([shutil.which("node"),str(root/".output/server/index.mjs")],cwd=root,env={**os.environ,**env,"PORT":"3336","HOST":"127.0.0.1"},stdout=log,stderr=log,start_new_session=True)
(root/"candidate.pid").write_text(str(proc.pid));(root/"candidate.pid").chmod(0o600)
def request(url,data=None,headers=None):
 try:
  with urllib.request.urlopen(urllib.request.Request(url,data=data,headers=headers or {}),timeout=25) as r:return r.status,json.loads(r.read()),dict(r.headers)
 except urllib.error.HTTPError as e:return e.code,json.loads(e.read()),dict(e.headers)
origin="http://127.0.0.1:3336"
try:
 for i in range(60):
  assert proc.poll() is None,"candidate exited"
  try:
   if request(origin+"/ext-whoami.php")[0]==200:break
  except (OSError,ValueError):pass
  time.sleep(.3)
 checks={}
 checks["signed_out_identity"]=request(origin+"/ext-whoami.php")[1].get("ok")==False
 checks["unauthenticated_handoff"]=request(origin+"/ext-handoff.php")[0]==401
 checks["missing_fulfillment_token"]=request(origin+"/ext-fulfill.php")[0]==400
 writer=json.loads((root/"acceptance-writer.private.json").read_text())
 pub=env.get("SUPABASE_PUBLISHABLE_KEY") or env["VITE_SUPABASE_PUBLISHABLE_KEY"]
 status,signed,_=request(env["SUPABASE_URL"]+"/auth/v1/token?grant_type=password",json.dumps({"email":writer["email"],"password":writer["password"]}).encode(),{"apikey":pub,"Content-Type":"application/json"})
 assert status==200,"real destination login failed"
 auth={"Authorization":"Bearer "+signed["access_token"]}
 status,session,headers=request(origin+"/ext-session",b"",auth)
 assert status==200
 import re,urllib.parse
 sid=re.search("PHPSESSID=([^;]+)",headers.get("Set-Cookie",headers.get("set-cookie",""))).group(1)
 checks["real_popup_identity"]=request(origin+"/ext-whoami.php",headers={"X-Ext-Session":sid})[1].get("ok")==True
 status,handoff,_=request(origin+"/ext-handoff.php?tool_id=phrasly&feature=humanizer",headers=auth)
 assert status==200
 status,fulfillment,_=request(origin+"/ext-fulfill.php?"+urllib.parse.urlencode({"payload":handoff["payload"],"signature":handoff["signature"]}))
 checks["real_signed_fulfillment"]=status==200 and fulfillment.get("ok")==True
 checks["cookie_count_matches_aws"]=len(fulfillment.get("cookies",[]))==33
 after=json.loads(subprocess.check_output(["pm2","jlist"],text=True))
 checks["production_processes_unchanged"]=baseline==[{"name":p["name"],"pid":p["pid"],"status":p["pm2_env"].get("status"),"restarts":p["pm2_env"].get("restart_time")} for p in after]
 checks["nginx_unchanged"]=nginx.read_bytes()==(backup/"nginx.conf").read_bytes()
 assert all(checks.values()),str(checks)
 evidence={"utc":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),"status":"PASS","directory":str(root),"pid":proc.pid,"listen":"127.0.0.1:3336","source_commit":manifest["source_commit"],"archive_sha256":manifest["archive_sha256"],"checks":checks,"production_activation":False}
 (root/"candidate-evidence.json").write_text(json.dumps(evidence,indent=2));(root/"candidate-evidence.json").chmod(0o600)
 print(json.dumps(evidence))
except Exception:
 proc.terminate()
 raise
