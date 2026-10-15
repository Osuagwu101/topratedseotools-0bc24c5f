#!/usr/bin/env python3
"""VPS pre-deployment gate: never reload a broken Nginx or publish missing assets.

Usage: sudo python3 scripts/check_nginx_release.py /etc/nginx/sites-enabled/topratedseotools /home/ubuntu/trst-assets-unified-20261015/assets
Read only. Nginx must pass without duplicate-server warnings. No asset collisions.
"""
import pathlib
import re
import subprocess
import sys

nginx_site = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "/etc/nginx/sites-enabled/topratedseotools")
assets = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else "/home/ubuntu/trst-assets-unified-20261015/assets")
required = ("index-B7ydXbIY.js", "site-settings.functions-C-QV9-H-.js", "login-IuiLk1qN.js")
errors = []
if not nginx_site.is_file():
    errors.append(f"Missing Nginx site {nginx_site}")
else:
    config = nginx_site.read_text()
    if "location ^~ /assets/" not in config:
        errors.append("Nginx has no shared /assets/ route")
    if not ("alias " in config or "root " in config):
        errors.append("Nginx has no static asset root/alias; chain proxy is not a safe default")
if not assets.is_dir():
    errors.append(f"Missing asset directory {assets}")
else:
    for name in required:
        target = assets / name
        if not target.is_file() or target.stat().st_size == 0:
            errors.append(f"Missing or empty critical asset: {target}")
enabled = pathlib.Path("/etc/nginx/sites-enabled")
if enabled.is_dir():
    for name in enabled.iterdir():
        if name.is_file() and re.search(r"backup|\.bak|\.old|\.disabled", name.name, re.I):
            errors.append(f"Backup-looking file is active in sites-enabled: {name.name}")
result = subprocess.run(["nginx", "-t"], capture_output=True, text=True)
combined = result.stdout + result.stderr
if result.returncode:
    errors.append(f"nginx -t failed: {combined.strip()}")
if "conflicting server name" in combined:
    errors.append("Nginx duplicate server_name conflict detected")
print("PASS: Nginx release gate" if not errors else "FAIL: Nginx release gate")
for error in errors:
    print(" -", error)
sys.exit(bool(errors))
