"""Explicit live acceptance on OVH: no provider generation, messages, or financial writes."""
import pathlib,json,urllib.request,urllib.error,datetime,sys
assert sys.argv[1:]==['--live'], 'requires explicit --live'
root=pathlib.Path('/home/ubuntu/releases/trst-phrasly-limits-20261028')
env=json.loads((root/'settings.private.json').read_text());api=env['SUPABASE_URL'];service=env['SUPABASE_SERVICE_ROLE_KEY'];publishable=env.get('SUPABASE_PUBLISHABLE_KEY') or env.get('SUPABASE_ANON_KEY') or 'sb_publishable_qACYapb1FmF5eAfeG9wEPw_KYGrmAa6'
site='https://topratedseotools.com'
def request(url,method='GET',body=None,headers=None):
 h=headers or {};data=None
 if body is not None:data=json.dumps(body).encode();h={**h,'Content-Type':'application/json'}
 try:
  with urllib.request.urlopen(urllib.request.Request(url,data=data,method=method,headers=h),timeout=30) as r:return r.status,json.loads(r.read() or b'{}')
 except urllib.error.HTTPError as e:return e.code,json.loads(e.read())
def db(table,query):
 code,data=request(api+'/rest/v1/'+table+'?'+query,headers={'apikey':service,'Authorization':'Bearer '+service});assert code==200;return data
def issue(email):
 code,data=request(api+'/auth/v1/admin/generate_link','POST',{'type':'magiclink','email':email},{'apikey':service,'Authorization':'Bearer '+service});assert code==200 and data.get('hashed_token'),'session preparation failed'
 code,session=request(api+'/auth/v1/verify','POST',{'type':'magiclink','token_hash':data['hashed_token']},{'apikey':publishable});assert code==200 and session.get('access_token'),'verification failed';return session
def revoke(session):
 code,_=request(api+'/auth/v1/logout?scope=local','POST',headers={'apikey':publishable,'Authorization':'Bearer '+session['access_token']});return code in [200,204]
def current(expiry):return not expiry or datetime.datetime.fromisoformat(expiry.replace('Z','+00:00'))>datetime.datetime.now(datetime.timezone.utc)
# Existing source entitlements are only read.
profiles=db('profiles','select=id,email,account_status&account_status=eq.active')
access=db('tool_access_grants','select=user_id,expires_at&tool_slug=eq.phrasly&status=eq.active')
orders=db('tool_orders','select=user_id,expires_at,access_type,fulfilment_status&tool_slug=eq.phrasly&status=eq.approved&payment_status=eq.successful')
ids={r['user_id'] for r in access if current(r['expires_at'])}|{r['user_id'] for r in orders if current(r['expires_at']) and (r['access_type']!='private' or r['fulfilment_status']=='active')}
writers=[p for p in profiles if p['id'] in ids];assert writers
roles=db('user_roles','select=user_id&role=eq.admin&is_active=eq.true&is_super_admin=eq.true')
admins=db('admin_accounts','select=user_id');owners={r['user_id'] for r in roles}&{r['user_id'] for r in admins};owner=next(p for p in profiles if p['id'] in owners)
report={'status':'RUNNING','users_verified':0,'checks':{},'provider_generation_requests':0};ownerSession=None
try:
 assert request(site+'/ext-admin')[0]==401;report['checks']['anonymous_admin_denied']=True
 ownerSession=issue(owner['email']);headers={'Authorization':'Bearer '+ownerSession['access_token']}
 code,state=request(site+'/ext-admin',headers=headers);assert code==200 and state.get('owner_id')==owner['id'];report['checks']['owner_can_load_admin']=True
 assert all(all(f['is_unlimited'] for f in w['features'] if f['enabled'] and f['feature_key'] in ['humanizer','ai_detector']) for w in state['staff'] if w['id'] in ids)
 target=next(w for w in writers if w['id']!=owner['id'])
 # A real authenticated save of the already-requested Unlimited setting.
 code,_=request(site+'/ext-admin','POST',{'action':'set_limit','user_id':target['id'],'feature':'humanizer','limit':None},headers);assert code==200;report['checks']['owner_limit_save_succeeded']=True
 for writer in writers:
  session=issue(writer['email'])
  try:
   h={'Authorization':'Bearer '+session['access_token']};code,status=request(site+'/ext-status',headers=h);assert code==200
   assert {f['key'] for f in status['features']}=={'humanizer','ai_detector'}
   assert all(f['unlimited'] is True and f['limit']=='Unlimited' for f in status['features']);report['users_verified']+=1
   for feature in ['humanizer','ai_detector']:
    code,handoff=request(site+'/ext-handoff.php?tool_id=phrasly&feature='+feature,headers=h);assert code==200 and handoff.get('payload')
   if writer['id']!=owner['id']:
    code,_=request(site+'/ext-admin','POST',{'action':'set_limit','user_id':writer['id'],'feature':'humanizer','limit':10000},h);assert code==403
  finally:assert revoke(session),'temporary writer logout failed'
 report['checks'].update({'all_current_users_unlimited':True,'both_native_feature_handoffs_authorized':True,'ordinary_writer_limit_edits_denied':True,'temporary_writer_sessions_revoked':True})
 private=root/'owner-browser.private.json';private.write_text(json.dumps({'site':site,'api':api,'publishable':publishable,'session':ownerSession,'users':len(writers)}));private.chmod(0o600)
 report['status']='PASS';(root/'live-api-evidence.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
except Exception:
 if ownerSession:revoke(ownerSession)
 raise
