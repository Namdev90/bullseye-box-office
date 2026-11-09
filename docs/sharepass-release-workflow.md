# SharePass checks and releases

The repository contains the legacy prototype at its root, the hosted worker in `hosted/`, and the Android app in `android/`. The SharePass CI workflow runs on pull requests and pushes to main when the hosted source, Android source, legacy Site template, or workflow changes. It can also run on demand. It uses a read-only repository token, synthetic Firebase configuration and an unsigned Android build. Deployment and distribution happen separately after approval. Build approved releases from the protected release workspace with the approved artwork and code catalogue. The public repository contains fixture versions of those inputs.

## Hosted website

1. Run SharePass CI against the reviewed source.
2. Validate the candidate against synthetic records in an owner-only Site. Check receipt privacy, stock custody and recovery, and run any new D1 migrations there first.
3. With approval, back up the live register and verify the restore before promoting the exact reviewed Site build. Verify live access and the new version after publishing.
4. Keep the Sites deployment credential, owner password secret, Firebase sender credential and VAPID private key in their respective private stores. The public Site template and CI build use test configuration.

## Android APK

1. Build and lint using the approved HTTPS Site origin and Android Firebase client configuration from the release workspace. Use `-PsharepassOrigin` and `-PsharepassFirebaseConfig` when building from the public repository.
2. Align and sign the APK locally with the approved signing identity for its channel. Keep keystores, passwords and server credentials outside the public repository, workflow logs and artifacts.
3. Verify the package name and version with `aapt dump badging`. Check alignment with `zipalign -c -P 16 4`, verify signatures with `apksigner verify --verbose --print-certs`, and record the APK SHA-256. Compare the signing certificate with the previous build in the same channel to verify upgrade compatibility.
4. With approval, upload only the verified APK to the existing owner-only SharePass Drive folder. Verify the uploaded file name, size and permissions before sharing its download link with the owner.

The private review channel uses the existing development signing identity. A Google Play rollout requires a separate approved signing and upload plan. A Play app signed with a different identity cannot replace the installed review APK in place. [Android app signing](https://developer.android.com/studio/publish/app-signing)
