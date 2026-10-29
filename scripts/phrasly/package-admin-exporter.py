"""Package the four supplied AWS Admin extension files unchanged."""
import pathlib,zipfile,json,hashlib
root=pathlib.Path(__file__).resolve().parents[2];source=root/"extensions/phrasly-admin-exporter";out=root/"public/phrasly-assets/Jawad-Ahmed-EXR.zip"
with zipfile.ZipFile(out,"w",compression=zipfile.ZIP_DEFLATED) as z:
 for p in sorted(source.iterdir()):z.write(p,p.name)
(root/"public/phrasly-assets/Osuagwu-Solomon-TopRated.zip").write_bytes(out.read_bytes())
print(json.dumps({"path":str(out),"sha256":hashlib.sha256(out.read_bytes()).hexdigest(),"files":4,"adaptation":"none"}))
