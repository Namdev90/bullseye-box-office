# SharePass Android

The native staff desk uses the hosted register for deposits and pickup. It supports a booth setup code, the current booth name, idempotent pickup recovery and receipt-bound lookup when the server requires it. The owner sign-in opens the Site in the browser. The packaged WebView practice screen is a separate synthetic mode.

## Build and test

Use JDK 21, Android SDK platform 37.0 and build tools 36.0.0. From this directory:

```sh
npm test
./gradlew :android-app:assembleRelease :android-app:lintRelease
```

`npm test` stays portable and does not require Java. CI's Java stage also
generates four fixtures from the exact production updater/inset/staff-inbox methods and runs
them with deterministic fake Android values and queues. To run those fixtures
locally with a JDK, from this directory:

```sh
fixtures=$(mktemp -d)
node tools/prepare-source-harnesses.mjs "$fixtures"
javac -d "$fixtures/classes" android-app/src/main/java/in/sharepass/foundation/DeskGeometry.java "$fixtures"/*Test.java
java -cp "$fixtures/classes" in.sharepass.foundation.AppUpdatesFocusTest
java -cp "$fixtures/classes" in.sharepass.foundation.DeskWindowInsetsTest
java -cp "$fixtures/classes" in.sharepass.foundation.NativeLookupTest
java -cp "$fixtures/classes" in.sharepass.foundation.StaffMessageInboxTest
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

Shared native code imports `Consumer` and `FileProvider`, so AndroidX Core is an
unconditional `implementation` dependency, independent of Firebase. The pinned
`core:1.8.0` matches the existing runtime requirement in the official
[window-java 1.5.1 Gradle metadata](https://dl.google.com/dl/android/maven2/androidx/window/window-java/1.5.1/window-java-1.5.1.module).
Window's runtime-only dependency does not put Core on the app's compile
classpath. Firebase remains opt-in and release-only; keep both clean CI build
configurations when changing dependencies.

Published Android versions and tags identify fixed APK bytes. Source integration
does not replace or republish those APKs. Any changed signed release needs a new
version/tag and a versionCode higher than every published build through the
protected release process. Preserve the builder's current version in test-only
changes.

Use `gradlew.bat` on Windows. The release build above is unsigned. The public clone uses `https://sharepass.example.test` for its register origin and neutral artwork.

For a private build, set `-PsharepassOrigin=https://your-authorized-site.example`. Pass `-PsharepassArtwork=/private/path/approved-logo.jpg` to use the exact approved JPEG for the release artwork and launcher icon. The build copies it only into generated output; public source assets remain neutral. Optionally set `-PsharepassFirebaseConfig=/path/to/google-services.json` for the approved Firebase Android client. Use the private release workspace to provide the approved artwork and sign with the established SharePass review certificate. Keep the Firebase configuration, keystore, credentials and APKs out of Git.

See the [release workflow](../docs/sharepass-release-workflow.md) for alignment, signing and distribution. The public CI build does not touch a phone or contact the live register.

### Staff message inbox

The Staff messages button lists the pending messages returned by the server, including ones deferred with Later or Back. The server currently returns the oldest 20; pagination beyond that batch is not provided. Select any listed message to reply; closing the list or a message sends nothing. Automatic prompts still show each message once per session, avoid unfinished code entry, and respect pending custody recovery and handovers. Selection and reply callbacks recheck session, foreground, busy state, current screen, custody, and expiry. The exact-source JVM fixture covers deferred-message access and stale/cancelled callbacks, but does not certify Android rendering, accessibility, or physical device behavior.

### Staff workflow and scanning

Deposit opens the reusable booth QR from authenticated context, with a scoped local fallback cache, and shows the queue below it. Collect debounces a complete four-digit code; a camera scan can supply the same code and an existing receipt reference. The scanner decodes on device. Setup requests camera and notification permissions through Android and remains usable with typed codes when permission is declined. History reads booth-scoped recent deposits and independent pending handovers.

Physical handover is still explicit: staff review counts, reserve the verified deposit using its server-issued claim and version, then confirm the real handover. No physical packet-label text entry is required. A historically reused code may still require its current receipt reference; scanning a compatible SharePass WhatsApp QR supplies that reference.

Update checks and verified downloads run while the app is open and idle. The FCM variant can also receive a generic release notice on the `app_updates` channel. Notice data never determines an APK URL or installation authority: opening it checks the signed update feed, and Android still confirms installation. A push delivery, camera permission prompt, branded rendering, and real device upgrade require device acceptance; source fixtures do not establish those outcomes.
