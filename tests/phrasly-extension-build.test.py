import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("builder", Path(__file__).parents[1] / "scripts/phrasly/build-native-extension.py")
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)

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
            for index, origin in enumerate(["http://example.com", "https://u:p@example.com", "https://example.com/path", "https://example.com?q=1", "https://example.com:444"]):
                out = Path(temp) / str(index)
                with self.assertRaises(ValueError): builder.build(origin, out)
                self.assertFalse(out.exists())

if __name__ == "__main__":
    unittest.main()
