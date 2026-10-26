"""Install only versioned public Phrasly assets and attach their bootstrap to the retained storefront.
No application process, database, payment route or customer balance is changed.
"""
import pathlib,json,subprocess,hashlib,tarfile,time,urllib.request,urllib.error,re,sys
stage=pathlib.Path(sys.argv[1]);expected=sys.argv[2]
active=pathlib.Path("/etc/nginx/sites-enabled/topratedseotools")
public=pathlib.Path("/var/www/trst-phrasly-entry-20261026")
backup=pathlib.Path("/home/ubuntu/backups/phrasly-entry-fix-20261026")
tag=""
def run(args):return subprocess.run(args,check=True,capture_output=True,text=True,timeout=45).stdout
def processes():
 return {p["name"]:{"pid":p["pid"],"status":p["pm2_env"]["status"],"restarts":p["pm2_env"]["restart_time"]} for p in json.loads(run(["pm2","jlist"]))}
def request(route):
 try:
  with urllib.request.urlopen("https://topratedseotools.com"+route,timeout=25) as r:return r.status,r.read()
 except urllib.error.HTTPError as e:return e.code,e.read()
def fingerprint(route):
 status,body=request(route)
 body=body.replace(tag.encode(),b"")
 body=re.sub(rb"(?<=,u:)[0-9]{13}(?=,s:)",b"TIMESTAMP",body)
 return {"status":status,"sha256":hashlib.sha256(body).hexdigest(),"bytes":len(body)}
manifest=json.loads((stage/"entry-manifest.json").read_text())
assert manifest["source_commit"]==expected
assert hashlib.sha256((stage/"entry-assets.tgz").read_bytes()).hexdigest()==manifest["archive_sha256"]
with tarfile.open(stage/"entry-assets.tgz") as tar:bootstrap=tar.extractfile("customer-bootstrap-v1.js").read().decode().replace("\r","").replace("\n"," ")
assert chr(39) not in bootstrap and "$" not in bootstrap
tag='<script data-trst-phrasly-bootstrap="1">'+bootstrap+"</script>"
assert not public.exists(),"asset release already installed"
original=active.read_text();assert "data-trst-phrasly-bootstrap" not in original
before=processes()
ordinary=["/","/login","/admin","/tools/stealthwriter","/tools/chatgpt","/turnitin","/turnitin/buy"]
baseline={route:fingerprint(route) for route in ordinary}
assert all(v["status"]==200 for v in baseline.values())
backup.mkdir(mode=0o700,exist_ok=False)
(backup/"nginx-before.conf").write_text(original);(backup/"pm2-before.json").write_text(json.dumps(before))
(backup/"baseline.json").write_text(json.dumps(baseline))
ga4=re.search(r"sub_filter '</head>' '([^']+)';",original).group(1)
assert ga4.endswith("</head>") and "G-29C11X82VB" in ga4
needle="    location / {\n        proxy_pass http://127.0.0.1:3124;"
assert original.count(needle)==1
new=original.replace(needle,needle+"\n        # AWS Phrasly setup and launch integration; original storefront stays on 3124.\n        sub_filter_once on;\n        sub_filter '</head>' '"+ga4.replace("</head>",tag+"</head>").replace(chr(92),chr(92)*2)+"';",1)
pattern=r"    location \^~ /phrasly-assets/ \{[^}]+\}"
replacement='    location ^~ /phrasly-assets/ {\n        alias '+str(public)+'/;\n        types { application/javascript js; text/css css; }\n        add_header Cache-Control "no-store" always;\n        add_header X-Content-Type-Options "nosniff" always;\n        autoindex off;\n        access_log off;\n    }'
new,count=re.subn(pattern,lambda _:replacement,new);assert count==1
(stage/"nginx-proposed.conf").write_text(new)
with tarfile.open(stage/"entry-assets.tgz") as tar:
 for member in tar.getmembers():
  assert pathlib.PurePosixPath(member.name).name==member.name and member.name.endswith((".js",".css"))
 tar.extractall(stage/"assets",filter="data")
for name,digest in manifest["files"].items():
 assert hashlib.sha256((stage/"assets"/name).read_bytes()).hexdigest()==digest
run(["sudo","install","-d","-m","755",str(public)])
for p in (stage/"assets").iterdir():run(["sudo","install","-m","644",str(p),str(public/p.name)])
for p in backup.iterdir():p.chmod(0o600)
changed=False
try:
 assert active.read_text()==original,"routing changed concurrently"
 run(["sudo","cp",str(stage/"nginx-proposed.conf"),str(active)]);changed=True
 run(["sudo","nginx","-t"]);run(["sudo","systemctl","reload","nginx"])
 for _ in range(30):
  if tag.encode() in request("/tools/phrasly")[1]:break
  time.sleep(.5)
 assert tag.encode() in request("/tools/phrasly")[1],"actual Phrasly page has no bootstrap"
 for name,digest in manifest["files"].items():
  status,body=request("/phrasly-assets/"+name);assert status==200 and hashlib.sha256(body).hexdigest()==digest,name
 assert all(fingerprint(route)==old for route,old in baseline.items()),"unrelated response changed beyond added bootstrap/SSR timestamp"
 assert processes()==before,"application process changed"
 assert request("/ext-status")[0]==401 and request("/ext-admin")[0]==401
 assert request("/api/phrasly-proxy")[0]==410
 evidence={"status":"LIVE","utc":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),**manifest,"all_application_processes_unchanged":True,"application_process_count":len(before),"original_responses_preserved_except_added_bootstrap_and_ssr_timestamps":True,"financial_mutations":False,"backup":str(backup)}
 (stage/"activation-evidence.json").write_text(json.dumps(evidence,indent=2));(stage/"activation-evidence.json").chmod(0o600)
 print(json.dumps(evidence))
except Exception:
 if changed:
  run(["sudo","cp",str(backup/"nginx-before.conf"),str(active)])
  run(["sudo","nginx","-t"]);run(["sudo","systemctl","reload","nginx"])
 raise
