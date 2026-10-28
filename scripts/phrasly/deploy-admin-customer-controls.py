"""Expose the Phrasly customer card within the existing Admin deployment only."""
import pathlib,json,subprocess,hashlib,urllib.request,sys,re,time
root=pathlib.Path('/home/ubuntu/releases/trst-phrasly-customer-controls-20261028');public=pathlib.Path('/var/www/trst-phrasly-entry-20261026');nginx=pathlib.Path('/etc/nginx/sites-enabled/topratedseotools')
manifest=json.loads((root/'manifest.json').read_text());assert manifest['source_commit']==sys.argv[1]
allowed={'admin-customer-controls-v1.js','admin-customer-controls-bootstrap-v1.js'};assert set(manifest['assets'])==allowed
def run(a):return subprocess.run(a,check=True,capture_output=True,text=True,timeout=40).stdout
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def processes():return {p['name']:{'pid':p['pid'],'status':p['pm2_env']['status'],'restarts':p['pm2_env']['restart_time']} for p in json.loads(run(['pm2','jlist']))}
def get(route):
 with urllib.request.urlopen('https://topratedseotools.com'+route,timeout=25) as r:return r.status,r.read()
for name,digest in manifest['assets'].items():assert sha(root/name)==digest
settings=json.loads(pathlib.Path('/home/ubuntu/releases/trst-phrasly-limits-20261028/settings.private.json').read_text())
for key in ['SUPABASE_SERVICE_ROLE_KEY','PHRASLY_SESSION_ENCRYPTION_KEY','PHRASLY_AWS_EXTENSION_GATE_SECRET']:
 secret=settings[key].encode();assert len(secret)>=16;assert all(secret not in (root/name).read_bytes() for name in allowed)
original=nginx.read_text();assert 'admin-customer-controls-bootstrap-v1.js' not in original
# Keep the inherited analytics injection on both existing Admin locations.
parent=re.search(r"(?m)^    sub_filter '</head>' '(.+)';$",original);assert parent
script='<script defer src="/phrasly-assets/admin-customer-controls-bootstrap-v1.js"></script>'
head=parent.group(1).replace('</head>',script+'</head>');proposed=original
for location in ['location = /admin {','location ^~ /admin/ {']:
 pattern=r'(?m)^    '+re.escape(location)+r'\n([\s\S]*?)^    }'
 match=re.search(pattern,proposed);assert match,location;block=match.group(0);assert 'sub_filter' not in block
 addition='        sub_filter_once on;\n        sub_filter \'</head>\' \''+head+'\';\n'
 if 'proxy_set_header Accept-Encoding' not in block:addition+='        proxy_set_header Accept-Encoding "";\n'
 replacement=block[:-5]+addition+'    }';proposed=proposed[:match.start()]+replacement+proposed[match.end():]
assert proposed.count(script)==2
baseline=processes();assets_before={p.name:sha(p) for p in public.iterdir() if p.is_file()};backup=root/'rollback';backup.mkdir(mode=0o700,exist_ok=False);(backup/'nginx.conf').write_text(original);(root/'nginx-proposed.conf').write_text(proposed)
for name in allowed:assert name not in assets_before,'navigation release already exists'
activated=False
try:
 for name in allowed:run(['sudo','install','-m','644',str(root/name),str(public/name)])
 assert nginx.read_text()==original,'nginx changed concurrently';run(['sudo','cp',str(root/'nginx-proposed.conf'),str(nginx)]);activated=True
 run(['sudo','nginx','-t']);run(['sudo','systemctl','reload','nginx'])
 for name,digest in manifest['assets'].items():assert hashlib.sha256(get('/phrasly-assets/'+name)[1]).hexdigest()==digest
 for route in ['/admin','/admin/dashboard','/admin/customers']:
  code,body=get(route);assert code==200 and script.encode() in body,route
 for route in ['/','/login','/tools/phrasly','/admin/phrasly']:
  code,body=get(route);assert code==200 and script.encode() not in body,route
 assert processes()==baseline,'application process changed';assert all(sha(public/name)==digest for name,digest in assets_before.items()),'existing public asset changed'
 evidence={'status':'LIVE','utc':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'source_commit':manifest['source_commit'],'assets':manifest['assets'],'all_application_processes_unchanged':True,'process_count':len(baseline),'all_existing_public_assets_unchanged':True,'injection_only_on_main_admin_locations':True,'analytics_preserved':True}
 (root/'activation-evidence.json').write_text(json.dumps(evidence,indent=2));print(json.dumps(evidence))
except Exception:
 if activated:run(['sudo','cp',str(backup/'nginx.conf'),str(nginx)]);run(['sudo','nginx','-t']);run(['sudo','systemctl','reload','nginx'])
 raise
