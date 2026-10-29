"""Expose the customer summary link through the two existing Admin locations only."""
import pathlib,subprocess,json,hashlib,urllib.request,time
repo=pathlib.Path(__file__).resolve().parents[1]
root=pathlib.Path('/home/ubuntu/releases/trst-customer-tools-summary-20261029')
public=pathlib.Path('/var/www/trst-phrasly-entry-20261026')
nginx=pathlib.Path('/etc/nginx/sites-enabled/topratedseotools')
source=repo/'src/lib/customer-tools-summary-bootstrap.js'
filename='customer-tools-summary-v1.js'
def run(args):return subprocess.run(args,check=True,capture_output=True,text=True,timeout=40).stdout
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def processes():return {p['name']:{'pid':p['pid'],'status':p['pm2_env']['status'],'restarts':p['pm2_env']['restart_time']} for p in json.loads(run(['pm2','jlist']))}
def get(route):
 with urllib.request.urlopen('https://topratedseotools.com'+route,timeout=25) as r:return r.status,r.read()
run(['node','--check',str(source)])
original=nginx.read_text();needle='<script defer src="/phrasly-assets/admin-customer-controls-bootstrap-v1.js"></script></head>'
script='<script defer src="/phrasly-assets/'+filename+'"></script>'
assert original.count(needle)==2 and filename not in original
proposed=original.replace(needle,needle.replace('</head>',script+'</head>'))
assert not root.exists() and not (public/filename).exists()
root.mkdir(mode=0o700);(root/'nginx-before.conf').write_text(original);(root/'nginx-proposed.conf').write_text(proposed);(root/filename).write_bytes(source.read_bytes())
before=processes();assets={p.name:sha(p) for p in public.iterdir() if p.is_file()};(root/'processes-before.json').write_text(json.dumps(before));(root/'assets-before.json').write_text(json.dumps(assets))
switched=False
try:
 run(['sudo','install','-m','644',str(source),str(public/filename)])
 assert nginx.read_text()==original
 run(['sudo','cp',str(root/'nginx-proposed.conf'),str(nginx)]);switched=True
 run(['sudo','nginx','-t']);run(['sudo','systemctl','reload','nginx'])
 code,body=get('/phrasly-assets/'+filename);assert code==200 and hashlib.sha256(body).hexdigest()==sha(source)
 for route in ['/admin','/admin/customers','/admin/customers/00ea9aae-dd51-4ec8-8a9f-3f52fb28ccca']:
  code,body=get(route);assert code==200 and script.encode() in body,route
 for route in ['/','/login','/tools/phrasly','/admin/phrasly']:
  code,body=get(route);assert code==200 and script.encode() not in body,route
 assert processes()==before
 assert all(sha(public/file)==digest for file,digest in assets.items())
 evidence={'status':'LIVE','utc':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'asset':filename,'sha256':sha(source),'existing_processes_unchanged':len(before),'existing_assets_unchanged':True,'new_database_writes':0,'only_main_admin_injection_changed':True,'revocation_handler':'existing adminCancelAssignedOrder for Admin-assigned subscriptions'}
 (root/'activation-evidence.json').write_text(json.dumps(evidence,indent=2));print(json.dumps(evidence))
except Exception:
 if switched:
  run(['sudo','cp',str(root/'nginx-before.conf'),str(nginx)]);run(['sudo','nginx','-t']);run(['sudo','systemctl','reload','nginx'])
 raise
