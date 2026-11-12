"""Platform-independent checks for the same loopback server the installed Windows app uses."""
import base64
import http.client
import json
import io
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
import urllib.request
from reliability import UpdateServer, VERSION_B, eventually, http_json, canonical_windows_path, check_install_handoff


class InstallerHandoffTests(unittest.TestCase):
    def test_shutdown_null_and_success_reply_are_handoffs_to_external_validation(self):
        check_install_handoff(None)
        check_install_handoff({"ok": True, "value": None})

    def test_an_explicit_install_error_must_fail_even_if_the_transport_stays_alive(self):
        for reply in ({"ok": False, "error": {"code": "update_failed"}}, {"unexpected": True}, "garbage"):
            with self.assertRaises(AssertionError):
                check_install_handoff(reply)


class WindowsPathTests(unittest.TestCase):
    def test_extended_prefix_and_case_are_the_same_installed_path(self):
        self.assertEqual(canonical_windows_path(r"\\?\C:\Users\RunnerAdmin\KataGo.exe"),
                         canonical_windows_path(r"c:\users\runneradmin\katago.exe"))
        self.assertNotEqual(canonical_windows_path(r"c:\outside\katago.exe"),
                            canonical_windows_path(r"c:\installed\katago.exe"))

    def test_short_names_are_resolved_before_comparing_win32_results(self):
        with patch("reliability.sys.platform", "win32"), patch("reliability.os.path.realpath", return_value=r"C:\Users\runneradmin\Engine.exe") as realpath:
            self.assertEqual(canonical_windows_path(r"C:\Users\RUNNER~1\Engine.exe"),
                             r"c:\users\runneradmin\engine.exe")
            realpath.assert_called_once_with(r"C:\Users\RUNNER~1\Engine.exe")


class WebDriverReplyTests(unittest.TestCase):
    def test_application_error_is_returned_to_the_fault_injection_test(self):
        application = {"ok": False, "error": {"code": "engine_missing", "detail": "fixture.exe"}}
        with patch("urllib.request.urlopen", return_value=io.BytesIO(json.dumps({"value": application}).encode())):
            self.assertEqual(http_json("POST", "http://127.0.0.1:4444/session/test/execute/async", {}), application)

    def test_protocol_error_is_not_mistaken_for_an_application_reply(self):
        protocol = {"error": "invalid session id", "message": "The browser closed"}
        with patch("urllib.request.urlopen", return_value=io.BytesIO(json.dumps({"value": protocol}).encode())):
            with self.assertRaisesRegex(RuntimeError, "invalid session id"):
                http_json("POST", "http://127.0.0.1:4444/session/test/execute/async", {})


class LoopbackUpdaterTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="masame-server-tests-")
        self.package = Path(self.temp.name) / "fixture.exe"
        self.package.write_bytes(b"MZ" + b"fixture" * 2000)
        self.signature = base64.b64encode(b"test-signature").decode()
        self.server = UpdateServer(self.package, self.signature)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)
        self.temp.cleanup()

    def test_manifest_references_only_this_loopback_server(self):
        with urllib.request.urlopen(self.server.base + "/latest.json") as response:
            manifest = json.load(response)
        self.assertEqual(manifest["version"], VERSION_B)
        self.assertEqual(manifest["platforms"]["windows-x86_64"], {
            "url": self.server.base + "/package.exe", "signature": self.signature,
        })
        self.assertEqual(self.server.server_address[0], "127.0.0.1")

    def test_valid_package_is_identical_and_tampered_package_has_same_size(self):
        with urllib.request.urlopen(self.server.base + "/package.exe") as response:
            self.assertEqual(response.read(), self.package.read_bytes())
        self.server.mode = "signature"
        with urllib.request.urlopen(self.server.base + "/package.exe") as response:
            tampered = response.read()
        original = self.package.read_bytes()
        self.assertEqual(len(tampered), len(original))
        self.assertNotEqual(tampered, original)
        self.assertEqual(self.server.downloads, ["good", "signature"])

    def test_interrupted_response_is_an_incomplete_body(self):
        self.server.mode = "interrupted"
        with urllib.request.urlopen(self.server.base + "/package.exe") as response:
            with self.assertRaises(http.client.IncompleteRead):
                response.read()

    def test_wait_requires_an_observed_success(self):
        with self.assertRaises(AssertionError):
            eventually(lambda: False, timeout=0.01)


if __name__ == "__main__":
    unittest.main()
