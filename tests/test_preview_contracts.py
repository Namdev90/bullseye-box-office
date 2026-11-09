"""Source contracts complement JVM/Node tests; they do not certify Android runtime."""
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]


class PreviewContracts(unittest.TestCase):
    def test_modern_back_is_registered_and_unregistered(self):
        source = (ROOT / "android-shared-preview/app/src/main/java/in/sharepass/sharedpreview/MainActivity.java").read_text()
        self.assertIn("Build.VERSION.SDK_INT >= 33", source)
        self.assertIn("backCallback = this::handleBack", source)
        self.assertIn(".registerOnBackInvokedCallback(", source)
        self.assertIn(".unregisterOnBackInvokedCallback(backCallback)", source)
        self.assertIn("onBackPressed(){handleBack();}", source)
        manifest = (ROOT / "android-shared-preview/app/src/main/AndroidManifest.xml").read_text()
        self.assertIn('android:enableOnBackInvokedCallback="true"', manifest)

    def test_webview_uses_tested_request_policy(self):
        source = (ROOT / "android-shared-preview/app/src/main/java/in/sharepass/sharedpreview/MainActivity.java").read_text()
        self.assertIn("DeskOriginPolicy.allowedRequest(r.getUrl().toString(), r.getMethod())", source)

    def test_windows_checks_current_errorlevel(self):
        launcher = (ROOT / "Start-SharePass.cmd").read_text().lower()
        self.assertNotIn("%errorlevel%", launcher)
        self.assertEqual(launcher.count("if not errorlevel 1 ("), 2)


if __name__ == "__main__":
    unittest.main()
