#!/usr/bin/env python3
"""Verify build outputs only. No signing, installation or release publication.

Release APK inventory is deliberately independent of Gradle's copy allowlist,
so accidentally widening that allowlist fails CI. Debug's merged practice assets
are checked without creating a debug-signed APK or debug keystore.
"""

import argparse
from pathlib import Path
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
RELEASE_ASSETS = {
    "assets/sharepass-approved-logo.jpg",
    "vendor/sharepass-qr.js",
    "vendor/QR-LICENSE.txt",
    "vendor/QR-SOURCES.md",
}


def verify(mode, artifact, web=ROOT / "web"):
    if mode == "release":
        expected = RELEASE_ASSETS
        with ZipFile(artifact) as apk:
            entries = [entry for entry in apk.infolist() if entry.filename.startswith("assets/") and not entry.is_dir()]
            names = [entry.filename.removeprefix("assets/") for entry in entries]
            if len(names) != len(set(names)):
                raise ValueError("Duplicate asset paths in APK")
            check_inventory(set(names), expected)
            for entry, name in zip(entries, names):
                if apk.read(entry) != (web / name).read_bytes():
                    raise ValueError(f"Packaged asset differs from source: {name}")
    elif mode == "debug-merged":
        # This is the only additional asset exclusion configured by this app.
        expected = {path.relative_to(web).as_posix() for path in web.rglob("*")
                    if path.is_file() and path.name != "sharepass-handoff.png"}
        actual = {path.relative_to(artifact).as_posix() for path in artifact.rglob("*") if path.is_file()}
        check_inventory(actual, expected)
        for name in expected:
            if (artifact / name).read_bytes() != (web / name).read_bytes():
                raise ValueError(f"Merged debug asset differs from source: {name}")
    else:
        raise ValueError(f"Unknown inventory mode: {mode}")
    return len(expected)


def check_inventory(actual, expected):
    if actual != expected:
        raise ValueError(f"Asset inventory mismatch; missing={sorted(expected - actual)}, unexpected={sorted(actual - expected)}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("release", "debug-merged"))
    parser.add_argument("artifact", type=Path)
    args = parser.parse_args()
    count = verify(args.mode, args.artifact)
    print(f"PASS {args.mode}: exact {count}-asset inventory and source bytes (not device acceptance)")
