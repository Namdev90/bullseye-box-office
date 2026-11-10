# SharePass Android

The native staff desk uses the hosted register for deposits and pickup. It supports a booth setup code, the current booth name, idempotent pickup recovery and receipt-bound lookup when the server requires it. The owner sign-in opens the Site in the browser. The packaged WebView practice screen is a separate synthetic mode.

## Build and test

Use JDK 21, Android SDK platform 37.0 and build tools 36.0.0. From this directory:

```sh
npm test
./gradlew :android-app:assembleRelease :android-app:lintRelease
```

`npm test` stays portable and does not require Java. CI's Java stage also
generates two fixtures from the exact production updater/inset methods and runs
them with deterministic fake Android values and queues. To run those fixtures
locally with a JDK, from this directory:

```sh
fixtures=$(mktemp -d)
node tools/prepare-source-harnesses.mjs "$fixtures"
javac -d "$fixtures/classes" android-app/src/main/java/in/sharepass/foundation/DeskGeometry.java "$fixtures"/*Test.java
java -cp "$fixtures/classes" in.sharepass.foundation.AppUpdatesFocusTest
java -cp "$fixtures/classes" in.sharepass.foundation.DeskWindowInsetsTest
python3 -m unittest discover -s tests -p 'test_apk_assets.py'
```

These fixtures execute current Java control flow for focus/verification order,
cancellation, pause, readiness, permissions, visual insets and gesture hit
bounds. They do not exercise Android callback delivery, actual window layout,
APK verification or the system installer. Source changes that affect the fake
dependencies require a deliberate fixture update; method extraction fails if a
selected signature disappears or becomes ambiguous.

CI builds and lints **unsigned release APKs** with synthetic Firebase and polling
configurations, then checks each packaged asset path and byte against the four
approved source assets. Debug is compiled/linted and its complete merged practice
asset directory is verified, without packaging a debug APK or creating signing
material. Inventory-verifier tests use synthetic ZIPs, not real APKs. On-device
layout, gesture, keyboard, accessibility and installer checks remain separate.

Published Android versions and tags identify fixed APK bytes. Source integration
does not replace or republish those APKs. Any changed signed release needs a new
version/tag and a versionCode higher than every published build through the
protected release process. Preserve the builder's current version in test-only
changes.

Use `gradlew.bat` on Windows. The release build above is unsigned. The public clone uses `https://sharepass.example.test` for its register origin and neutral artwork.

For a private build, set `-PsharepassOrigin=https://your-authorized-site.example`. Optionally set `-PsharepassFirebaseConfig=/path/to/google-services.json` for the approved Firebase Android client. Use the private release workspace to provide the approved artwork and sign with the established SharePass review certificate. Keep the Firebase configuration, keystore, credentials and APKs out of Git.

See the [release workflow](../docs/sharepass-release-workflow.md) for alignment, signing and distribution. The public CI build does not touch a phone or contact the live register.
