# SharePass — shared local integration

> Current cloud integration: see [reconciliation and verification gates](docs/CLOUD_RECONCILIATION.md). Laptop overlap and interactive testing remain outstanding; do not use an older bundled APK to validate this head.

**Status:** integrated local preview tested against one authoritative SQLite database. Not a production service, public deployment or signed Android release. **Synthetic passes and labels only.** The existing public browser-only SharePass demo remains separate and is intentionally not connected to a real custody database.

## What changed

* The existing Python 3.10+ `app.py` is the authoritative backend. Both a laptop website and an Android **emulator** WebView connect to that same Python process and SQLite database. No extra Python packages, second database or fake client-side store are required.
* The backend socket **still binds to `127.0.0.1` only**. `--android-emulator` permits the Android emulator's special `10.0.2.2` Host alias, but neither a physical phone nor a remote internet browser can connect. All other Host values still fail closed.
* The website now refreshes the shared records every 4.5 seconds when visible and not handling a pending/uncertain mutation. It never auto-confirms a handover or replays a release. Open packet screens invalidate stale verified claims.
* The new SharePass visual system uses the latest 5 November 2026 image (`SharePass ticket handoff with matched dots.png`) with an alpha background, a derived original-ticket mark, black/metallic-silver/crimson surfaces and readable category/validation states. The actual composed lockup appears in the welcome screen; smaller derivative ticket mark appears in the desk UI and Android icon.
* A **separate** Android Gradle project in `android-shared-preview/` opens the Python desk at `http://10.0.2.2:8765/`. Only this emulator loopback HTTP host is allowed in Android Network Security Config; no unrestricted internet, native JS bridge or non-desk web navigation. It accepts the same-site HttpOnly session cookie and enables sessionStorage for interrupted-action recovery.

## Run desktop website

Use an existing Python 3.10 or newer installation. No installation, environment modification, reboot, tunnel or permission bypass.

Windows: double-click `Start-SharePass.cmd`, or in PowerShell/Command Prompt from this folder:

```powershell
py -3 app.py --android-emulator
```

Other systems:

```sh
python3 app.py --android-emulator
```

Open **http://127.0.0.1:8765/** on the same laptop. Select a made-up staff label. Create a synthetic deposit and write down its private 12-character code. **Do not use the older four-character `K7M4` practice code** in this shared backend.

Data persists under `_runtime/shared-code-training.sqlite3`, with a secret matching `.verification.key` file. Do not publish, delete or separate the key from the database. Reopening with the same key/database preserves records. Example synthetic events expire seven days after first database creation; use a **new named synthetic testing database** for fresh testing, never reset a real ledger.

## Run Android emulator sharing the same database

Requires an Android Studio virtual device (Android Emulator, not a physical phone), the *already existing* Gradle-compatible Android SDK platform 36, JDK 21, Gradle wrapper and build dependencies. A historical GitHub Actions build passed for earlier source. For this branch, use only the debug artifact from a successful workflow run matching the exact current commit; no APK is committed here. This analysis container itself has no Android SDK; no local SDK was installed. No paid tools and no software installation performed.

1. Start the Python server with `--android-emulator` on the host laptop. Check that `http://127.0.0.1:8765/` works.
2. Start an Android **emulator** in Android Studio. Download the current-head debug APK from its successful Actions run and install it on the emulator (drag it onto the emulator, or use `adb install -r /path/to/app-debug.apk`). Alternatively open `android-shared-preview/` in Android Studio to rebuild its debug variant. Keep it separate from Navrang and the older 0.2.0 offline APK.
3. Its WebView loads `http://10.0.2.2:8765/`, which Android Emulator maps to the host loopback server. Enter a separate made-up staff label, then compare balances and records in Android and laptop website.
4. Test a synthetic deposit on desktop, collect on emulator, confirm handover on desktop and re-open the history on both. If the Python server is down, **do not hand over passes**; restart with the same database + key and reconcile pending requests.

The `android-shared-preview` project is not an APK. The older `SharePass-0.2.0-Local-Preview.apk` is an **offline mock** and will not sync. A physical phone cannot reach 10.0.2.2; do not enable LAN binding, developer tunnels or arbitrary cleartext to work around this.

## Test evidence

```sh
python3 -m unittest discover -s tests -p 'test_*.py' -q
node tests/ui_state_test.cjs
cd android-shared-preview && ./run-policy-tests.sh
```

Results on 8 November 2026: **45 Python tests PASS** (including real HTTP requests from both Host aliases, partial collection, idempotency, fail-closed origin and CSRF); **18 Node state-machine checks PASS**; **Android origin allowlist JVM test PASS**. A Chromium smoke run was attempted but was blocked by the execution environment (`ERR_BLOCKED_BY_ADMINISTRATOR`). Android SDK **compilation passed** on GitHub Actions (workflow run `42422459173`); live Android emulator/device UI testing was **not run**.

## Required work before a real website + phone can sync anywhere

This local preview deliberately does **not** make `bullseye-pass-desk-demo.namubhai.chatgpt.site` a live custody system. That public Site is a disconnected four-character-code browser demonstration. To run real multi-counter operations, the team still needs: a privately hosted HTTPS API, production staff authentication and role permissions, a transactional centralized database with backup/recovery and retention policy, server-side rate limits and auditing, real event configurations, production code/credential lifecycle, signed independent Android release, real device testing, and an approved incident/physical reconciliation procedure. Do not place the training SQLite server on public internet. Protect and migrate the original local synthetic database only by authorized backup and planned migration.

No messaging, photos, refunds or guest identity data are sent or processed by this integration. Approved Bullseye master art licensing and usage still require verification before a public commercial release.
