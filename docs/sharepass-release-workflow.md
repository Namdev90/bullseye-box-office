# SharePass checks and releases

The repository contains the legacy prototype at its root, the hosted worker in `hosted/`, and the Android app in `android/`. The SharePass CI workflow runs on pull requests and pushes to main when the hosted source, Android source, legacy Site template, or workflow changes. It can also run on demand. It uses a read-only repository token, synthetic Firebase configuration and an unsigned Android build. Deployment and distribution happen separately after approval. Build approved releases from the protected release workspace with the approved artwork and code catalogue. The public repository contains fixture versions of those inputs.

## Hosted website

1. Run SharePass CI against the reviewed source.
2. Validate the candidate against synthetic records in an owner-only Site. Check receipt privacy, stock custody and recovery, and run any new D1 migrations there first.
3. With approval, back up the live register and verify the restore before promoting the exact reviewed Site build. Verify live access and the new version after publishing.
4. Keep the Sites deployment credential, owner password secret, Firebase sender credential and VAPID private key in their respective private stores. The public Site template and CI build use test configuration.

Before deploying the four-digit pickup policy, complete or reconcile any outstanding pickups with letter codes using the current desk. Roll out the compatible web and Android desks together. Reused codes require the current pickup reference and become available only after a fully confirmed handover. Set `SHAREPASS_ALLOW_CODE_REUSE=0` during a staged rollout if staff need more time to switch clients.

## Android APK

1. Build and lint using the approved HTTPS Site origin and Android Firebase client configuration from the release workspace. Use `-PsharepassOrigin` and `-PsharepassFirebaseConfig` when building from the public repository.
2. Align and sign the APK locally with the approved signing identity for its channel. Keep keystores, passwords and server credentials outside the public repository, workflow logs and artifacts.
3. Verify the package name and version with `aapt dump badging`. Check alignment with `zipalign -c -P 16 4`, verify signatures with `apksigner verify --verbose --print-certs`, and record the APK SHA-256. Compare the signing certificate with the previous build in the same channel to verify upgrade compatibility.
4. For an approved public GitHub release, prepare the exact APK and signed update manifest locally. The following command prompts for the keystore and key passwords in the local terminal. Use a folder outside the source checkout for the two public artifacts.

   ```text
   node android/tools/sharepass-release.mjs prepare <signed-apk> <version> <version-code> <approved-apk-sha256> <local-keystore> <key-alias> <output-folder>
   ```

   Use the same command with `inspect` and omit the keystore, alias, and output folder to verify an APK before signing metadata. Use `verify` with the signed manifest path as the last argument to check both files without the private key.

5. With the release approved and GitHub CLI authenticated, run the stage command. It re-verifies both files, uploads only the APK and manifest to a draft named `android-vX.Y.Z`, and starts verification on main. The tag can be created when the verified draft is published.

   ```text
   node android/tools/sharepass-release.mjs stage <prepared-apk> <version> <version-code> <approved-apk-sha256> <signed-manifest> <approved-source-commit> <archive|latest>
   ```

   Use `latest` for the first update-enabled APK, 0.9.8 with version code 18, and later Android updates. Use `archive` for historical APKs. Keep source-only releases out of GitHub's latest slot too. Android uses the signed manifest asset on GitHub's latest release.

6. The **Publish verified SharePass Android APK** workflow checks GitHub's recorded asset digests and the downloaded bytes, the APK identity and signer, and the signature over the update manifest. It publishes the verified draft if all checks pass. Wait for verification before staging another version. If dispatch needs to be retried, run the workflow from main with the approved tag, version code, APK hash and latest setting. Keep the keystore, signing passwords, production exports and runtime credentials outside GitHub.

The direct-download channel uses the existing development signing identity. A Google Play rollout requires a separate approved signing and upload plan. A Play app signed with a different identity cannot replace the installed direct-download APK in place. [Android app signing](https://developer.android.com/studio/publish/app-signing)
