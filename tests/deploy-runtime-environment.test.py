import importlib.util
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("deploy", Path(__file__).parents[1] / "scripts/deploy/ovh_deploy_main.py")
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)

class RuntimeConfiguration(unittest.TestCase):
    def test_pm2_flags_survive_without_runtime_metadata(self):
        proc = {"pm2_env": {"env": {"CLAUDE_ACCOUNT_2_RELAY_KEY": "test-key", "PORT": "3283"}, "CLAUDE_BROWSER_RELAY_URL": "http://127.0.0.1:6101/request", "pm_cwd": "/old"}}
        result = deploy.process_environment(proc)
        self.assertEqual(result["CLAUDE_ACCOUNT_2_RELAY_KEY"], "test-key")
        self.assertEqual(result["CLAUDE_BROWSER_RELAY_URL"], "http://127.0.0.1:6101/request")
        self.assertNotIn("pm_cwd", result)

    def test_actual_private_env_wins_over_checkout_env(self):
        with tempfile.TemporaryDirectory() as root:
            root = Path(root)
            (root / ".env").write_text("VITE_PUBLIC_VALUE=test")
            private = root / "private.env"
            private.write_text("TEST_PRIVATE_VALUE=test-only")
            proc = {"pm2_env": {"node_args": ["--env-file=" + str(private)]}}
            self.assertEqual(deploy.private_environment_source(proc, root), private)
            proc["pm2_env"]["node_args"] = "--env-file " + str(private)
            self.assertEqual(deploy.private_environment_source(proc, root), private)
            private.unlink()
            with self.assertRaises(RuntimeError):
                deploy.private_environment_source(proc, root)

    def test_active_apps_and_shared_env_directories_survive_cleanup(self):
        proc = {"pm2_env": {"status": "online", "pm_cwd": "/releases/current", "node_args": ["--env-file=/releases/shared/.env"]}}
        protected = deploy.protected_release_directories([proc])
        self.assertIn(Path("/releases/current"), protected)
        self.assertIn(Path("/releases/shared"), protected)

if __name__ == "__main__":
    unittest.main()
