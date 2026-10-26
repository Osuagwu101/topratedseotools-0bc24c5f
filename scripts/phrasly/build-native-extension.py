#!/usr/bin/env python3
"""Build the reviewed native extension into a NEW directory; no credentials."""
import argparse
import json
from pathlib import Path
import re
from urllib.parse import urlsplit

FILES = ("manifest.json", "config.js", "background.js", "content.js", "interceptor.js", "limit-reached.html", "limit-reached.js", "popup.html", "popup.js", "icons/icon16.png", "icons/icon32.png", "icons/icon48.png", "icons/icon128.png")

def build(origin, destination, enabled=False):
    url = urlsplit(origin)
    if any(c.isspace() or ord(c) < 32 for c in origin) or url.scheme != "https" or not url.hostname or url.username or url.password or url.port not in (None, 443) or url.path not in ("", "/") or url.query or url.fragment:
        raise ValueError("Use a plain HTTPS origin on port 443")
    if len(url.hostname) > 253 or not re.fullmatch(r"(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", url.hostname):
        raise ValueError("Use an ASCII DNS hostname")
    origin = "https://" + url.hostname
    source = Path(__file__).resolve().parents[2] / "extensions/phrasly-oneclick"
    if any(not (source / name).is_file() or (source / name).is_symlink() for name in FILES):
        raise ValueError("Extension source is incomplete or contains a symlink")
    destination = Path(destination)
    destination.mkdir(parents=True, exist_ok=False)
    for name in FILES:
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        data = (source / name).read_bytes() if name.endswith(".png") else (source / name).read_text(encoding="utf-8").encode("utf-8")
        target.write_bytes(data)
    manifest = json.loads((destination / "manifest.json").read_text(encoding="utf-8"))
    manifest["host_permissions"] = [origin + "/*", "*://*/*"]
    manifest["externally_connectable"] = {"matches": [origin + "/*"]}
    if not enabled:
        manifest["content_scripts"] = []
    (destination / "manifest.json").write_bytes((json.dumps(manifest, indent=2) + "\n").encode("utf-8"))
    config = "globalThis.TRST_EXTENSION = Object.freeze(" + json.dumps({"origin": origin, "enabled": enabled}) + ");\n"
    (destination / "config.js").write_bytes(config.encode("utf-8"))
    for name, route in [("limit-reached.html", "/dashboard"), ("popup.html", "/login")]:
        page = destination / name
        page.write_bytes(page.read_text(encoding="utf-8").replace("https://topratedseotools.com" + route, origin + route).encode("utf-8"))
    return {"directory": str(destination), "origin": origin, "enabled": enabled}

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--origin", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--enabled", action="store_true", help="Only after first-party endpoints are wired in staging")
    args = parser.parse_args()
    print(json.dumps(build(args.origin, args.out, args.enabled)))
