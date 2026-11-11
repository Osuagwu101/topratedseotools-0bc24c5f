#!/usr/bin/env python3
"""Blue/green deploy of the main app on the OVH server.

Invoked by GitHub Actions through a forced-command SSH key:
    ssh deploy@server <commit-sha>
The key can only run this script; SSH_ORIGINAL_COMMAND carries the SHA.

Steps: clone the commit -> install -> build -> start on the idle port ->
smoke-test locally -> copy hashed assets -> point nginx at the new port ->
smoke-test publicly -> roll nginx back automatically on any failure.
The previous app process is left running so a manual rollback is instant.
/home/ubuntu/deploy/current is repointed to the live release (used by cron jobs).
"""
import os
import re
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

REPO = "https://github.com/Osuagwu101/topratedseotools-0bc24c5f.git"
RELEASES = Path("/home/ubuntu/releases")
NGINX_CFG = Path("/etc/nginx/sites-enabled/topratedseotools")
# Dedicated proxy hostnames served by the main app; their proxy_pass follows the live port.
EXTRA_NGINX_CFGS = [
    Path("/etc/nginx/sites-enabled/chatgpt-proxy"),
    Path("/etc/nginx/sites-enabled/grammarly-proxy"),
]
# Dedicated hosts answer 401 to an anonymous request (no proxy session) when
# healthy. Only hosts whose nginx file actually points at the app are checked.
DEDICATED_HOST_CHECKS = {
    "/etc/nginx/sites-enabled/chatgpt-proxy": ("https://chatgpt.topratedseotools.com/", {"401"}),
    "/etc/nginx/sites-enabled/grammarly-proxy": ("https://grammarly.topratedseotools.com/", {"401"}),
}
# Grammarly live-checking WebSocket relay (nginx /__ws/ on the Grammarly host).
GRAMMARLY_WS_NAME = "trst-grammarly-ws"
GRAMMARLY_WS_SCRIPT = "scripts/grammarly-ws-relay.mjs"
BACKUPS = Path("/home/ubuntu/deploy/backups")
CURRENT_LINK = Path("/home/ubuntu/deploy/current")  # always points at the live release
ASSETS_DST = Path("/var/www/trst-assets-unified-20261015/assets")
PORTS = ("3270", "3271")
BUN = "/home/ubuntu/.bun/bin/bun"
KEEP_RELEASES = 3
LOCAL_ROUTES = ["/", "/pricing", "/tools", "/login", "/register", "/turnitin", "/turnitin/submit", "/billing", "/admin"]
PUBLIC_ROUTES = LOCAL_ROUTES + ["/dashboard", "/ng", "/gh", "/orders", "/sitemap.xml", "/robots.txt", "/phrasly"]
OK_CODES = {"200", "301", "302", "307", "308"}


def log(msg):
    print(f"[{datetime.now(timezone.utc).strftime('%H:%M:%S')}] {msg}", flush=True)


def run(cmd, **kw):
    log("$ " + (cmd if isinstance(cmd, str) else " ".join(cmd)))
    return subprocess.run(cmd, check=True, **kw)


def http_code(url, host_header=False):
    cmd = ["curl", "-sk", "-m", "25", "-o", "/dev/null", "-w", "%{http_code}"]
    if host_header:
        cmd += ["-H", "Host: topratedseotools.com"]
    return subprocess.run(cmd + [url], capture_output=True, text=True).stdout.strip()


def current_port(cfg_text):
    block = re.search(r"location / \{[^}]*?proxy_pass http://127\.0\.0\.1:(\d+);", cfg_text)
    if not block:
        raise SystemExit("Could not find the root location proxy_pass in nginx config")
    return block.group(1)


def pm2_cwd_for_port(port):
    out = subprocess.run(["pm2", "jlist"], capture_output=True, text=True, check=True).stdout
    import json
    for proc in json.loads(out):
        env = proc.get("pm2_env", {})
        if str(env.get("PORT") or (env.get("env") or {}).get("PORT")) == port and env.get("status") == "online":
            return Path(env["pm_cwd"]), proc["name"]
    return None, None


def pm2_names_for_port(port):
    import json
    out = subprocess.run(["pm2", "jlist"], capture_output=True, text=True, check=True).stdout
    names = []
    for proc in json.loads(out):
        env = proc.get("pm2_env", {})
        if str(env.get("PORT") or (env.get("env") or {}).get("PORT")) == port:
            names.append(proc["name"])
    return names


def main():
    sha = (os.environ.get("SSH_ORIGINAL_COMMAND") or (sys.argv[1] if len(sys.argv) > 1 else "")).strip()
    if not re.fullmatch(r"[0-9a-f]{7,40}", sha):
        raise SystemExit("Usage: provide a git commit SHA (hex, 7-40 chars)")
    short = sha[:7]
    original_cfg = NGINX_CFG.read_text()
    live_port = current_port(original_cfg)
    new_port = PORTS[1] if live_port == PORTS[0] else PORTS[0]
    live_dir, _ = pm2_cwd_for_port(live_port)
    if not live_dir:
        raise SystemExit(f"No online app process on live port {live_port}")
    rel = RELEASES / f"trst-main-{short}"
    if rel.resolve() == live_dir.resolve():  # redeploying the live commit: never touch the live folder
        rel = RELEASES / f"trst-main-{short}-{int(time.time())}"
    name = f"trst-main-{new_port}"
    log(f"Deploying {sha} -> {rel} on port {new_port} (live: {live_port} from {live_dir})")

    # 1. Fetch the exact commit.
    if rel.exists():
        shutil.rmtree(rel)
    run(["git", "clone", "-q", REPO, str(rel)], env={**os.environ, "GIT_TERMINAL_PROMPT": "0"})
    run(["git", "-C", str(rel), "checkout", "-q", sha])

    # 2. Environment + dependencies (copy the live tree, then reconcile with bun.lock).
    shutil.copy2(live_dir / ".env", rel / ".env")
    run(["cp", "-a", str(live_dir / "node_modules"), str(rel / "node_modules")])
    run([BUN, "install"], cwd=rel)

    # 3. Build (low priority, bounded memory/time).
    run("nice -n 15 env NODE_OPTIONS=--max-old-space-size=640 timeout 580 npm run build", shell=True, cwd=rel)

    # 4. Start on the idle port and smoke-test locally.
    # Free the idle port: whatever ran there is the build from two deploys ago (not live).
    for stale in set(pm2_names_for_port(new_port) + [name]):
        subprocess.run(["pm2", "delete", stale], capture_output=True)
    env = {**os.environ, "PORT": new_port, "NITRO_PORT": new_port, "HOST": "127.0.0.1", "NITRO_HOST": "127.0.0.1"}
    run(["pm2", "start", str(rel / ".output/server/index.mjs"), "--name", name, "--cwd", str(rel),
         "--interpreter", "/usr/bin/node", f"--node-args=--env-file={rel / '.env'}"], env=env)
    time.sleep(8)
    for route in LOCAL_ROUTES:
        code = http_code(f"http://127.0.0.1:{new_port}{route}", host_header=True)
        log(f"LOCAL {route} {code}")
        if code not in OK_CODES:
            subprocess.run(["pm2", "delete", name], capture_output=True)
            raise SystemExit(f"Local smoke test failed for {route}: {code}. Live site untouched.")

    # 5. Publish hashed assets (never overwrites existing files).
    run(["sudo", "rsync", "-a", "--ignore-existing", f"{rel}/.output/public/assets/", f"{ASSETS_DST}/"])

    # 6. Switch nginx page routes from the live port to the new port.
    swap = lambda text: re.sub(r"(?m)^(\s+)proxy_pass http://127\.0\.0\.1:" + live_port + r";$",
                               r"\1proxy_pass http://127.0.0.1:" + new_port + ";", text)
    new_cfg = swap(original_cfg)
    if new_cfg == original_cfg:
        raise SystemExit("nginx config unchanged; aborting")
    BACKUPS.mkdir(parents=True, exist_ok=True)
    stamp = int(time.time())
    (BACKUPS / f"nginx-before-{short}-{stamp}.conf").write_text(original_cfg)
    changes = [(NGINX_CFG, original_cfg, new_cfg)]
    for extra in EXTRA_NGINX_CFGS:
        if not extra.exists():
            continue
        before = extra.read_text()
        after = swap(before)
        if after != before:
            (BACKUPS / f"{extra.name}-before-{short}-{stamp}.conf").write_text(before)
            changes.append((extra, before, after))

    def install(path, text):
        tmp = Path(f"/tmp/nginx-{short}-{path.name}.conf")
        tmp.write_text(text)
        run(["sudo", "cp", str(tmp), str(path)])

    try:
        for path, _, after in changes:
            install(path, after)
        run(["sudo", "nginx", "-t"], capture_output=True)
        run(["sudo", "systemctl", "reload", "nginx"])
        time.sleep(2)
        for route in PUBLIC_ROUTES:
            code = http_code("https://topratedseotools.com" + route)
            log(f"PUBLIC {route} {code}")
            if code not in OK_CODES:
                raise RuntimeError(f"Public smoke test failed for {route}: {code}")
        for path, _, _ in changes:
            if str(path) not in DEDICATED_HOST_CHECKS:
                continue
            url, ok = DEDICATED_HOST_CHECKS[str(path)]
            code = http_code(url)
            log(f"PUBLIC {url} {code}")
            if code not in ok:
                raise RuntimeError(f"Dedicated host smoke test failed for {url}: {code}")
    except BaseException as exc:
        for path, before, _ in changes:
            tmp = Path(f"/tmp/nginx-{short}-{path.name}.rollback")
            tmp.write_text(before)
            subprocess.run(["sudo", "cp", str(tmp), str(path)], check=True)
        subprocess.run(["sudo", "nginx", "-t"], check=True)
        subprocess.run(["sudo", "systemctl", "reload", "nginx"], check=True)
        log(f"ROLLED BACK nginx to port {live_port}: {exc}")
        raise SystemExit(1)

    # Restart the Grammarly WebSocket relay from the new release (clients reconnect).
    if (rel / GRAMMARLY_WS_SCRIPT).exists():
        subprocess.run(["pm2", "delete", GRAMMARLY_WS_NAME], capture_output=True)
        subprocess.run(["pm2", "start", str(rel / GRAMMARLY_WS_SCRIPT), "--name", GRAMMARLY_WS_NAME,
                        "--cwd", str(rel), "--interpreter", "/usr/bin/node",
                        f"--node-args=--env-file={rel / '.env'}"], capture_output=True)
        log("restarted Grammarly WebSocket relay")

    subprocess.run(["pm2", "save"], capture_output=True)
    # Stable pointer to the live release for cron jobs (postpaid reminder worker etc.).
    tmp_link = CURRENT_LINK.with_name(CURRENT_LINK.name + ".tmp")
    if tmp_link.is_symlink() or tmp_link.exists():
        tmp_link.unlink()
    tmp_link.symlink_to(rel)
    os.replace(tmp_link, CURRENT_LINK)
    log(f"DEPLOY_OK {sha} live on port {new_port}; previous build still running on {live_port} for instant rollback")

    # 7. Housekeeping: keep the newest few main releases (never the two that are running).
    keep = {rel.resolve(), live_dir.resolve()}
    olds = sorted((p for p in RELEASES.glob("trst-main-*") if p.resolve() not in keep),
                  key=lambda p: p.stat().st_mtime, reverse=True)
    for p in olds[KEEP_RELEASES - 2:]:
        shutil.rmtree(p, ignore_errors=True)
        log(f"removed old release {p.name}")


if __name__ == "__main__":
    main()
