#!/usr/bin/env python3
"""Verify the port against AWS bytes after reversing only declared site adaptations."""
import argparse
import hashlib
import json
from pathlib import Path

def verify(root):
    provenance = json.loads((root / "config/phrasly-aws-extension-provenance.json").read_text())
    checked = []
    for record in provenance["files"]:
        file = root / "extensions/phrasly-oneclick" / record["path"]
        data = file.read_bytes()
        if not record["path"].endswith(".png"):
            text = data.decode("utf8")
            prefix = record["prefix"]
            if not text.startswith(prefix):
                raise ValueError("Unexpected source prefix: " + record["path"])
            text = text[len(prefix):]
            for change in reversed(record["adaptations"]):
                if text.count(change["new"]) != change.get("count", 1):
                    raise ValueError("Unexpected adaptation: " + record["path"])
                text = text.replace(change["new"], change["old"])
            data = text.encode("utf8")
        if len(data) != record["bytes"] or hashlib.sha256(data).hexdigest() != record["sha256"]:
            raise ValueError("AWS source parity mismatch: " + record["path"])
        checked.append(record["path"])
    return {"status": "PASS", "canonical_archive_sha256": provenance["archive_sha256"], "files_verified": len(checked), "files": checked}

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[2])
    args = parser.parse_args()
    print(json.dumps(verify(args.root)))
