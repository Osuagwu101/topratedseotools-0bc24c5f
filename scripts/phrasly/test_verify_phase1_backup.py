"""Run with python3 -m unittest discover -s scripts/phrasly -p 'test_*.py'."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tarfile
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location("verifier", Path(__file__).with_name("verify_phase1_backup.py"))
VERIFIER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(VERIFIER)

class BackupVerificationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / "backup"
        self.root.mkdir(mode=0o700)
        self.restore = self.root / "restore-rehearsal" / "runtime"
        self.restore.mkdir(parents=True)
        self.file = self.restore / "index.mjs"
        self.file.write_text("export default 'fixture';\n")
        self.file.chmod(0o640)
        (self.restore / "entry").symlink_to("index.mjs")
        self.manifest = {
            "runtime": {"source_root": "/isolated-fixture", "entries": {
                "index.mjs": {"kind": "file", "mode": 0o640, "sha256": VERIFIER.digest(self.file)},
                "entry": {"kind": "symlink", "mode": 0o777, "target": "index.mjs"},
            }}
        }
        archive = self.root / "runtime.tar.gz"
        with tarfile.open(archive, "w:gz") as handle:
            handle.add(self.file, arcname="index.mjs")
            handle.add(self.restore / "entry", arcname="entry")
        (self.root / "files.private.json").write_text(json.dumps(self.manifest))
        (self.root / "verification.private.json").write_text(json.dumps({"restore_rehearsal": "PASS"}))
        (self.root / "processes.private.json").write_text("[]")
        for path in self.root.iterdir():
            if path.is_file():
                path.chmod(0o600)
        self.refresh_checksums()

    def tearDown(self):
        self.temp.cleanup()

    def refresh_checksums(self):
        sums = self.root / "SHA256SUMS"
        sums.write_text("".join(
            VERIFIER.digest(path) + "  " + path.name + "\n"
            for path in sorted(self.root.iterdir()) if path.is_file() and path.name != "SHA256SUMS"
        ))
        sums.chmod(0o600)

    def test_intact_archive_and_restore_tree_pass(self):
        result = VERIFIER.verify(self.root)
        self.assertEqual(result, {"status": "PASS", "archives": 1, "restored_files": 1, "restored_symlinks": 1})

    def test_truncated_archive_is_rejected(self):
        (self.root / "runtime.tar.gz").write_bytes(b"truncated")
        with self.assertRaisesRegex(ValueError, "checksum mismatch"):
            VERIFIER.verify(self.root)

    def test_changed_restored_content_is_rejected(self):
        self.file.write_text("changed\n")
        with self.assertRaisesRegex(ValueError, "content mismatch"):
            VERIFIER.verify(self.root)

    def test_changed_symlink_is_rejected(self):
        link = self.restore / "entry"
        link.unlink()
        link.symlink_to("missing.mjs")
        with self.assertRaisesRegex(ValueError, "symlink mismatch"):
            VERIFIER.verify(self.root)

    def test_incomplete_backup_is_rejected(self):
        (self.root / "verification.private.json").unlink()
        with self.assertRaisesRegex(ValueError, "incomplete"):
            VERIFIER.verify(self.root)

    def test_public_archive_permissions_are_rejected(self):
        (self.root / "runtime.tar.gz").chmod(0o644)
        with self.assertRaisesRegex(ValueError, "0600"):
            VERIFIER.verify(self.root)

    def test_manifest_traversal_is_rejected(self):
        self.manifest["runtime"]["entries"]["../outside"] = {"kind": "directory", "mode": 0o700}
        (self.root / "files.private.json").write_text(json.dumps(self.manifest))
        self.refresh_checksums()
        with self.assertRaisesRegex(ValueError, "unsafe relative path"):
            VERIFIER.verify(self.root)

if __name__ == "__main__":
    unittest.main()
