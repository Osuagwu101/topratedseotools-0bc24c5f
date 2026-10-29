"""Fail if any source payload differs beyond the declared domain substitutions."""
import pathlib,zipfile,json,hashlib
root=pathlib.Path(__file__).resolve().parents[1];reference=root/"reference/phrasly-aws-url-only"
mapping=json.loads((reference/"url-map.json").read_text())
def expected(data):
 for old,new in mapping.items():data=data.replace(old.encode(),new.encode())
 return data
writer=root/"extensions/phrasly-oneclick";rows=[];expected_paths=set()
with zipfile.ZipFile(reference/"writer-original.zip") as z:
 for info in z.infolist():
  if info.is_dir():continue
  rel=info.filename.replace(chr(92),"/").split("/",1)[1];expected_paths.add(rel)
  raw=z.read(info);target=raw if rel.endswith(".png") else expected(raw)
  assert (writer/rel).read_bytes()==target,rel
  rows.append({"file":rel,"result":"identical" if raw==target else "URL substitution only","sha256":hashlib.sha256(target).hexdigest()})
actual={p.relative_to(writer).as_posix() for p in writer.rglob("*") if p.is_file()}
assert actual==expected_paths,{"extra":sorted(actual-expected_paths),"missing":sorted(expected_paths-actual)}
admin=root/"extensions/phrasly-admin-exporter";original=reference/"admin-original"
assert {p.name for p in admin.iterdir()}=={p.name for p in original.iterdir()}
for p in original.iterdir():assert (admin/p.name).read_bytes()==p.read_bytes(),p.name
assert "trst_ping" not in (writer/"background.js").read_text(encoding="utf-8")
assert not (writer/"config.js").exists()
assert json.loads((writer/"manifest.json").read_text(encoding="utf-8"))["version"]=="1.0.0"
package=root/"public/phrasly-assets/TopRated-Phrasly-Access.zip"
if package.exists():
 with zipfile.ZipFile(reference/"writer-original.zip") as a,zipfile.ZipFile(package) as b:
  assert a.namelist()==b.namelist()
  for info in a.infolist():
   raw=a.read(info);want=raw if info.is_dir() or info.filename.endswith(".png") else expected(raw)
   assert b.read(info.filename)==want,info.filename
result={"status":"PASS","writer_files":len(expected_paths),"admin_files":len(list(original.iterdir())),"only_domain_replacements":mapping,"extra_runtime_files":0,"original_version_preserved":True,"files":rows}
out=root/"docs/phrasly/evidence/aws-url-only-byte-comparison-20261029.json";out.write_text(json.dumps(result,indent=2))
print(json.dumps({k:v for k,v in result.items() if k!="files"}))
