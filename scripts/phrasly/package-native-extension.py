"""Preserve AWS ZIP entries and payloads; replace only the declared domain references."""
import argparse,pathlib,zipfile,hashlib,json,importlib.util
spec=importlib.util.spec_from_file_location("builder",pathlib.Path(__file__).with_name("build-native-extension.py"));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def package(origin,output,enabled=False):
 output=pathlib.Path(output)
 with zipfile.ZipFile(m.REFERENCE) as source,zipfile.ZipFile(output,"x") as target:
  target.comment=source.comment
  for info in source.infolist():
   data=source.read(info)
   if not info.is_dir() and not info.filename.endswith(".png"):data=m.rewritten(data,origin)
   target.writestr(info,data)
 return {"path":str(output),"sha256":hashlib.sha256(output.read_bytes()).hexdigest(),"adaptation":"URLs only"}
if __name__=="__main__":
 p=argparse.ArgumentParser();p.add_argument("--origin",required=True);p.add_argument("--out",required=True);p.add_argument("--enabled",action="store_true");a=p.parse_args();print(json.dumps(package(a.origin,a.out,a.enabled)))
