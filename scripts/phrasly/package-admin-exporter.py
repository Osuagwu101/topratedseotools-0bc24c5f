"""Build the public Admin exporter without credentials or private signing keys."""
import base64,hashlib,json,pathlib,re,zipfile

root=pathlib.Path(__file__).resolve().parents[2]
source=root/'extensions'/'phrasly-admin-exporter'
manifest=json.loads((source/'manifest.json').read_text())
identity=''.join(chr(97+int(x,16)) for x in hashlib.sha256(base64.b64decode(manifest['key'])).hexdigest()[:32])
receiver=(root/'src/lib/phrasly-extension/cookie-import.ts').read_text()
assert f'PHRASLY_COOKIE_EXPORTER_ID = "{identity}"' in receiver,'exporter identity mismatch'
assert manifest['name']=='Osuagwu Solomon TopRated'
assert manifest['host_permissions']==['https://phrasly.ai/*','https://*.phrasly.ai/*']
assert manifest['externally_connectable']['matches']==['https://topratedseotools.com/*']
allowed={'manifest.json','core.mjs','background.mjs','popup.html','popup.css','popup.mjs','README.txt',*(f'icons/icon{n}.png' for n in (16,32,48,128))}
files={str(p.relative_to(source)).replace('\\','/'):p for p in source.rglob('*') if p.is_file()}
assert set(files)==allowed,'unexpected source files in exporter package'
output=root/'public/phrasly-assets/Osuagwu-Solomon-TopRated.zip';output.parent.mkdir(parents=True,exist_ok=True)
with zipfile.ZipFile(output,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as archive:
 for name in sorted(files):
  info=zipfile.ZipInfo(name,(2026,10,27,0,0,0));info.create_system=3;info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=0o100644<<16
  data=files[name].read_bytes()
  if not name.endswith('.png'):data=data.replace(b'\r\n',b'\n')
  archive.writestr(info,data,compresslevel=9)
print(json.dumps({'file':str(output),'sha256':hashlib.sha256(output.read_bytes()).hexdigest(),'files':len(files),'extension_id':identity}))
