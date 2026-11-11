# Cloud integration and laptop reconciliation

## Scope and provenance

This branch combines main `af699780fa8912591e0420876a24747f6b1510b7` (merged documentation PR #2) and remote feature head `6e984e97361dac1a5e35a28b13d055b5139d6ef3` (draft PR #1). It is a separate integration proposal. Neither PR #1 nor its branch is rewritten, closed or superseded.

The integration was developed in a fresh cloud checkout. The laptop was not accessed or modified. Earlier laptop work reportedly contains uncommitted fixes for the same five issues. Its content and tests have NOT been verified in this checkout. Do not overwrite, reset, clean or blindly cherry-pick over that work when the laptop reconnects.

Only README.md conflicted during integration: preserve main's complete handbook-linked README, add a current integration entry point, and retain the feature branch's source, latest ticket lockup, ticket mark, CSS and Android icon. The public browser-only demo is unchanged. Historical documentation remains dated evidence, not a claim that this new head was tested on hardware.

## Confirmed fixes and known overlap

| Area | Remote defect and cloud change | Laptop comparison required |
| --- | --- | --- |
| WebView requests | GET-only interception blocked required POST fetches. Shared, tested policy now permits GET/POST only at the exact emulator origin. | MainActivity.java, DeskOriginPolicy.java and policy tests |
| Request IDs | randomUUID absent at insecure 10.0.2.2 HTTP origin. Cryptographic getRandomValues UUID v4 fallback, no weak random fallback. | static/app.js and UI tests |
| Android 16 Back | Deprecated onBackPressed alone missed modern Back dispatch. API 33+ callback routes through existing pending-write protection, unregisters on destroy; legacy override retained. | MainActivity.java and AndroidManifest.xml |
| Windows launcher | Expanded errorlevel inside nested block skipped python fallback. Runtime IF ERRORLEVEL checks replace both expansions. | Start-SharePass.cmd |
| Shared refresh | Old timer/focus handlers duplicated reads and bypassed guards. One 4.5-second timer and one focus handler share visibility/busy/pending/welcome guards. | static/app.js and UI tests |

Additional cloud coverage includes Windows CI running the actual launcher with only Python on PATH, source wiring contracts, and Node tests for modern/fallback/missing randomness, one timer/focus listener, safe background reads and Back handling.

## Verification and readiness gates

Cloud local checks: 48 Python tests, 23 local UI-state checks, 20 disposable demo model checks, 12 tactile-flow checks, 5 practice-code checks, all JavaScript syntax checks, and JVM request/origin/navigation policy tests pass. Node/source checks are not Android runtime verification.

The workflow builds an emulator-only debug APK and exercises Windows fallback on GitHub Actions. Check the exact PR head and workflow run before accepting CI evidence; old runs in CI_VERIFICATION.md are not evidence for this branch. Debug build success is not signed-release or physical-phone readiness.

Not verified here: interactive browser rendering, Android emulator runtime (including Android 16 gesture/hardware Back during an uncertain mutation), physical phone behavior, Windows double-click UX, or laptop overlap reconciliation. No SDK/emulator is installed in this cloud checkout. No signing, production deployment, hosting, authentication, messaging or photo-service changes were made.

Before any user-test-ready claim:
1. Preserve and compare the laptop working tree and its five overlapping fixes against this branch, including branding/assets and newer user work.
2. Review exact-head CI, then run interactive browser/emulator cross-client deposit, verify, release, recovery and handover tests using synthetic data.
3. Agree the test path: an Android emulator can use host loopback; a physical phone cannot use 10.0.2.2. A signed phone build and safe hosted/authenticated service are separate work, not supplied by this integration.
4. Keep this PR draft until the reconciliation and test path are reviewed.

This remains a synthetic shared local preview, never real multi-counter custody.

## Android backup and device-transfer policy

The Android wrapper enables WebView DOM storage for original-tab interrupted-mutation recovery and first-party cookies for the local Python session. WebView may persist profile data inside the app's private root. The authoritative SQLite database and verification key remain on the desktop running Python, not in this APK. Neither that desktop storage nor the disposable browser demo is changed by this policy.

`AndroidManifest.xml` retains `allowBackup="false"` and `fullBackupContent="false"` for the legacy backup opt-out and now references `res/xml/data_extraction_rules.xml` for Android 12+ cloud backup and device transfer. Both transports exclude `.` in every supported domain: root, files, databases, preferences, app-specific external files, and the four device-protected counterparts. Separate domain exclusions are intentional: a root exclusion alone does not cover every named domain. This also covers future app files without depending on WebView implementation-specific filenames. No backup agent, permission or lint suppression was added.

These are transport exclusions, not storage deletion or an in-app storage ban. Existing DOM storage, cookies, interrupted-operation recovery and desktop offline data remain unchanged while using the app. Android cache, code-cache and no-backup directories are already excluded by the platform. Reinstalling, clearing app data or moving to another device must not be treated as preserving the original operator's session/recovery state; reconcile pending physical handovers separately.

Limits: manifest/resource contracts and Android lint/build can validate wiring and compatibility, not OEM compliance. Android documents that some manufacturers ignore `allowBackup=false` for device transfer, which is why explicit transfer exclusions are supplied. This is not a guarantee against privileged/root extraction, nonconforming OEM migration, manual exports, or copies that already exist. No real backup, restore, transfer or device tests were performed. The policy does not implement encrypted backups or change the desktop database retention policy.

References: [Android backup opt-out and Android 12+ rules](https://developer.android.com/identity/data/autobackup), [data-extraction-rules format](https://developer.android.com/guide/topics/data/autobackup#xml-syntax-android-12), and [manifest backup attributes](https://developer.android.com/guide/topics/manifest/application-element#allowbackup).
