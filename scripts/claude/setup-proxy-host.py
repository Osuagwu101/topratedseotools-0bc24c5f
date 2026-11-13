#!/usr/bin/env python3
"""Prepare/activate Claude's dedicated OVH host; never prints environment values."""
import argparse
import os
import re
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path

HOST = 'claude.topratedseotools.com'
CFG = Path('/etc/nginx/sites-available/claude-proxy')
LINK = Path('/etc/nginx/sites-enabled/claude-proxy')
WEBROOT = Path('/var/www/claude-acme')
CURRENT = Path('/home/ubuntu/deploy/current')
CERT = Path('/etc/letsencrypt/live') / HOST

def run(*args):
    return subprocess.run(args, check=True, capture_output=True, text=True)

def configure(text):
    previous = CFG.read_text() if CFG.exists() else None
    if previous is not None:
        backup = Path('/home/ubuntu/deploy/backups')
        backup.mkdir(parents=True, exist_ok=True)
        shutil.copy2(CFG, backup / ('claude-proxy-' + datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S') + '.conf'))
    CFG.write_text(text)
    created = not LINK.exists()
    if created:
        LINK.symlink_to(CFG)
    try:
        run('nginx', '-t')
        run('systemctl', 'reload', 'nginx')
    except Exception:
        if previous is None:
            if created:
                LINK.unlink(missing_ok=True)
            CFG.unlink(missing_ok=True)
        else:
            CFG.write_text(previous)
        raise

http = '''server {
    listen 80;
    server_name HOST;
    access_log off;
    location ^~ /.well-known/acme-challenge/ {
        root /var/www/claude-acme;
        default_type text/plain;
    }
    location / { ACTION }
}
'''.replace('HOST', HOST)
p = argparse.ArgumentParser()
p.add_argument('stage', choices=['prepare', 'activate'])
args = p.parse_args()
if os.geteuid() != 0:
    raise SystemExit('Run with sudo on the OVH host')
if args.stage == 'prepare':
    WEBROOT.mkdir(parents=True, exist_ok=True)
    if not (CERT / 'fullchain.pem').exists():
        configure(http.replace('ACTION', 'return 503;'))
        run('certbot', 'certonly', '--webroot', '-w', str(WEBROOT), '-d', HOST, '--non-interactive', '--keep-until-expiring')
    env = CURRENT / '.env'
    content = env.read_text()
    for key, value in [('CLAUDE_PROXY_PUBLIC_ORIGIN', 'https://' + HOST), ('CLAUDE_PROXY_VERIFIED', 'false')]:
        line = key + '=' + value
        content = re.sub(r'^' + key + r'=.*$', line, content, flags=re.M) if re.search(r'^' + key + '=', content, re.M) else content.rstrip() + '\n' + line + '\n'
    env.write_text(content)
    print('Claude DNS/TLS prepared; server origin configured; verification gate remains closed.')
else:
    main = Path('/etc/nginx/sites-enabled/topratedseotools').read_text()
    match = re.search(r'location / \{[^}]*?proxy_pass http://127\.0\.0\.1:(\d+);', main)
    if not match or not (CERT / 'fullchain.pem').exists():
        raise SystemExit('Current app port or Claude certificate unavailable')
    port = match.group(1)
    code = run('curl', '-sS', '--max-time', '20', '-o', '/dev/null', '-w', '%{http_code}', '-H', 'Host: ' + HOST, '-H', 'X-Forwarded-Proto: https', 'http://127.0.0.1:' + port + '/').stdout.strip()
    if code != '401':
        raise SystemExit('Claude app host gate not ready: HTTP ' + code)
    https = '''server {
    listen 443 ssl;
    server_name HOST;
    access_log off;
    ssl_certificate CERT/fullchain.pem;
    ssl_certificate_key CERT/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
    client_max_body_size 30m;
    location / {
        proxy_pass http://127.0.0.1:PORT;
        proxy_http_version 1.1;
        proxy_buffering off;
        proxy_request_buffering off;
        proxy_read_timeout 600s;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
'''.replace('HOST', HOST).replace('CERT', str(CERT)).replace('PORT', port)
    configure(http.replace('ACTION', 'return 301 https://$host$request_uri;') + https)
    code = run('curl', '-sS', '--max-time', '20', '-o', '/dev/null', '-w', '%{http_code}', 'https://' + HOST + '/').stdout.strip()
    if code != '401':
        raise SystemExit('Public Claude host check failed: HTTP ' + code)
    print('Claude HTTPS host active; anonymous requests correctly require TopRated launch (401).')
