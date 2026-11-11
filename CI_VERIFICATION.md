# CI verification (8 November 2026)

Repository: `Namdev90/bullseye-box-office` — draft PR #1, feature branch `feature/sharepass-shared-local-emulator-20261108`.

[Successful run](https://github.com/Namdev90/bullseye-box-office/actions/runs/42422459173) confirms both jobs succeeded:

- `backend-and-frontend`: Python HTTP/API tests, Node state-machine tests.
- `android-emulator-build`: Java URL allowlist regression test, Android API 36 / Build Tools 36 SDK preparation, Gradle 9.6, Android debug APK built and published as an Actions artifact.

The resulting debug APK was retrieved from artifact 13593923553 and is included in the downloadable 0.3.1 source bundle. The debug APK is for development use only; no production signing/key or update channel exists.

**Not verified:** interactive Android emulator runtime, physical device runtime, browser pixel/layout QA (Chromium launch was blocked by administration), public website-to-phone synchronization, user authentication, live guest data, backups/restores in production, or real event release. Do not use this preview for actual custody.

## Draft PR #3: Android backup-policy hardening

The preceding PR #1 evidence is historical. The integration parent `1f361b56d27dcb0d19fb642890191a8ff77e153e` passed [all three jobs](https://github.com/Namdev90/bullseye-box-office/actions/runs/42714928046), but its lint diagnostics still reported the missing Android 12+ extraction policy.

The follow-up patch adds explicit cloud-backup and device-transfer exclusions and two Python XML contract tests. Local verification: 50 Python tests, 23 local UI-state checks, 20 disposable demo checks, 12 tactile-flow checks, 5 practice-code checks, all JavaScript syntax checks, JVM origin/request policy tests, and `git diff --check`. These are source/model checks, not backup/restore execution. Exact-head Android lint/debug build, Windows launcher and backend/frontend CI evidence is pending publication and must be checked before accepting this patch. No Android SDK or Windows runtime was available in this cloud checkout.

See [policy scope and reconciliation gates](docs/CLOUD_RECONCILIATION.md#android-backup-and-device-transfer-policy). PR #3 stays draft; laptop reconciliation, interactive browser/emulator tests, signed phone build, safe hosting and device backup/transfer validation remain outstanding.
