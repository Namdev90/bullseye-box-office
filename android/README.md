# SharePass Android

The native staff desk uses the hosted register for deposits and pickup. It supports a booth setup code, the current booth name, idempotent pickup recovery and receipt-bound lookup when the server requires it. The owner sign-in opens the Site in the browser. The packaged WebView practice screen is a separate synthetic mode.

## Build and test

Use JDK 21, Android SDK platform 37.0 and build tools 36.0.0. From this directory:

```sh
npm test
./gradlew :android-app:assembleRelease :android-app:lintRelease
```

Use `gradlew.bat` on Windows. The release build above is unsigned. The public clone uses `https://sharepass.example.test` for its register origin and neutral artwork.

For a private build, set `-PsharepassOrigin=https://your-authorized-site.example`. Optionally set `-PsharepassFirebaseConfig=/path/to/google-services.json` for the approved Firebase Android client. Use the private release workspace to provide the approved artwork and sign with the established SharePass review certificate. Keep the Firebase configuration, keystore, credentials and APKs out of Git.

See the [release workflow](../docs/sharepass-release-workflow.md) for alignment, signing and distribution. The public CI build does not touch a phone or contact the live register.
