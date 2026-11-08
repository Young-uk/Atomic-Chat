"""CPU-only tests of the exact embedded pin projection, with a fake runtime."""
import hashlib
import json
import pathlib
import re
import subprocess
import sys
import tempfile
import unittest

SOURCE = pathlib.Path(__file__).with_name("managed_engines.rs").read_text()
SCRIPT = re.search(r'const CONTEXT_PIN_SCRIPT: &str = r#"(.*?)"#;', SOURCE, re.S)[1]


class ContextPins(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        serve = self.root / "serve"
        serve.mkdir()
        (serve / "__init__.py").write_text("")
        (serve / "server.py").write_text('''
import hashlib

def prepare_summary_qualification_pins(cfg, offline=False):
    assert offline
    return {
        "atomic_summary_expected_native_sha256": "a" * 64,
        "atomic_summary_expected_backend_sha256": cfg["atomic_summary_expected_backend_sha256"],
        "atomic_summary_expected_model_fingerprint": "strata-stat-v1:" + hashlib.sha256(str(cfg["args"]).encode()).hexdigest(),
    }
''')
        names = ("server.py", "atomic_summary.py", "priority.py", "priority_client.py")
        for name in names[1:]:
            (serve / name).write_text("")
        hashes = {name: hashlib.sha256((serve / name).read_bytes()).hexdigest() for name in names}
        args = ["--max-context", "65536"]
        self.cfg = {
            "cwd": str(self.root), "args": args,
            "atomic_summary_expected_native_sha256": "a" * 64,
            "atomic_summary_expected_backend_sha256": hashlib.sha256(json.dumps(hashes, sort_keys=True).encode()).hexdigest(),
            "atomic_summary_expected_model_fingerprint": "strata-stat-v1:" + hashlib.sha256(str(args).encode()).hexdigest(),
        }

    def run_projection(self):
        return subprocess.run([sys.executable, "-B", "-c", SCRIPT], input=json.dumps(self.cfg),
                              text=True, capture_output=True, cwd=self.root, timeout=10)

    def test_context_only_projection_changes_fingerprint_and_preserves_other_pins(self):
        self.cfg["args"][1] = "32768"
        result = self.run_projection()
        self.assertEqual(result.returncode, 0, result.stderr)
        pins = json.loads(result.stdout)
        self.assertNotEqual(pins["atomic_summary_expected_model_fingerprint"], self.cfg["atomic_summary_expected_model_fingerprint"])
        for key in ("atomic_summary_expected_native_sha256", "atomic_summary_expected_backend_sha256"):
            self.assertEqual(pins[key], self.cfg[key])

    def test_unchanged_context_retains_fingerprint(self):
        result = self.run_projection()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["atomic_summary_expected_model_fingerprint"], self.cfg["atomic_summary_expected_model_fingerprint"])

    def test_wrong_or_missing_baseline_pin_fails_closed(self):
        for key in ("atomic_summary_expected_native_sha256", "atomic_summary_expected_model_fingerprint", "atomic_summary_expected_backend_sha256"):
            original = self.cfg.pop(key)
            self.assertNotEqual(self.run_projection().returncode, 0, key)
            self.cfg[key] = "wrong"
            self.assertNotEqual(self.run_projection().returncode, 0, key)
            self.cfg[key] = original

    def test_backend_drift_fails_before_import(self):
        (self.root / "serve" / "server.py").write_text("raise RuntimeError('must not import changed runtime')")
        result = self.run_projection()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("strataContextPinMismatch", result.stderr)
        self.assertNotIn("must not import changed runtime", result.stderr)

    def test_other_argument_drift_is_not_requalified(self):
        self.cfg["args"] += ["--kv", "f32"]
        self.assertNotEqual(self.run_projection().returncode, 0)


if __name__ == "__main__":
    unittest.main()
