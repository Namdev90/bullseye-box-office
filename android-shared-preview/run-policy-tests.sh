#!/usr/bin/env bash
set -euo pipefail
mkdir -p build/policy-test-classes
javac -d build/policy-test-classes app/src/main/java/in/sharepass/sharedpreview/DeskOriginPolicy.java tests/DeskOriginPolicyTest.java
java -cp build/policy-test-classes in.sharepass.sharedpreview.DeskOriginPolicyTest
