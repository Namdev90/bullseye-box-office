#!/usr/bin/env sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
OUT="$ROOT/.native-policy-classes"
mkdir -p "$OUT"
javac -d "$OUT" "$ROOT/android-app/src/main/java/in/sharepass/foundation/AssetPolicy.java" "$ROOT/tests/java/in/sharepass/foundation/AssetPolicyTest.java"
java -cp "$OUT" in.sharepass.foundation.AssetPolicyTest
