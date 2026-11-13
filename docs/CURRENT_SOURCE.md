# SharePass source and release record

## Recording review · 13 November 2026

The recording review produced hosted web v29 and an Android 0.9.14 / version code 24 candidate. Web v29 is published from protected Sites commit `3773e5b1fa38cd6b810a453bb811b7c68c373fd8`; its response header reports 29. The source below mirrors the implementation with neutral public assets and synthetic catalogue inputs.

The update simplifies staff pairing, keeps the stable deposit QR and queue together, prevents duplicate depositor/collector contacts, advances completed contact details, polls guest receipts automatically, prefills pickup contacts, rotates memorable collection codes, removes manual packet-label entry, and adds History with independent pending handovers. Verified server packet binding, stale-version protection, request recovery, and explicit physical-handover confirmation remain in place. Branding uses the approved artwork in the protected release, with black, red and silver controls.

The device registry records reported app version, notification state and last seen. New signed Android releases can announce themselves through a signature-verified, publication-verified, bounded and deduplicated webhook. Release notices trigger signed-feed verification; they do not authorize installation.

Verification covered 249 hosted tests against both protected and sanitized builds, a synthetic browser deposit/rotation/pickup/history/setup flow, private Android assembly and lint (zero errors), native policy/harness checks, and exact artwork/asset/alignment checks. A protected register snapshot of 17 tables and 31 rows restored successfully; both additive migrations preserved every existing row. No physical phone test or live push-delivery test was performed.

**Android remains unsigned and unpublished.** The private candidate is 1,025,501 bytes, SHA-256 `7ae608e684fee071103093475ee99c2e37426e0850d041641fe38ea27d18aa5b`. It requires the existing review signing key before it can replace an installed app or become a signed update release. No replacement identity was created. The published Android channel remains 0.9.13 / version code 23.

## Source map

| Location | Purpose |
| --- | --- |
| `hosted/` | Current browser desk, guest form and receipts, Cloudflare Worker, D1 migrations and synthetic tests. |
| `android/` | Current native staff app, package `in.sharepass.foundation`, and its isolated local practice interface. |
| `app.py`, `static/`, `public-demo/` | Earlier loopback register and disposable demo. They remain available for practice and historical reference. |

Public source uses a neutral logo, a synthetic code catalogue, a placeholder Android origin, and a Sites configuration without a project ID. The protected release workspace supplies the actual artwork, catalogue, service configuration and signing inputs. Review package and production database bytes are excluded.

The legacy static demo is also unbound. Its old project identifier remains in public Git history and is not an authentication credential. The current template omits it so a normal build cannot target the live register by accident.

## Verified history

- [PR #2](https://github.com/Namdev90/bullseye-box-office/pull/2) merged the repository handbook and documented the older practice implementation. The pre-import main commit was [`af699780`](https://github.com/Namdev90/bullseye-box-office/commit/af699780fa8912591e0420876a24747f6b1510b7).
- [PR #1](https://github.com/Namdev90/bullseye-box-office/pull/1) is a separate local emulator bridge, using Android package `in.sharepass.sharedpreview`. Its [CI succeeded at `6e984e9`](https://github.com/Namdev90/bullseye-box-office/actions/runs/42422797430). It was still open at this audit and is outside the current app release.
- The live web v17 migration followed a verified register backup. Local D1 testing preserved 150 old records and accepted 7,000 additional synthetic deposits. A separate private Chrome test verified staff push and Refresh / reconnect. The current source adds consented guest receipt alerts, code policy administration, receipt-bound code reuse, and owner password activation. Code reuse remains off by default.
- Web v18 was published from Sites source `b2fc00f0c712830d5aea7f69fe5b11b68577db0c`. The live alias served the exact version after a same-version retry. Backup and restore verification covered all 22 existing live tables, and the rollout preserved them.
- Android 0.9.4 completed a synthetic deposit and pickup on the live test booth, received background push, and passed reconnect recovery. Android 0.9.5 added automatic retry after an ambiguous pickup reply and the active booth name. The later phone retest was skipped at the owner's request.

## Android review artifacts

The review channel uses the same development signing certificate for in-place upgrades. It is separate from any store release.

| Version | Version code | APK SHA-256 | Evidence |
| --- | ---: | --- | --- |
| 0.9.5 | 15 | `361bbc0451a018f0801e4043b391d5c8710f0b857130835e1549688d51eac781` | Released through the private download channel. Package, signature and signing compatibility with 0.9.4 verified. |
| 0.9.6 | 16 | `7eccd3546985b03d48c91d23aa0d9f533e5aeaca7cdf638e7e22aebafb8afa18` | Owner-only download verified after distribution. Alignment, v2/v3 signatures and downloaded APK bytes checked. Receipt-reference entry and first-party owner sign-in included. Phone and emulator upgrade checks were not performed. |
| 0.9.7 | 17 | `889ff35ae17d1e3dcbbd78e895cefbd3b74f53cba60a8dc7082db96b17857eac` | Owner-only download matched the reviewed APK. Android window adaptation and adaptive web source are covered below. Physical device and in-place upgrade checks were skipped. |

Certificate SHA-256 for the review channel: `0a8b400966fd754c6db2b33b94f78c9898803aff37718fa34c34aef77b642c12`.

## Release boundaries

CI checks code, fixtures and unsigned builds. Hosted deploys and signed Android distribution require a separate approved release and readback. A passing fixture suite does not establish real phone behavior, production push delivery, cloud capacity or event readiness. Deferred design choices and physical-device checks remain separately tracked. The [release workflow](sharepass-release-workflow.md) describes how to record and verify subsequent releases.

The v19 backend candidate includes the `X-SharePass-Version: 19` response header so release checks can distinguish the new worker at the live alias. An authorized native device can reconcile the exact previously completed handover without a new stock mutation or guest notification. A delayed release retry for already handed-over stock tells staff that the handover was already confirmed. Confirmed guest receipts and their opted-in alerts remain available for the active code lifetime, including extensions.

## Adaptive source

The v20 web and Android 0.9.7 source adapt to the usable app window. The web keeps controls inside reported safe areas, avoids a reported fold hinge, and stacks the register when the content area is narrow. Android uses current window insets and fold geometry to keep controls and QR previews in a usable area without restarting the staged workflow. Local verification covered Chromium and WebKit at phone and laptop sizes, Chromium cutout and fold overrides, long content, and native geometry fixtures. Physical curved-screen and foldable hardware checks remain open.

## Platform and updates source

Web v22 adds the staff browser install manifest and a Digital Asset Links statement for Android setup. Android 0.9.8 uses the verified HTTPS setup path and retains the earlier setup fallback. Its opt-in update check runs while the app is active, verifies the signed manifest and exact APK, and hands installation to Android. Historical APKs remain archive-only for the update feed. The [release workflow](sharepass-release-workflow.md) verifies the approved artifact before publication. The source record does not establish hosted App Link verification or a device upgrade.
