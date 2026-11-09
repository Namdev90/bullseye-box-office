# Verified repository history

[Documentation index](README.md) · [Current design record](../SHAREPASS_RELEASE.md)

Reviewed **9 November 2026 (UTC)** using Git history, current source, open PRs and GitHub Actions metadata. This is a repository history, not a claim that every commit was deployed or formally released. The checked repository has no Git tags and no published GitHub releases. Version numbers in a source bundle or document alone do not establish a tagged release.

## Commits on the reviewed default branch

Default branch `main` ends at `456179176674d8576c4ba25cb8ff3e07853fbbda`. Its eight commits are listed below in chronological order. All were committed on **5 November 2026 UTC**.

| UTC time | Commit | Recorded change |
| --- | --- | --- |
| 08:06:19 | [`0cfbd59`](https://github.com/Namdev90/bullseye-box-office/commit/0cfbd59743b47810b03793611fc71399642c7d69) | Initialized the public training prototype with safety/setup README. |
| 08:06:39 | [`73e6364`](https://github.com/Namdev90/bullseye-box-office/commit/73e63640c29c77b66b9bc2f6c2d50e48dedb77f5) | Added the offline single-laptop custody application, static UI and regression tests. |
| 08:41:53 | [`cc1fe75`](https://github.com/Namdev90/bullseye-box-office/commit/cc1fe755e54cbe2ae6fe7bc37e1e3c821e8655aa) | Introduced shared physical-pass codes, mixed-category atomic partial collection, recovery and revised verification UI. The older named-collector database is not reusable with the current schema. |
| 08:59:04 | [`127faf3`](https://github.com/Namdev90/bullseye-box-office/commit/127faf3f713100d1f8ab893738ed64ed1989c49d) | Made private verbal/on-screen code sharing the supported fallback and documented NFC as future-only. |
| 15:18:28 | [`a1bd393`](https://github.com/Namdev90/bullseye-box-office/commit/a1bd39370976e992b0485e6bc6489cc3e93d654d) | Redesigned the desk for custody/partial pickup, added reference documentation and checked in the separate disposable `public-demo/` source and tests. |
| 15:20:36 | [`b06f800`](https://github.com/Namdev90/bullseye-box-office/commit/b06f80014a1f26aae2be8c82ec7cdd2cc04f2373) | Adjusted logo presentation in the local and public stylesheets. |
| 15:29:27 | [`b76282e`](https://github.com/Namdev90/bullseye-box-office/commit/b76282ef1a7ac37165be6398d4a006fe721dbf34) | Replaced the promotional layout with a compact register-first desk and improved bounded-body HTTP rejection handling. |
| 16:22:04 | [`4561791`](https://github.com/Namdev90/bullseye-box-office/commit/456179176674d8576c4ba25cb8ff3e07853fbbda) | Added tactile SharePass styling, fictional Oktoberfest practice fixture, four-character public-demo codes, interrupted-workflow checks and future requirements. The Python service retained long codes. |

`style/quiet-verification` also points to `127faf3`; that work is already an ancestor of `main`, not another unmerged implementation.

## Separate unmerged Android/emulator work

At review time, [draft PR #1](https://github.com/Namdev90/bullseye-box-office/pull/1) is open from `feature/sharepass-shared-local-emulator-20261108` to `main`, at head [`6e984e9`](https://github.com/Namdev90/bullseye-box-office/commit/6e984e97361dac1a5e35a28b13d055b5139d6ef3). It remains separate from this documentation branch.

The branch adds a loopback-backed Android-emulator WebView project, an explicit emulator Host alias, safe website refresh, new SharePass art, a Windows launcher and CI. It does not make physical phones or the public static Site synchronize with the local database.

Its seven additional commits were committed on **7 November 2026 UTC** (8 November in the author timezone, UTC+05:30):

| Commit | Recorded change |
| --- | --- |
| [`33d1929`](https://github.com/Namdev90/bullseye-box-office/commit/33d19298474b103665ae40be02828e3e6bc8d1f3) | Added shared local desk/emulator bridge and latest logo. |
| [`e9bd0b1`](https://github.com/Namdev90/bullseye-box-office/commit/e9bd0b1ce67da5e32d80e8ca9b4b3eea571856f3) | Added backend/frontend and emulator debug-APK CI. |
| [`34ef3ed`](https://github.com/Namdev90/bullseye-box-office/commit/34ef3ed468c9ee6c45f7b4babf887c8b66114853) | Restored Gradle wrapper distribution properties. |
| [`67a3c88`](https://github.com/Namdev90/bullseye-box-office/commit/67a3c88a3d655c34b6de54e8441337f233d11321) | Switched Android build configuration to API 36. |
| [`e4002df`](https://github.com/Namdev90/bullseye-box-office/commit/e4002dfa1850a311b310345d0fe346ae8402b920) | Required API 36 SDK setup in CI and failure if unavailable. |
| [`21b76c8`](https://github.com/Namdev90/bullseye-box-office/commit/21b76c8e82c2394941602d34acfdb50ab2056c16) | Documented API 36 requirements. |
| [`6e984e9`](https://github.com/Namdev90/bullseye-box-office/commit/6e984e97361dac1a5e35a28b13d055b5139d6ef3) | Recorded successful Android CI artifact and remaining test limits. |

The PR's original description says the Android SDK build was not run, but later branch documentation and [Actions run 42422459173](https://github.com/Namdev90/bullseye-box-office/actions/runs/42422459173) record a successful build. The run metadata was independently checked: **completed/success at `21b76c8`**, not the later documentation-only head. This is compilation/automated-check evidence, not interactive emulator or physical-device verification. Artifact availability can change with retention; this handbook does not promise an installable download.

For branch-specific details, read the snapshot [START_HERE.md](https://github.com/Namdev90/bullseye-box-office/blob/6e984e97361dac1a5e35a28b13d055b5139d6ef3/START_HERE.md) and [CI_VERIFICATION.md](https://github.com/Namdev90/bullseye-box-office/blob/6e984e97361dac1a5e35a28b13d055b5139d6ef3/CI_VERIFICATION.md). Their reported live emulator/device tests remain not run, and their browser smoke attempt was blocked. Do not import their claims into the reviewed `main` test counts.

## Existing records and unresolved scope

- [SHAREPASS_RELEASE.md](../SHAREPASS_RELEASE.md) records the 5 November tactile design and its original validation.
- [TEST_REPORT.md](../TEST_REPORT.md) preserves prior automated/browser scenarios and known limits. A historical pass is not a fresh certification.
- [REFERENCES.md](../REFERENCES.md) and [OKTOBERFEST_SOURCES.md](../OKTOBERFEST_SOURCES.md) distinguish observed references, asset permissions and fictional event material.
- [FUTURE_FEATURES.md](../FUTURE_FEATURES.md) records deferred photos, retention, shared authority, booth identifiers and notifications. None is made implemented by appearing in a plan.
- No production deployment, software licence, trademark clearance, load capacity or live-event readiness is inferred from this history.

When this documentation is updated after a merge, verify the new tree and PR state first. Preserve the dated snapshot rather than silently rewriting unmerged work as though it had always been on `main`.
