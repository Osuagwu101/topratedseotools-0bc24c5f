#!/usr/bin/env python3
"""Boot restored runtimes in private mount/network namespaces with dummy config.
Requires Linux, Node, iproute2, util-linux and authorized passwordless sudo.
Creates only private test files below the backup; never switches production routes.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import time

INSIDE = r"""
import hashlib,json,os,pathlib,signal,socket,subprocess,time,urllib.request,urllib.error
config=json.load(__import__("sys").stdin)
def run(args):
 r=subprocess.run(args,text=True,capture_output=True,timeout=15)
 if r.returncode:raise RuntimeError("Namespace setup failed: "+args[0])
 return r.stdout
assert os.readlink("/proc/self/ns/net")!=config["host_net"]
assert os.readlink("/proc/self/ns/mnt")!=config["host_mnt"]
run(["mount","--make-rprivate","/"])
run(["mount","--bind",config["empty_directory"],config["masked_releases"]])
assert not list(pathlib.Path(config["masked_releases"]).iterdir())
run(["ip","link","set","dev","lo","up"])
interfaces=[row["ifname"] for row in json.loads(run(["ip","-j","link","show"]))]
assert interfaces==["lo"]
assert not run(["ip","route","show","default"]).strip()
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):return None
opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
results=[]
for item in config["runtimes"]:
 app=pathlib.Path(item["app"]);output=app/".output";package=output/"server/package.json"
 declared=json.loads(package.read_text()).get("dependencies",{})
 dependencies=[]
 for name,version in declared.items():
  p=output/"server/node_modules"/name/"package.json"
  actual=json.loads(p.read_text())["version"]
  if actual!=version:raise RuntimeError("Restored runtime dependency version mismatch")
  dependencies.append({"name":name,"version":actual})
 assert not list(app.glob(".env*"))
 asset=sorted((output/"public/assets").glob("*.js"))[0]
 expected=hashlib.sha256(asset.read_bytes()).hexdigest()
 env={"PATH":"/usr/local/bin:/usr/bin:/bin","HOME":str(app),"HOST":"127.0.0.1","PORT":"18991",
 "NITRO_HOST":"127.0.0.1","NITRO_PORT":"18991","NODE_ENV":"production",
 "SUPABASE_URL":"http://127.0.0.1:9","SUPABASE_PUBLISHABLE_KEY":"sb_publishable_phase1_dummy",
 "SUPABASE_SERVICE_ROLE_KEY":"sb_secret_phase1_dummy","VITE_SUPABASE_URL":"http://127.0.0.1:9",
 "VITE_SUPABASE_PUBLISHABLE_KEY":"sb_publishable_phase1_dummy"}
 def demote():
  os.setgroups([]);os.setgid(config["gid"]);os.setuid(config["uid"]);os.nice(10)
 log=open(app/"boot.private.log","wb")
 proc=subprocess.Popen([config["node"],"--max-old-space-size=192",str(output/"server/index.mjs")],
 cwd=app,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True,preexec_fn=demote)
 row={"role":item["role"],"dependencies":dependencies,"dummy_config":True,"live_releases_masked":True}
 try:
  ready=False;deadline=time.monotonic()+15
  while time.monotonic()<deadline:
   if proc.poll() is not None:break
   try:
    with socket.create_connection(("127.0.0.1",18991),timeout=.3):ready=True;break
   except OSError:time.sleep(.1)
  if not ready:raise RuntimeError("Restored runtime did not start")
  # Production serves these assets in Nginx, rather than the Node SSR router.
  nginx_config=app/"nginx-rehearsal.conf"
  nginx_config.write_text('pid '+str(app/'nginx-rehearsal.pid')+'; error_log stderr warn; events { worker_connections 64; } http { access_log off; server { listen 127.0.0.1:18992; location /assets/ { root '+config['assets_root']+'; try_files $uri =404; } location ^~ /api/phrasly-proxy { return 410; } location ^~ /api/diag/phrasly- { return 410; } location / { proxy_pass http://127.0.0.1:18991; } } }')
  os.chown(nginx_config,config["uid"],config["gid"])
  nginx=subprocess.Popen([config["nginx"],"-p",str(app)+"/","-c",str(nginx_config),"-g","daemon off;"],
   env=env,cwd=app,stdout=log,stderr=subprocess.STDOUT,start_new_session=True,preexec_fn=demote)
  try:
   for attempt in range(30):
    try:
     with socket.create_connection(("127.0.0.1",18992),timeout=.2):break
    except OSError:time.sleep(.1)
   with opener.open("http://127.0.0.1:18992/assets/"+asset.name,timeout=5) as response:
    body=response.read();status=response.status
   if status!=200 or hashlib.sha256(body).hexdigest()!=expected:raise RuntimeError("Restored browser asset mismatch")
   retired=[]
   for path in ["/api/phrasly-proxy","/api/phrasly-proxy-bootstrap"]:
    try:
     with opener.open("http://127.0.0.1:18992"+path,timeout=5) as response:code=response.status
    except urllib.error.HTTPError as error:code=error.code
    if code!=410:raise RuntimeError("Retired route protection mismatch")
    retired.append({"path":path,"status":code})
   row.update({"status":"PASS","asset_status":status,"asset_sha256":expected,"retired_routes":retired})
  finally:
   if nginx.poll() is None:
    os.killpg(nginx.pid,signal.SIGTERM)
    try:nginx.wait(timeout=3)
    except subprocess.TimeoutExpired:os.killpg(nginx.pid,signal.SIGKILL);nginx.wait(timeout=3)
   row["test_nginx_stopped"]=nginx.poll() is not None
  # Exercise a first-party method-denial path without invoking provider or DB logic.
  try:
   request=urllib.request.Request("http://127.0.0.1:18991/api/phrasly-proxy-bootstrap",data=b"",method="POST")
   with opener.open(request,timeout=10) as response:gate=response.status
  except urllib.error.HTTPError as error:gate=error.code
  except (OSError,TimeoutError):gate=None
  if gate!=405:raise RuntimeError("First-party method-denial check failed")
  row["node_method_gate_status"]=gate
  row["html_status"]="NOT_TESTED_REQUIRES_STAGING_DATABASE"
 finally:
  if proc.poll() is None:
   os.killpg(proc.pid,signal.SIGTERM)
   try:proc.wait(timeout=3)
   except subprocess.TimeoutExpired:os.killpg(proc.pid,signal.SIGKILL);proc.wait(timeout=3)
  log.close();row["test_process_stopped"]=proc.poll() is not None
 results.append(row)
print(json.dumps({"status":"PASS","runtimes":results,"network_interfaces":interfaces,
 "external_network":False,"live_release_directory_hidden":True,"production_environment_loaded":False}))
"""

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("backup_directory", type=Path)
    args = parser.parse_args()
    os.umask(0o077)
    backup = args.backup_directory.resolve(strict=True)
    if os.getuid() == 0 or stat.S_IMODE(backup.stat().st_mode) != 0o700:
        raise RuntimeError("Run as the backup owner with a private 0700 backup directory")
    from verify_phase1_backup import verify
    verified = verify(backup)
    if verified["status"] != "PASS":
        raise RuntimeError("Backup verification did not pass")
    manifest = json.loads((backup / "files.private.json").read_text())
    groups = {"storefront-runtime": "/", "login-runtime": "/login",
              "admin-runtime-source": "/admin/turnitin-billing"}
    sources = [manifest[group]["source_root"] for group in groups]
    masked = Path(os.path.commonpath(sources))
    if str(masked) != "/home/ubuntu/releases" or backup.is_relative_to(masked):
        raise RuntimeError("Unexpected release layout; do not mask an unreviewed path")
    stamp = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
    stage = backup / ("runtime-isolation-" + stamp)
    stage.mkdir(mode=0o700, exist_ok=False)
    empty = stage / "empty-releases"
    empty.mkdir(mode=0o700)
    runtimes = []
    for group, route in groups.items():
        app = stage / group / "app"
        app.mkdir(mode=0o700, parents=True)
        source = backup / "restore-rehearsal" / group / ".output"
        if any(path.is_symlink() for path in source.rglob("*")):
            raise RuntimeError("Review runtime symlinks before an independent boot rehearsal")
        shutil.copytree(source, app / ".output")
        runtimes.append({"role": group, "app": str(app), "route": route})
    config = {"uid": os.getuid(), "gid": os.getgid(), "node": shutil.which("node"), "nginx": shutil.which("nginx"),
              "assets_root": str(backup / "restore-rehearsal/assets/trst-assets-unified-20261015"),
              "host_net": os.readlink("/proc/self/ns/net"),
              "host_mnt": os.readlink("/proc/self/ns/mnt"),
              "empty_directory": str(empty), "masked_releases": str(masked),
              "runtimes": runtimes}
    if not config["node"]:
        raise RuntimeError("Node is unavailable")
    result = subprocess.run(["sudo", "-n", "unshare", "--net", "--mount", "--fork",
                             sys.executable, "-c", INSIDE],
                            input=json.dumps(config), text=True, capture_output=True, timeout=120)
    if result.returncode:
        raise RuntimeError("Isolated runtime rehearsal failed: " + result.stderr[-1200:])
    report = json.loads(result.stdout)
    report["utc"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    evidence = backup / ("runtime-isolation-" + stamp + ".private.json")
    evidence.write_text(json.dumps(report, indent=2))
    checksum = hashlib.sha256(evidence.read_bytes()).hexdigest()
    with (backup / "SHA256SUMS").open("a") as handle:
        handle.write(checksum + "  " + evidence.name + "\n")
    print(json.dumps(report))
    return 0

if __name__ == "__main__":
    sys.exit(main())

