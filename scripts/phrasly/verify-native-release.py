"""Read-only health verification for the native Phrasly release."""
import pathlib,json,subprocess,stat,urllib.request,urllib.error,hashlib,re,time
root=pathlib.Path("/home/ubuntu/releases/trst-phrasly-native-20261026")
original=json.loads(pathlib.Path("/home/ubuntu/backups/phrasly-phase6-live-20261026/pm2-before.json").read_text())
rows={p["name"]:p for p in json.loads(subprocess.check_output(["pm2","jlist"],text=True))}
checks={}
checks["all_original_60_unchanged"]=all({"name":p["name"],"pid":p["pid"],"status":p["pm2_env"]["status"],"restarts":p["pm2_env"]["restart_time"]}==b for b in original for p in [rows[b["name"]]])
release=rows["trst-phrasly-native-oct26"]
checks["native_online_zero_restarts"]=release["pm2_env"]["status"]=="online" and release["pm2_env"]["restart_time"]==0
checks["previous_phrasly_release_stopped"]=rows["trst-phrasly-aws-oct26"]["pm2_env"]["status"]=="stopped"
checks["settings_mode_600"]=stat.S_IMODE((root/"settings.private.json").stat().st_mode)==0o600
checks["directory_mode_700"]=stat.S_IMODE(root.stat().st_mode)==0o700
settings=json.loads((root/"settings.private.json").read_text())
logs=[pathlib.Path(release["pm2_env"][k]).read_bytes() for k in ["pm_out_log_path","pm_err_log_path"]]
checks["no_operational_secrets_in_logs"]=not any(settings[k].encode() in b for k in ["SUPABASE_SERVICE_ROLE_KEY","PHRASLY_AWS_EXTENSION_GATE_SECRET","PHRASLY_SESSION_ENCRYPTION_KEY"] for b in logs)
checks["pm2_persisted"]=any(p["name"]=="trst-phrasly-native-oct26" for p in json.loads(pathlib.Path("/home/ubuntu/.pm2/dump.pm2").read_text()))
activation=json.loads((root/"activation-evidence.json").read_text())
def fetch(route):
 try:
  with urllib.request.urlopen("https://topratedseotools.com"+route,timeout=20) as r:return r.status,r.read()
 except urllib.error.HTTPError as e:return e.code,e.read()
for route,baseline in activation["ordinary_route_fingerprints"].items():
 status,body=fetch(route)
 actual={"status":status,"bytes":len(body),"sha256_without_ssr_timestamps":hashlib.sha256(re.sub(rb"(?<=,u:)[0-9]{13}(?=,s:)",b"TIMESTAMP",body)).hexdigest()}
 checks["unchanged:"+route]=actual==baseline
for route,expected in [("/api/phrasly-proxy",410),("/phrasly",200),("/admin/phrasly",200),("/ext-status",401),("/ext-admin",401)]:
 checks["http:"+route]=fetch(route)[0]==expected
checks["native_upstreams_only"]=pathlib.Path("/etc/nginx/sites-enabled/topratedseotools").read_text().count("127.0.0.1:3339")==12
assert all(checks.values()),str(checks)
evidence={"status":"PASS","utc":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),"checks":checks,"native_pid":release["pid"],"native_restarts":release["pm2_env"]["restart_time"],"financial_mutations":False}
(root/"final-monitoring.json").write_text(json.dumps(evidence,indent=2));(root/"final-monitoring.json").chmod(0o600)
print(json.dumps(evidence))
