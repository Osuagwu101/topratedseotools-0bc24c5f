"""Install reviewed rollout fixes into the isolated QuillBot runtime."""
from pathlib import Path
import subprocess
root=Path(__file__).resolve().parents[2]
runtime=Path('/home/ubuntu/worktrees/quillbot-feasibility-20261006/runtime')
source=runtime/'server-browser.mjs'
text=source.read_text()
backup=source.with_suffix('.mjs.before-rollout')
if not backup.exists():backup.write_text(text)
old="catch(e){if(operation)writerStore.refund(session.user_id,operation);throw e;}"
new="catch(e){if(operation)writerStore.refund(session.user_id,operation);else if(/^\\/api\\/paraphraser\\/single-paraphrase\\/[0-9]+$/.test(safePath))writerStore.fail(session.user_id,request.headers.get('x-trst-operation'));throw e;}"
assert old in text or new in text
text=text.replace(old,new)
needle="  if(response.ok&&safePath.startsWith('/api/paraphraser/'))"
if 'if(!response.ok&&/^' not in text:
 assert needle in text
 text=text.replace(needle,"  if(!response.ok&&/^\\/api\\/paraphraser\\/single-paraphrase\\/[0-9]+$/.test(safePath))writerStore.fail(session.user_id,request.headers.get('x-trst-operation'));\n"+needle)
if 'writerStore.recoverAbandoned();' not in text:
 marker='const writerStore=new WriterStore('
 pos=text.index(';',text.index(marker))+1
 text=text[:pos]+'\nwriterStore.recoverAbandoned();'+text[pos:]
source.write_text(text)
for name in ['writer-store.mjs','writer-bootstrap.mjs','rollout-acceptance.mjs']:
 (runtime.parent/'browser-transport'/name).write_bytes((root/'browser-transport'/name).read_bytes())
subprocess.run(['node','--check',str(source)],check=True)
subprocess.run(['python3',str(root/'scripts/quillbot-cookie-connect/install-launch-fix.py')],check=True)
print('Rollout fixes installed; acceptance checks must pass before writer rollout.')
