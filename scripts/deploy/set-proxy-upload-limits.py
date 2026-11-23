#!/usr/bin/env python3
"""Raise nginx request-body limits on the OneClick proxy hosts.

Why: nginx defaults to client_max_body_size 1m. The ChatGPT proxy vhost (and
the main/Grammarly vhosts) never set it, so any file upload over 1 MB is
rejected by nginx with "413 Request Entity Too Large" before the app sees it.
The app itself accepts 25 MB (MAX_REQUEST_BYTES); the Claude vhost already
uses 30m.

Usage (on the VPS):
  sudo python3 scripts/deploy/set-proxy-upload-limits.py           # dry run
  sudo python3 scripts/deploy/set-proxy-upload-limits.py --apply   # write + reload

Safety: backs up each file, edits only server blocks that listen on 443,
runs `nginx -t`, and restores every backup if the test or reload fails.
"""
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

LIMIT = "30m"
SITES = [
    Path("/etc/nginx/sites-enabled/chatgpt-proxy"),
    Path("/etc/nginx/sites-enabled/grammarly-proxy"),
    Path("/etc/nginx/sites-enabled/claude-proxy"),
    Path("/etc/nginx/sites-enabled/topratedseotools"),
]
BACKUPS = Path("/home/ubuntu/deploy-backups") / f"upload-limits-{time.strftime('%Y%m%d-%H%M%S')}"
DIRECTIVE = re.compile(r"^\s*client_max_body_size\s+[^;]+;", re.M)


def server_blocks(text: str):
    """Yield (start, end) spans of top-level `server { ... }` blocks."""
    for m in re.finditer(r"\bserver\s*\{", text):
        depth, i = 0, m.end() - 1
        while i < len(text):
            if text[i] == "{":
                depth += 1
            elif text[i] == "}":
                depth -= 1
                if depth == 0:
                    yield m.start(), i + 1
                    break
            i += 1


def patch(text: str) -> str:
    out, last = [], 0
    for start, end in server_blocks(text):
        block = text[start:end]
        if not re.search(r"listen\s+[^;]*443", block):
            continue
        # Only the server-level directive; location-level ones are left alone.
        head, sep, rest = block.partition("location")
        if DIRECTIVE.search(head):
            head = DIRECTIVE.sub(f"    client_max_body_size {LIMIT};", head, count=1)
        else:
            head = re.sub(r"(\bserver\s*\{\n?)", rf"\1    client_max_body_size {LIMIT};\n", head, count=1)
        out.append(text[last:start] + head + sep + rest)
        last = end
    out.append(text[last:])
    return "".join(out)


def main():
    apply = "--apply" in sys.argv
    changed = {}
    for site in SITES:
        if not site.is_file():
            print(f"skip (missing): {site}")
            continue
        old = site.read_text()
        new = patch(old)
        if new == old:
            print(f"unchanged: {site}")
            continue
        changed[site] = (old, new)
        print(f"will set client_max_body_size {LIMIT}: {site}")
    if not apply or not changed:
        print("dry run only; re-run with --apply" if not apply else "nothing to do")
        return
    BACKUPS.mkdir(parents=True, exist_ok=True)
    for site, (old, new) in changed.items():
        shutil.copy2(site, BACKUPS / site.name)
        site.write_text(new)
    try:
        subprocess.run(["nginx", "-t"], check=True)
        subprocess.run(["systemctl", "reload", "nginx"], check=True)
    except subprocess.CalledProcessError:
        for site in changed:
            shutil.copy2(BACKUPS / site.name, site)
        subprocess.run(["nginx", "-t"], check=False)
        subprocess.run(["systemctl", "reload", "nginx"], check=False)
        raise SystemExit(f"nginx rejected the change; restored backups from {BACKUPS}")
    print(f"applied; backups in {BACKUPS}")


if __name__ == "__main__":
    main()
