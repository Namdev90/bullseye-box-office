"""Synthetic archive tests for the CI inventory verifier, not APK acceptance."""
import importlib.util
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
import warnings
from zipfile import ZipFile

SPEC = importlib.util.spec_from_file_location("apk_assets", Path(__file__).resolve().parents[1] / "tools/verify-apk-assets.py")
POLICY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(POLICY)


class ApkAssetInventoryTest(unittest.TestCase):
    def setUp(self):
        self.directory = TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.web = self.root / "web"
        for name in POLICY.RELEASE_ASSETS | {"index.html", "app.js"}:
            file = self.web / name
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_text(f"synthetic fixture for {name}")

    def archive(self, names=None, changed=None):
        target = self.root / "synthetic.zip"
        with ZipFile(target, "w") as archive:
            archive.writestr("AndroidManifest.xml", "not a real APK")
            archive.writestr("assets/", b"")
            for name in sorted(POLICY.RELEASE_ASSETS if names is None else names):
                archive.writestr("assets/" + name, b"changed" if changed == name else (self.web / name).read_bytes())
        return target

    def test_exact_release_inventory(self):
        self.assertEqual(POLICY.verify("release", self.archive(), self.web), 4)

    def test_extra_practice_asset_rejected(self):
        with self.assertRaisesRegex(ValueError, "unexpected"):
            POLICY.verify("release", self.archive(POLICY.RELEASE_ASSETS | {"index.html"}), self.web)

    def test_missing_notice_rejected(self):
        with self.assertRaisesRegex(ValueError, "missing"):
            POLICY.verify("release", self.archive(POLICY.RELEASE_ASSETS - {"vendor/QR-LICENSE.txt"}), self.web)

    def test_modified_bytes_rejected(self):
        with self.assertRaisesRegex(ValueError, "differs from source"):
            POLICY.verify("release", self.archive(changed="vendor/sharepass-qr.js"), self.web)

    def test_duplicate_asset_rejected(self):
        target = self.archive()
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", UserWarning)
            with ZipFile(target, "a") as archive:
                archive.writestr("assets/vendor/sharepass-qr.js", "duplicate")
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            POLICY.verify("release", target, self.web)

    def test_debug_keeps_practice_assets_and_checks_bytes(self):
        import shutil
        target = self.root / "merged"
        shutil.copytree(self.web, target)
        self.assertEqual(POLICY.verify("debug-merged", target, self.web), 6)
        (target / "app.js").write_text("changed")
        with self.assertRaisesRegex(ValueError, "differs from source"):
            POLICY.verify("debug-merged", target, self.web)

    def test_debug_must_not_use_release_only_inventory(self):
        import shutil
        target = self.root / "merged"
        shutil.copytree(self.web, target)
        (target / "index.html").unlink()
        with self.assertRaisesRegex(ValueError, "missing"):
            POLICY.verify("debug-merged", target, self.web)


if __name__ == "__main__":
    unittest.main()
