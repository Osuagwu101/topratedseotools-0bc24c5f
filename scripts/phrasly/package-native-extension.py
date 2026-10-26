#!/usr/bin/env python3
"""Create a deterministic extension ZIP and per-file audit manifest; never overwrite."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import zipfile

spec = importlib.util.spec_from_file_location("native_builder", Path(__file__).with_name("build-native-extension.py"))
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)

def package(origin, output, enabled=False):
    output = Path(output)
    with tempfile.TemporaryDirectory(prefix="trst-extension-") as temp:
        directory = Path(temp) / "extension"
        config = builder.build(origin, directory, enabled)
        files = {name: (directory / name).read_bytes() for name in builder.FILES}
        manifest = {
            "schema": 1,
            "origin": config["origin"],
            "enabled": enabled,
            "version": json.loads(files["manifest.json"])["version"],
            "files": [{"path": name, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()} for name, data in sorted(files.items())],
        }
        files["BUILD-MANIFEST.json"] = (json.dumps(manifest, indent=2, sort_keys=True) + "\n").encode()
        # Exclusive creation also protects existing archives from accidental replacement.
        # Stored entries avoid zlib-version differences for this small package.
        with output.open("xb") as handle, zipfile.ZipFile(handle, "w", compression=zipfile.ZIP_STORED) as archive:
            for name, data in sorted(files.items()):
                info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
                info.create_system = 3
                info.external_attr = 0o100644 << 16
                info.compress_type = zipfile.ZIP_STORED
                archive.writestr(info, data)
    return {"path": str(output), "sha256": hashlib.sha256(output.read_bytes()).hexdigest(), "files": len(files), "origin": config["origin"], "enabled": enabled}

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--origin", required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--enabled", action="store_true")
    args = parser.parse_args()
    print(json.dumps(package(args.origin, args.out, args.enabled)))
