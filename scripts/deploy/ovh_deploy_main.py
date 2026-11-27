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
import json
import shlex
import re
import shutil
import subprocess
import socket
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
    Path("/etc/nginx/sites-enabled/claude-proxy"),
]
# Dedicated hosts answer 401 to an anonymous request (no proxy session) when
# healthy. Only hosts whose nginx file actually points at the app are checked.
DEDICATED_HOST_CHECKS = {
    "/etc/nginx/sites-enabled/chatgpt-proxy": ("https://chatgpt.topratedseotools.com/", {"401"}),
    "/etc/nginx/sites-enabled/claude-proxy": ("https://claude.topratedseotools.com/", {"401"}),
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


def process_environment(proc):
    """Preserve effective PM2 flags without logging their values."""
    meta = proc.get("pm2_env", {})
    # PM2 can include nested process metadata in this map. subprocess env
    # values must be strings; forwarding a dict/list prevents the app starting.
    env = {k: v for k, v in (meta.get("env") or {}).items()
           if isinstance(k, str) and isinstance(v, str)}
    env.update({k: v for k, v in meta.items()
                if re.fullmatch(r"[A-Z][A-Z0-9_]*", k) and isinstance(v, str)})
    return env


def environment_files(proc):
    args = proc.get("pm2_env", {}).get("node_args") or []
    if isinstance(args, str):
        args = shlex.split(args)
    files = []
    for i, arg in enumerate(args):
        if arg.startswith("--env-file="):
            files.append(Path(arg.split("=", 1)[1]))
        elif arg == "--env-file" and i + 1 < len(args):
            files.append(Path(args[i + 1]))
    return files


def private_environment_source(proc, live_dir):
    files = environment_files(proc)
    if len(files) > 1:
        raise RuntimeError("Multiple runtime env files require explicit deployment configuration")
    source = files[0] if files else live_dir / ".env"
    if not source.is_file():
        raise RuntimeError("The live runtime environment file is unavailable")
    return source


def protected_release_directories(processes):
    protected = set()
    for proc in processes:
        meta = proc.get("pm2_env", {})
        if meta.get("status") == "online" and meta.get("pm_cwd"):
            protected.add(Path(meta["pm_cwd"]).resolve())
        # These files may be shared by several current or rollback processes.
        protected.update(path.resolve().parent for path in environment_files(proc))
    return protected


def pm2_names_for_port(port):
    import json
    out = subprocess.run(["pm2", "jlist"], capture_output=True, text=True, check=True).stdout
    names = []
    for proc in json.loads(out):
        env = proc.get("pm2_env", {})
        if str(env.get("PORT") or (env.get("env") or {}).get("PORT")) == port:
            names.append(proc["name"])
    return names


UPLOAD_LIMIT = "30m"
# ChatGPT accepts large files; the proxy allows 50 MB, nginx needs headroom for multipart overhead.
CHATGPT_UPLOAD_LIMIT = "60m"


def ensure_upload_limit(text, limit=UPLOAD_LIMIT):
    """Set client_max_body_size on every HTTPS server block (server level only)."""
    out, last = [], 0
    for m in re.finditer(r"\bserver\s*\{", text):
        if m.start() < last:
            continue
        depth, i = 0, m.end() - 1
        while i < len(text):
            depth += {"{": 1, "}": -1}.get(text[i], 0)
            if depth == 0:
                break
            i += 1
        block = text[m.start():i + 1]
        if re.search(r"listen\s+[^;]*443", block):
            head, sep, rest = block.partition("location")
            directive = re.compile(r"^\s*client_max_body_size\s+[^;]+;", re.M)
            if directive.search(head):
                head = directive.sub(f"    client_max_body_size {limit};", head, count=1)
            else:
                head = re.sub(r"(\bserver\s*\{\n?)", r"\1    client_max_body_size " + limit + ";\n", head, count=1)
            block = head + sep + rest
        out.append(text[last:m.start()] + block)
        last = i + 1
    out.append(text[last:])
    return "".join(out)


CHATGPT_NGINX_CFG = Path("/etc/nginx/sites-enabled/chatgpt-proxy")
CHATGPT_HOST_URL = "https://chatgpt.topratedseotools.com/"
CHATGPT_HOST_NAME = "chatgpt.topratedseotools.com"
CHATGPT_PORT_POOL = range(3330, 3360)


def pm2_ports(processes):
    ports = set()
    for proc in processes:
        env = proc.get("pm2_env", {})
        value = env.get("PORT") or (env.get("env") or {}).get("PORT")
        if value:
            ports.add(str(value))
    return ports


def port_is_free(port):
    probe = socket.socket()
    try:
        probe.bind(("127.0.0.1", int(port)))
        return True
    except OSError:
        return False
    finally:
        probe.close()


def deploy_chatgpt_process(rel, short):
    """Move the dedicated ChatGPT host onto this release, blue/green.

    The ChatGPT host runs as its own PM2 process on its own port, so the main
    swap above never touches it. This starts a copy of that process from the new
    release (same environment, so nothing about customers, sessions or
    subscriptions changes: those live in the database, not in the process),
    waits until it answers, then points only the ChatGPT nginx file at it. The
    previous process keeps running so it can be switched back instantly.
    Any failure leaves the live ChatGPT host exactly as it was.
    """
    if not CHATGPT_NGINX_CFG.exists():
        log("ChatGPT host: no nginx file, skipping")
        return
    original = CHATGPT_NGINX_CFG.read_text()
    old_port = current_port(original)
    processes = json.loads(subprocess.check_output(["pm2", "jlist"], text=True))
    old_proc = next((p for p in processes
                     if p.get("pm2_env", {}).get("status") == "online"
                     and str(p["pm2_env"].get("PORT") or (p["pm2_env"].get("env") or {}).get("PORT")) == old_port), None)
    if old_proc is None:
        log(f"ChatGPT host: no online process on port {old_port}, skipping")
        return
    if Path(old_proc["pm2_env"].get("pm_cwd", "")).resolve() == rel.resolve():
        log("ChatGPT host already runs this release")
        return
    used = pm2_ports(processes)
    new_port = next((str(p) for p in CHATGPT_PORT_POOL if str(p) not in used and port_is_free(p)), None)
    if new_port is None:
        raise RuntimeError("no free port for the ChatGPT process")
    name = f"trst-chatgpt-{new_port}"
    old_cwd = Path(old_proc["pm2_env"]["pm_cwd"])
    log(f"ChatGPT host: {old_proc['name']} (port {old_port}) -> {name} (port {new_port}) from {rel}")

    # Same private environment as the running ChatGPT process, copied into the new release.
    env_file = rel / ".env.chatgpt"
    shutil.copy2(private_environment_source(old_proc, old_cwd), env_file)
    env_file.chmod(0o600)
    old_args = old_proc["pm2_env"].get("node_args") or []
    if isinstance(old_args, str):
        old_args = shlex.split(old_args)
    kept, skip = [], False
    for arg in old_args:
        if skip:
            skip = False
        elif arg == "--env-file":
            skip = True
        elif not arg.startswith("--env-file="):
            kept.append(arg)
    # ChatGPT's responses can carry more header data than Node's 16 KB default
    # (error UND_ERR_HEADERS_OVERFLOW, shown to writers as GPT-04). Always allow 1 MB.
    if not any(a.startswith("--max-http-header-size") for a in kept):
        kept.append("--max-http-header-size=1048576")
    node_args = " ".join(shlex.quote(a) for a in kept + [f"--env-file={env_file}"])
    env = {**os.environ, **process_environment(old_proc),
           "PORT": new_port, "NITRO_PORT": new_port, "HOST": "127.0.0.1", "NITRO_HOST": "127.0.0.1"}
    subprocess.run(["pm2", "delete", name], capture_output=True)
    run(["pm2", "start", str(rel / ".output/server/index.mjs"), "--name", name, "--cwd", str(rel),
         "--interpreter", "/usr/bin/node", f"--node-args={node_args}"], env=env)

    def local_check():
        cmd = ["curl", "-sk", "-m", "15", "-o", "/dev/null", "-w", "%{http_code}",
               "-H", f"Host: {CHATGPT_HOST_NAME}", f"http://127.0.0.1:{new_port}/"]
        return subprocess.run(cmd, capture_output=True, text=True).stdout.strip()

    code = ""
    for _ in range(25):
        time.sleep(2)
        code = local_check()
        if code in ("200", "401"):  # the live process answers 200 locally; the public host answers 401
            break
    log(f"ChatGPT host: local check on {new_port} -> {code}")
    if code not in ("200", "401"):
        subprocess.run(["pm2", "delete", name], capture_output=True)
        raise RuntimeError(f"new ChatGPT process did not become healthy ({code})")

    updated = ensure_upload_limit(re.sub(
        r"(?m)^(\s+)proxy_pass http://127\.0\.0\.1:" + old_port + r";$",
        r"\1proxy_pass http://127.0.0.1:" + new_port + ";", original), CHATGPT_UPLOAD_LIMIT)
    if updated == original:
        subprocess.run(["pm2", "delete", name], capture_output=True)
        raise RuntimeError("ChatGPT nginx config unchanged")
    BACKUPS.mkdir(parents=True, exist_ok=True)
    (BACKUPS / f"chatgpt-proxy-before-{short}-{int(time.time())}.conf").write_text(original)

    def install(text):
        tmp = Path(f"/tmp/nginx-{short}-chatgpt-proxy.conf")
        tmp.write_text(text)
        subprocess.run(["sudo", "cp", str(tmp), str(CHATGPT_NGINX_CFG)], check=True)

    try:
        install(updated)
        run(["sudo", "nginx", "-t"], capture_output=True)
        run(["sudo", "systemctl", "reload", "nginx"])
        time.sleep(2)
        public = http_code(CHATGPT_HOST_URL)
        log(f"PUBLIC {CHATGPT_HOST_URL} {public}")
        if public != "401":
            raise RuntimeError(f"public ChatGPT host check failed ({public})")
    except BaseException as exc:
        install(original)
        subprocess.run(["sudo", "nginx", "-t"], check=True)
        subprocess.run(["sudo", "systemctl", "reload", "nginx"], check=True)
        subprocess.run(["pm2", "delete", name], capture_output=True)
        log(f"ChatGPT host ROLLED BACK to port {old_port}: {exc}")
        raise

    # Retire ChatGPT processes older than the one just replaced (it stays for rollback).
    for proc in processes:
        other = proc["name"]
        if (re.fullmatch(r"trst-chatgpt-\d+", other) and other != name
                and str(proc.get("pm2_env", {}).get("PORT") or (proc.get("pm2_env", {}).get("env") or {}).get("PORT")) != old_port):
            subprocess.run(["pm2", "delete", other], capture_output=True)
            log(f"removed old ChatGPT process {other}")
    log(f"CHATGPT_OK live on port {new_port}; previous ChatGPT process still running on {old_port} for instant rollback")


def main():
    sha = (os.environ.get("SSH_ORIGINAL_COMMAND") or (sys.argv[1] if len(sys.argv) > 1 else "")).strip()
    if not re.fullmatch(r"[0-9a-f]{7,40}", sha):
        raise SystemExit("Usage: provide a git commit SHA (hex, 7-40 chars)")
    short = sha[:7]
    original_cfg = NGINX_CFG.read_text()
    live_port = current_port(original_cfg)
    new_port = PORTS[1] if live_port == PORTS[0] else PORTS[0]
    live_dir, live_name = pm2_cwd_for_port(live_port)
    processes = json.loads(subprocess.check_output(["pm2", "jlist"], text=True))
    live_process = next((p for p in processes if p["name"] == live_name), None)
    if live_process is None:
        raise SystemExit("The live PM2 configuration is unavailable")
    runtime_env = {**os.environ, **process_environment(live_process)}
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
    # The checkout's .env can contain only public build configuration. Use the
    # actual live --env-file and retain PM2-only transport/session settings.
    shutil.copy2(private_environment_source(live_process, live_dir), rel / ".env")
    (rel / ".env").chmod(0o600)
    run(["cp", "-a", str(live_dir / "node_modules"), str(rel / "node_modules")])
    run([BUN, "install"], cwd=rel)

    # 3. Build (low priority, bounded memory/time).
    run("nice -n 15 env NODE_OPTIONS=--max-old-space-size=640 timeout 580 npm run build", shell=True, cwd=rel)

    # 4. Start on the idle port and smoke-test locally.
    # Free the idle port: whatever ran there is the build from two deploys ago (not live).
    for stale in set(pm2_names_for_port(new_port) + [name]):
        subprocess.run(["pm2", "delete", stale], capture_output=True)
    env = {**runtime_env, "PORT": new_port, "NITRO_PORT": new_port, "HOST": "127.0.0.1", "NITRO_HOST": "127.0.0.1"}
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

    # 6. Switch nginx page routes from the live port to the new port, and keep
    # the upload limit in line with the app (nginx defaults to 1 MB, which
    # rejected ChatGPT/Claude file uploads with 413 before they reached the app).
    port_swap = lambda text: re.sub(r"(?m)^(\s+)proxy_pass http://127\.0\.0\.1:" + live_port + r";$",
                                    r"\1proxy_pass http://127.0.0.1:" + new_port + ";", text)
    swap = lambda text: ensure_upload_limit(port_swap(text))
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

    # Keep checking on the active relay port; restarting the retired 3290
    # process would leave the live account-aware 3293 relay on an old build.
    if (rel / GRAMMARLY_WS_SCRIPT).exists():
        cfg = Path("/etc/nginx/sites-enabled/grammarly-proxy").read_text()
        match = re.search(r"location \^~ /__ws/ \{.*?proxy_pass http://127\.0\.0\.1:(\d+);", cfg, re.S)
        relay_port = match.group(1) if match else "3290"
        relay_process = next((p for p in processes if str(p.get("pm2_env", {}).get("GRAMMARLY_WS_RELAY_PORT") or
                             (p.get("pm2_env", {}).get("env") or {}).get("GRAMMARLY_WS_RELAY_PORT")) == relay_port
                             and p.get("pm2_env", {}).get("status") == "online"), None)
        relay_name = relay_process["name"] if relay_process else GRAMMARLY_WS_NAME
        relay_env = {**runtime_env, **(process_environment(relay_process) if relay_process else {}),
                     "GRAMMARLY_WS_RELAY_PORT": relay_port}
        subprocess.run(["pm2", "delete", relay_name], capture_output=True)
        subprocess.run(["pm2", "start", str(rel / GRAMMARLY_WS_SCRIPT), "--name", relay_name,
                        "--cwd", str(rel), "--interpreter", "/usr/bin/node",
                        f"--node-args=--env-file={rel / '.env'}"], env=relay_env, capture_output=True, check=True)
        log("restarted the active Grammarly WebSocket relay")

    subprocess.run(["pm2", "save"], capture_output=True)
    # Stable pointer to the live release for cron jobs (postpaid reminder worker etc.).
    tmp_link = CURRENT_LINK.with_name(CURRENT_LINK.name + ".tmp")
    if tmp_link.is_symlink() or tmp_link.exists():
        tmp_link.unlink()
    tmp_link.symlink_to(rel)
    os.replace(tmp_link, CURRENT_LINK)
    log(f"DEPLOY_OK {sha} live on port {new_port}; previous build still running on {live_port} for instant rollback")

    # The dedicated ChatGPT host is a separate process. A problem here never
    # affects the main site, which is already live and healthy.
    try:
        deploy_chatgpt_process(rel, short)
        subprocess.run(["pm2", "save"], capture_output=True)
    except BaseException as exc:
        log(f"CHATGPT_NOT_UPDATED (the ChatGPT host is unchanged): {exc}")

    # 7. Housekeeping: keep the newest few main releases (never the two that are running).
    active_processes = json.loads(subprocess.check_output(["pm2", "jlist"], text=True))
    keep = {rel.resolve(), live_dir.resolve()} | protected_release_directories(active_processes)
    olds = sorted((p for p in RELEASES.glob("trst-main-*") if p.resolve() not in keep),
                  key=lambda p: p.stat().st_mtime, reverse=True)
    for p in olds[KEEP_RELEASES - 2:]:
        shutil.rmtree(p, ignore_errors=True)
        log(f"removed old release {p.name}")


if __name__ == "__main__":
    main()
