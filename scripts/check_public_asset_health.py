#!/usr/bin/env python3
"""Read-only public release gate. Exit nonzero if the site's login/admin assets are missing.
Usage: python3 scripts/check_public_asset_health.py https://topratedseotools.com
Requires Python standard library only. Run from a remote client after every rollout.
"""
import html.parser
import sys
import urllib.error
import urllib.parse
import urllib.request

BASE = (sys.argv[1] if len(sys.argv) > 1 else "https://topratedseotools.com").rstrip("/")
PAGES = ("/login?redirect=%2Fturnitin", "/admin", "/admin/dashboard", "/pricing", "/turnitin")
TIMEOUT = 12

class Assets(html.parser.HTMLParser):
    def __init__(self):
        super().__init__()
        self.paths = set()
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "script" and attrs.get("src"):
            self.paths.add(attrs["src"])
        if tag == "link" and attrs.get("rel") in ("modulepreload", "stylesheet") and attrs.get("href"):
            self.paths.add(attrs["href"])

def fetch(url):
    request = urllib.request.Request(url, headers={"User-Agent": "TRST-deployment-healthcheck/1.0", "Accept": "text/html,*/*"})
    with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
        return response.status, response.headers.get("Content-Type", ""), response.read()

errors = []
seen = set()
for path in PAGES:
    url = BASE + path
    try:
        status, content_type, body = fetch(url)
        if status != 200 or "text/html" not in content_type:
            errors.append(f"Page {path}: HTTP {status}, type {content_type}")
            continue
        parser = Assets()
        parser.feed(body.decode("utf-8", "replace"))
        scripts = [x for x in parser.paths if "/assets/" in urllib.parse.urljoin(BASE, x)]
        if not scripts:
            errors.append(f"Page {path}: no bundled assets found")
        for asset in scripts:
            full = urllib.parse.urljoin(BASE, asset)
            if full in seen:
                continue
            seen.add(full)
            try:
                code, mime, payload = fetch(full)
                if code != 200 or len(payload) == 0:
                    errors.append(f"Asset {full}: HTTP {code} or empty")
                elif asset.endswith((".js", ".mjs")) and not ("javascript" in mime or "ecmascript" in mime):
                    errors.append(f"Asset {full}: unexpected MIME {mime}")
            except Exception as exc:
                errors.append(f"Asset {full}: {exc}")
    except Exception as exc:
        errors.append(f"Page {path}: {exc}")
print(f"Checked {len(PAGES)} routes and {len(seen)} distinct assets")
if errors:
    print("FAIL: deployment health gate")
    for message in errors:
        print(" -", message)
    sys.exit(1)
print("PASS: all initial page assets accessible")
