"""Static transport-policy contracts, not device/OEM backup execution tests."""
from pathlib import Path
import unittest
import xml.etree.ElementTree as ET

MAIN = Path(__file__).resolve().parents[1] / "android-shared-preview/app/src/main"
ANDROID = "{http://schemas.android.com/apk/res/android}"
DOMAINS = {
    "root", "file", "database", "sharedpref", "external",
    "device_root", "device_file", "device_database", "device_sharedpref",
}


class AndroidBackupPolicyTests(unittest.TestCase):
    def setUp(self):
        self.app = ET.parse(MAIN / "AndroidManifest.xml").getroot().find("application")

    def test_legacy_backup_remains_disabled(self):
        self.assertEqual(self.app.get(ANDROID + "allowBackup"), "false")
        self.assertEqual(self.app.get(ANDROID + "fullBackupContent"), "false")
        self.assertIsNone(self.app.get(ANDROID + "backupAgent"))

    def test_modern_policy_is_wired_and_excludes_every_domain_on_both_transports(self):
        reference = self.app.get(ANDROID + "dataExtractionRules")
        self.assertEqual(reference, "@xml/data_extraction_rules")
        rules = ET.parse(MAIN / "res/xml/data_extraction_rules.xml").getroot()
        self.assertEqual(rules.tag, "data-extraction-rules")
        self.assertEqual(rules.attrib, {})
        self.assertCountEqual([child.tag for child in rules], ["cloud-backup", "device-transfer"])
        for transport in rules:
            with self.subTest(transport=transport.tag):
                self.assertEqual(transport.attrib, {})
                self.assertEqual(len(transport), len(DOMAINS))
                self.assertCountEqual([rule.tag for rule in transport], ["exclude"] * len(DOMAINS))
                self.assertCountEqual([rule.get("domain") for rule in transport], DOMAINS)
                for rule in transport:
                    self.assertEqual(rule.attrib, {"domain": rule.get("domain"), "path": "."})
                    self.assertEqual(len(rule), 0)


if __name__ == "__main__":
    unittest.main()
