#!/usr/bin/env python3
"""Build the reviewed native extension into a NEW directory; no credentials."""
import argparse
import json
from pathlib import Path
import shutil
from urllib.parse import urlsplit

def build(origin, destination, enabled=False):
    url = urlsplit(origin)
    if url.scheme != "https" or not url.hostname or url.username or url.password or url.port not in (None, 443) or url.path not in ("", "/") or url.query or url.fragment:
        raise ValueError("Use a plain HTTPS origin on port 443")
    origin = "https://" + url.hostname
    source = Path(__file__).resolve().parents[2] / "extensions/phrasly-oneclick"
    destination = Path(destination)
    destination.mkdir(parents=True, exist_ok=False)
    for file in source.iterdir():
        if file.is_file(): shutil.copy2(file, destination / file.name)
    manifest = json.loads((destination / "manifest.json").read_text())
    manifest["host_permissions"] = [origin + "/*"]
    manifest["externally_connectable"] = {"matches": [origin + "/*"]}
    (destination / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    config = "globalThis.TRST_EXTENSION = Object.freeze(" + json.dumps({"origin": origin, "enabled": enabled}) + ");\n"
    (destination / "config.js").write_text(config)
    return {"directory": str(destination), "origin": origin, "enabled": enabled}

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--origin", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--enabled", action="store_true", help="Only after first-party endpoints are wired in staging")
    args = parser.parse_args()
    print(json.dumps(build(args.origin, args.out, args.enabled)))
