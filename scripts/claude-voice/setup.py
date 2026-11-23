#!/usr/bin/env python3
"""One-time setup for Claude OneClick dictation (run on the VPS, from the live release).

    cd /home/ubuntu/deploy/current && sudo python3 scripts/claude-voice/setup.py

What it does (each step backed up; failures roll back that step):
  1. Installs the updated browser relay (adds /voice/* endpoints) into every
     /opt/trst-claude-*-relay/ folder and restarts those relay services.
     Writers' Claude pages may pause for a few seconds; browsers are not restarted.
  2. Installs the dictation bridge at /opt/trst-claude-voice (with the release's
     `ws` package), writes /etc/trst-claude-voice.env (relay keys, mode 600) and
     starts systemd unit trst-claude-voice on 127.0.0.1:3296.
  3. Adds `location ^~ /api/ws/` (WebSocket upgrade -> 3296) to the Claude proxy
     nginx site, tests nginx and reloads; restores the file if nginx rejects it.
Safe to run again.
"""
import json
import re
import shutil
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

RELEASE = Path.cwd()
STAMP = time.strftime("%Y%m%d-%H%M%S")
BACKUPS = Path("/home/ubuntu/deploy-backups") / f"claude-voice-{STAMP}"
RELAY_SRC = RELEASE / "scripts/claude-browser-transport/relay.mjs"
BRIDGE_SRC = RELEASE / "scripts/claude-voice/bridge.mjs"
WS_SRC = RELEASE / "node_modules/ws"
VOICE_DIR = Path("/opt/trst-claude-voice")
VOICE_ENV = Path("/etc/trst-claude-voice.env")
VOICE_UNIT = Path("/etc/systemd/system/trst-claude-voice.service")
NGINX_SITE = Path("/etc/nginx/sites-enabled/claude-proxy")
RELAY_ENVS = {
    "account_1": Path("/etc/trst-claude-browser-relay.env"),
    "account_2": Path("/etc/trst-claude-account-2-relay.env"),
}
NGINX_BLOCK = """    location ^~ /api/ws/ {
        proxy_pass http://127.0.0.1:3296;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header Origin $http_origin;
        proxy_set_header Cookie $http_cookie;
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
        proxy_buffering off;
    }
"""


def log(msg):
    print(msg, flush=True)


def sh(*cmd, check=True):
    return subprocess.run(cmd, check=check, capture_output=True, text=True)


def health(url, tries=20):
    for _ in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=3) as r:
                if r.status == 200:
                    return True
        except Exception:
            pass
        time.sleep(1)
    return False


def relay_units():
    """Map each /opt/...relay/relay.mjs to the systemd unit that runs it."""
    out = sh("systemctl", "list-units", "--all", "--plain", "--no-legend", "--type=service", "trst-claude*").stdout
    units = {}
    for line in out.splitlines():
        unit = line.split()[0] if line.split() else ""
        if not unit.endswith(".service"):
            continue
        exec_start = sh("systemctl", "show", "-p", "ExecStart", unit, check=False).stdout
        m = re.search(r"(/opt/trst-claude-[^ ;]*-relay)/relay\.mjs", exec_start)
        if m:
            units[Path(m.group(1))] = unit
    return units


def read_env_key(path):
    if not path.exists():
        return ""
    for line in path.read_text().splitlines():
        m = re.match(r"\s*CLAUDE_BROWSER_RELAY_KEY\s*=\s*['\"]?([^'\"\s]+)", line)
        if m:
            return m.group(1)
    return ""


def step_relays():
    if sh("node", "--check", str(RELAY_SRC), check=False).returncode:
        raise SystemExit("relay.mjs in this release does not parse; nothing changed")
    units = relay_units()
    if not units:
        raise SystemExit("No Claude relay services found (trst-claude-*-relay); nothing changed")
    for folder, unit in sorted(units.items()):
        target = folder / "relay.mjs"
        BACKUPS.mkdir(parents=True, exist_ok=True)
        backup = BACKUPS / f"{folder.name}-relay.mjs"
        shutil.copy2(target, backup)
        port = "6112" if "account-2" in folder.name else "6101"
        shutil.copyfile(RELAY_SRC, target)
        sh("systemctl", "restart", unit)
        if health(f"http://127.0.0.1:{port}/health"):
            log(f"relay updated and healthy: {unit} ({folder})")
        else:
            shutil.copyfile(backup, target)
            sh("systemctl", "restart", unit, check=False)
            raise SystemExit(f"{unit} did not come back healthy; restored its previous relay.mjs")


def step_bridge():
    keys = {acct: read_env_key(p) for acct, p in RELAY_ENVS.items()}
    if not keys["account_1"]:
        raise SystemExit(f"No CLAUDE_BROWSER_RELAY_KEY in {RELAY_ENVS['account_1']}; bridge not installed")
    (VOICE_DIR / "node_modules").mkdir(parents=True, exist_ok=True)
    shutil.copyfile(BRIDGE_SRC, VOICE_DIR / "bridge.mjs")
    (VOICE_DIR / "package.json").write_text('{"type":"module","private":true}\n')
    dest_ws = VOICE_DIR / "node_modules/ws"
    if dest_ws.exists():
        shutil.rmtree(dest_ws)
    shutil.copytree(WS_SRC, dest_ws)
    VOICE_ENV.write_text(
        "CLAUDE_VOICE_PORT=3296\n"
        "CLAUDE_PUBLIC_ORIGIN=https://claude.topratedseotools.com\n"
        f"CLAUDE_RELAY_KEY_ACCOUNT_1={keys['account_1']}\n"
        f"CLAUDE_RELAY_KEY_ACCOUNT_2={keys['account_2']}\n"
    )
    VOICE_ENV.chmod(0o600)
    VOICE_UNIT.write_text(
        "[Unit]\nDescription=TopRated Claude dictation bridge\nAfter=network.target\n"
        "[Service]\nUser=trst-claude-browser\nGroup=trst-claude-browser\n"
        f"EnvironmentFile={VOICE_ENV}\nWorkingDirectory={VOICE_DIR}\n"
        f"ExecStart=/usr/bin/node {VOICE_DIR}/bridge.mjs\n"
        "Restart=on-failure\nRestartSec=3\nUMask=0077\nMemoryMax=256M\nCPUQuota=100%\nTasksMax=64\n"
        "[Install]\nWantedBy=multi-user.target\n"
    )
    sh("systemctl", "daemon-reload")
    sh("systemctl", "enable", "trst-claude-voice")
    sh("systemctl", "restart", "trst-claude-voice")
    if not health("http://127.0.0.1:3296/health"):
        raise SystemExit("Dictation bridge did not start (journalctl -u trst-claude-voice)")
    log("dictation bridge running: trst-claude-voice on 127.0.0.1:3296")


def add_ws_location(text):
    if "location ^~ /api/ws/" in text:
        return text
    out, done = [], False
    blocks = re.split(r"(?=\bserver\s*\{)", text)
    for block in blocks:
        if not done and re.search(r"listen\s+[^;]*443", block):
            m = re.search(r"^\s*location\s+/\s*\{", block, re.M)
            if m:
                block = block[: m.start()] + "\n" + NGINX_BLOCK + block[m.start():]
                done = True
        out.append(block)
    if not done:
        raise SystemExit("Could not find the HTTPS 'location /' in the Claude nginx site; nginx unchanged")
    return "".join(out)


def step_nginx():
    before = NGINX_SITE.read_text()
    after = add_ws_location(before)
    if after == before:
        log("nginx already routes /api/ws/ to the dictation bridge")
        return
    BACKUPS.mkdir(parents=True, exist_ok=True)
    shutil.copy2(NGINX_SITE, BACKUPS / "claude-proxy.nginx")
    NGINX_SITE.write_text(after)
    try:
        sh("nginx", "-t")
        sh("systemctl", "reload", "nginx")
    except subprocess.CalledProcessError:
        NGINX_SITE.write_text(before)
        sh("nginx", "-t", check=False)
        sh("systemctl", "reload", "nginx", check=False)
        raise SystemExit("nginx rejected the dictation route; restored the previous Claude site")
    log("nginx: /api/ws/ on the Claude host now goes to the dictation bridge")


if __name__ == "__main__":
    for path in (RELAY_SRC, BRIDGE_SRC, WS_SRC, NGINX_SITE):
        if not path.exists():
            raise SystemExit(f"Missing {path}; run from /home/ubuntu/deploy/current with sudo")
    step_relays()
    step_bridge()
    step_nginx()
    log(f"done; backups in {BACKUPS}")
