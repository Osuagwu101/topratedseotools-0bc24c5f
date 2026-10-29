"""Copy the original AWS writer files, replacing only first-party domain URLs."""
import argparse,json,pathlib,zipfile,urllib.parse
ROOT=pathlib.Path(__file__).resolve().parents[2]
REFERENCE=ROOT/"reference/phrasly-aws-url-only/writer-original.zip"
def rewritten(data,origin):
 for old,new in [(b"https://app.topratedseotools.com.ng",origin.encode()),(b"topratedseotools.com.ng",urllib.parse.urlsplit(origin).hostname.encode())]:
  data=data.replace(old,new)
 return data
def build(origin,destination,enabled=False):
 u=urllib.parse.urlsplit(origin)
 if u.scheme!="https" or not u.hostname or u.path not in ("","/") or u.query or u.fragment or u.username or u.password or u.port not in (None,443):raise ValueError("HTTPS origin required")
 origin="https://"+u.hostname
 destination=pathlib.Path(destination);destination.mkdir(parents=True,exist_ok=False)
 files=[]
 with zipfile.ZipFile(REFERENCE) as z:
  for info in z.infolist():
   if info.is_dir():continue
   rel=info.filename.replace(chr(92),"/").split("/",1)[1]
   p=destination/rel;p.parent.mkdir(parents=True,exist_ok=True)
   data=z.read(info);p.write_bytes(data if rel.endswith(".png") else rewritten(data,origin));files.append(rel)
 return {"origin":origin,"files":len(files),"adaptation":"URLs only"}
if __name__=="__main__":
 p=argparse.ArgumentParser();p.add_argument("--origin",required=True);p.add_argument("--out",required=True);p.add_argument("--enabled",action="store_true");a=p.parse_args();print(json.dumps(build(a.origin,a.out,a.enabled)))
