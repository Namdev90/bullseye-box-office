# CI verification (8 November 2026)

Repository: `Namdev90/bullseye-box-office` — draft PR #1, feature branch `feature/sharepass-shared-local-emulator-20261108`.

[Successful run](https://github.com/Namdev90/bullseye-box-office/actions/runs/42422459173) confirms both jobs succeeded:

- `backend-and-frontend`: Python HTTP/API tests, Node state-machine tests.
- `android-emulator-build`: Java URL allowlist regression test, Android API 36 / Build Tools 36 SDK preparation, Gradle 9.6, Android debug APK built and published as an Actions artifact.

The resulting debug APK was retrieved from artifact 13593923553 and is included in the downloadable 0.3.1 source bundle. The debug APK is for development use only; no production signing/key or update channel exists.

**Not verified:** interactive Android emulator runtime, physical device runtime, browser pixel/layout QA (Chromium launch was blocked by administration), public website-to-phone synchronization, user authentication, live guest data, backups/restores in production, or real event release. Do not use this preview for actual custody.
