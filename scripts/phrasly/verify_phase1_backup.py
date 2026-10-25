#!/usr/bin/env python3
"""Verify a host-local Phase 1 backup and its isolated restore tree.
Reads metadata and hashes only; never extracts archives or changes services.
Run on the original host. Do not copy secret-bearing backups off the host.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import stat
import sys

def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1048576), b""):
            h.update(block)
    return h.hexdigest()

def relative_path(value):
    path = PurePosixPath(value)
    if path.is_absolute() or not path.parts or ".." in path.parts:
        raise ValueError("Manifest contains an unsafe relative path")
    return path

def verify(root):
    root = root.resolve(strict=True)
    if not root.is_dir() or stat.S_IMODE(root.stat().st_mode) != 0o700:
        raise ValueError("Backup directory must be a private directory with mode 0700")
    sums = root / "SHA256SUMS"
    manifest = root / "files.private.json"
    summary = root / "verification.private.json"
    for required in (sums, manifest, summary):
        if not required.is_file() or required.is_symlink():
            raise ValueError("Backup is incomplete: required metadata is absent")
    checked = set()
    for line in sums.read_text().splitlines():
        expected, name = line.split("  ", 1)
        rel = relative_path(name)
        if len(rel.parts) != 1 or name in checked:
            raise ValueError("Checksum entries must be unique top-level files")
        if len(expected) != 64 or any(c not in "0123456789abcdef" for c in expected):
            raise ValueError("Invalid SHA-256 checksum")
        path = root / name
        if path.is_symlink() or not path.is_file() or digest(path) != expected:
            raise ValueError("Backup checksum mismatch")
        if stat.S_IMODE(path.stat().st_mode) != 0o600:
            raise ValueError("Backup files must have mode 0600")
        checked.add(name)
    data = json.loads(manifest.read_text())
    required_archives = {name + ".tar.gz" for name in data}
    if not required_archives or not required_archives.union(
        {"files.private.json", "verification.private.json", "processes.private.json"}
    ).issubset(checked):
        raise ValueError("Checksum coverage is incomplete")
    files_checked = 0
    links_checked = 0
    for group, record in data.items():
        relative_path(group)
        if "/" in group:
            raise ValueError("Invalid backup group")
        restore = root / "restore-rehearsal" / group
        entries = record["entries"]
        links = {rel for rel, entry in entries.items() if entry["kind"] == "symlink"}
        for rel, expected in entries.items():
            safe = relative_path(rel)
            if any(str(parent) in links for parent in safe.parents):
                raise ValueError("Restore entry descends through a symlink")
            path = restore / str(safe)
            actual = path.lstat()
            kind = expected["kind"]
            if stat.S_IMODE(actual.st_mode) != expected["mode"]:
                raise ValueError("Restored file mode mismatch")
            if kind == "file":
                if not stat.S_ISREG(actual.st_mode) or digest(path) != expected["sha256"]:
                    raise ValueError("Restored file content mismatch")
                files_checked += 1
            elif kind == "symlink":
                if not path.is_symlink() or os.readlink(path) != expected["target"]:
                    raise ValueError("Restored symlink mismatch")
                links_checked += 1
            elif kind == "directory":
                if not stat.S_ISDIR(actual.st_mode):
                    raise ValueError("Restored directory mismatch")
            else:
                raise ValueError("Unsupported manifest entry")
    results = json.loads(summary.read_text())
    if results.get("restore_rehearsal") != "PASS":
        raise ValueError("No successful restore rehearsal recorded")
    return {"status": "PASS", "archives": len(required_archives),
            "restored_files": files_checked, "restored_symlinks": links_checked}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("backup_directory", type=Path)
    args = parser.parse_args()
    try:
        print(json.dumps(verify(args.backup_directory)))
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(json.dumps({"status": "FAIL", "reason": str(error)}))
        return 1
    return 0

if __name__ == "__main__":
    sys.exit(main())
