import importlib.util
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location("builder", Path(__file__).parents[1] / "scripts/phrasly/build-native-extension.py")
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)
spec = importlib.util.spec_from_file_location("packager", Path(__file__).parents[1] / "scripts/phrasly/package-native-extension.py")
packager = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packager)

class ExtensionBuildTests(unittest.TestCase):
    def test_build_restricts_origin_and_defaults_disabled(self):
        with tempfile.TemporaryDirectory() as temp:
            out = Path(temp) / "extension"
            report = builder.build("https://staging.example.com", out)
            self.assertFalse(report["enabled"])
            manifest = json.loads((out / "manifest.json").read_text())
            self.assertEqual(manifest["permissions"], ["storage"])
            self.assertEqual(manifest["host_permissions"], ["https://staging.example.com/*"])
            self.assertEqual(manifest["externally_connectable"]["matches"], ["https://staging.example.com/*"])
            self.assertIn('"enabled": false', (out / "config.js").read_text())
            self.assertIn('https://staging.example.com/dashboard', (out / "limit-reached.html").read_text())
            self.assertNotIn("key", manifest)

    def test_existing_directory_is_not_overwritten(self):
        with tempfile.TemporaryDirectory() as temp:
            sentinel = Path(temp) / "keep.txt"
            sentinel.write_text("preserve")
            with self.assertRaises(FileExistsError):
                builder.build("https://staging.example.com", temp)
            self.assertEqual(sentinel.read_text(), "preserve")

    def test_enabled_requires_explicit_build_argument(self):
        with tempfile.TemporaryDirectory() as temp:
            out = Path(temp) / "extension"
            builder.build("https://staging.example.com", out, True)
            self.assertIn('"enabled": true', (out / "config.js").read_text())

    def test_invalid_origin_rejected_before_creating_output(self):
        with tempfile.TemporaryDirectory() as temp:
            for index, origin in enumerate(["http://example.com", "https://u:p@example.com", "https://example.com/path", "https://example.com?q=1", "https://example.com:444", "https://exa mple.com", "https://example.com.", "https://example.\ncom", "https://example.com/*"]):
                out = Path(temp) / str(index)
                with self.assertRaises(ValueError): builder.build(origin, out)
                self.assertFalse(out.exists())

    def test_package_is_reproducible_and_has_verified_file_manifest(self):
        with tempfile.TemporaryDirectory() as temp:
            one, two = Path(temp) / "one.zip", Path(temp) / "two.zip"
            a = packager.package("https://staging.example.com", one)
            b = packager.package("https://staging.example.com", two)
            self.assertEqual(a["sha256"], b["sha256"])
            self.assertEqual(one.read_bytes(), two.read_bytes())
            with zipfile.ZipFile(one) as archive:
                manifest = json.loads(archive.read("BUILD-MANIFEST.json"))
                self.assertEqual(set(archive.namelist()), set(builder.FILES) | {"BUILD-MANIFEST.json"})
                self.assertFalse(manifest["enabled"])
                for record in manifest["files"]:
                    self.assertEqual(record["sha256"], hashlib.sha256(archive.read(record["path"])).hexdigest())
                    self.assertEqual(record["bytes"], len(archive.read(record["path"])))
                    self.assertEqual(archive.getinfo(record["path"]).date_time, (1980, 1, 1, 0, 0, 0))

    def test_package_refuses_to_overwrite_existing_file(self):
        with tempfile.TemporaryDirectory() as temp:
            target = Path(temp) / "preserve.zip"
            target.write_bytes(b"keep")
            with self.assertRaises(FileExistsError):
                packager.package("https://staging.example.com", target)
            self.assertEqual(target.read_bytes(), b"keep")

if __name__ == "__main__":
    unittest.main()
