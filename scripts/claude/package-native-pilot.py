"""Build the exact reviewed extension sources into the public download."""
from pathlib import Path
import zipfile
root = Path(__file__).resolve().parents[2]
source = root / 'extensions/claude-native-pilot'
output = root / 'public/downloads/toprated-claude-native-pilot.zip'
output.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as archive:
    for path in sorted(source.iterdir()):
        if path.name not in {'README.txt', 'manifest.json', 'background.js'}:
            raise ValueError('Unexpected extension source')
        info = zipfile.ZipInfo(path.name, (2026, 11, 12, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o644 << 16
        archive.writestr(info, path.read_bytes())
print(output.name)
