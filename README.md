# SharePass — brought to you by Bullseye Entertainment

**Practice only; not production-ready.** See SHAREPASS_RELEASE.md for the latest tactile design, fictional Oktoberfest 2027 hosted fixture, and four-character public-practice codes. The local custody engine below retains its original long-code security model.

A staff-only, **single-laptop prototype for physical event passes**. A depositor who is already inside leaves their friends' passes at the box office. Staff count them, store one packet, and issue one private collection code. Different friends can later use that same code to collect some or all remaining Normal, VIP and VVIP passes.

**Use synthetic data only.** This is not a ticket issuer, admission scanner, identity system or live-event deployment. Digital tickets should be shared through their issuer, not deposited here. There is no default named collector or ID check. The source repository is public; the app and its runtime records stay local.

The redesigned interface puts collection and deposit first, with labeled category balances, phone packet cards, a searchable custody register and deliberate handover confirmation. The authentic GEVA-hosted Bullseye logo is used with the user's explicit permission for this public demo. Current-master status and a general asset/software redistribution licence are not claimed. See REFERENCES.md and TEST_REPORT.md.

## Run locally

Python 3.10 or newer is required. No third-party runtime packages or installs are needed.

```sh
python3 app.py
```

On Windows use `py app.py`. Open the printed address, normally `http://127.0.0.1:8765`, in Chrome on **the same laptop**. Choose a synthetic staff label. The two demo events start empty and expire seven days after the database is first created. There is deliberately no event-editing or reopening endpoint.

Optional `--demo` creates three synthetic inventory examples. Their private codes are not printed in the console or shown in admin inventory. To try collection, make your own new synthetic deposit and privately share its displayed code.

Data persists in `_runtime/shared-code-training.sqlite3`. A separate matching `.verification.key` file is essential to verify/recover codes. Do not delete, replace, publish or separate that key from its database backup. Do not reuse the earlier named-collector demo database; this is a new schema and has no migration path.

The server binds to loopback only. Do not change it to a LAN/public address, expose a tunnel, publicly deploy the app, or operate independent copies of the inventory.

## Staff workflow

1. Choose the correct demo event. Create a deposit with the physical counts for **Normal, VIP and VVIP**, a fresh shelf slot, and the staff label. No guest name or phone is required.
2. Count and place the passes together in that slot, then confirm custody. Write the generated public **packet ID** on the envelope. Do not put the private collection code on a publicly visible label.
3. **Show the code privately or read it quietly** to the depositor in its three `XXXX-XXXX-XXXX` groups. Ask them to repeat it back correctly before closing the screen, then share it only with trusted friends. There is no printed receipt. Avoid shouting it where a queue can overhear or exposing it to shoulder-surfers. The code is not available from ordinary inventory or audit screens.
4. At collection, staff select the event and enter the private code. Its verification works offline while the local server is running. Search by packet, shelf or staff label is administrative lookup only and cannot authorize a new release.
5. Choose exactly how many of each category this friend collects. Retrieve the packet and enter its physical packet ID. **Record selected release before physical handover.** The quantities are subtracted atomically; the rest remain available under the same code.
6. Hand over those recorded quantities exactly once, then **Confirm physical handover**. The final Verified screen states what was handed over and what remains. A pending handover blocks another collection from that deposit until reconciled.

One shared code is a **bearer credential**: anyone holding it can collect any or all remaining quantities. It does not assign a quantity or category to an individual friend. A stolen, forwarded or photographed code can drain the balance. Code strength cannot solve this social risk. Production policy must explicitly accept it or add separate per-friend credentials/allocations. A lost code is a supervisor exception; packet ID alone is not sufficient. No code replacement, revocation, cancellation or allocation editor is implemented.

### Optional WhatsApp handoff

On the new-deposit code screen, a staff member can enter a demo phone number with country code and **Preview message locally**. Nothing is sent. A separate **Open WhatsApp to review** link explicitly shows the recipient and exact text first. Clicking it passes that phone number and bearer code to WhatsApp; the staff member still must review and manually send there.

Phone and code stay only in the open browser code screen, not database, audit, local storage or recovery storage. Closing that screen clears them from the app's memory and DOM. An opened WhatsApp URL may remain in browser/service history, so it is a deliberate data-sharing step. This demo does not detect delivery or send, queue, retry or automate messages. Do not open it with a real recipient or production code during testing.

**No reception:** show or tell the code privately in person; use a read-back to catch mistakes. No attendee app, website or printed receipt is required. The depositor must have a way to get the code to arriving friends. Opening a draft offline is not delivery. If friends never received the code, pause for a supervisor rather than guessing from a name or packet ID.

### NFC is optional future work, not implemented

NFC is not required for deposit or collection. **This demo does not offer an NFC button, request NFC permission or claim offline NFC transfer.** Private on-screen/verbal sharing is the safe supported fallback.

Compatibility checked against official documentation on 5 November 2026:

- [MDN browser compatibility data](https://github.com/mdn/browser-compat-data/blob/main/api/NDEFReader.json) marks desktop Chrome unsupported and Chrome for Android supported from version 89. Safari/iOS is also unsupported for this Web NFC API. A Windows laptop with an NFC peripheral therefore does not automatically gain this browser capability.
- [Chrome's Web NFC guide](https://developer.chrome.com/docs/capabilities/nfc) supports reading/writing compatible **NDEF tags**. Phone-to-phone peer-to-peer communication and host card emulation are not supported. A Web NFC tag workflow is not an AirDrop-style tap between two phones.
- The guide requires a compatible enabled NFC device, a visible top-level secure page, permission and an initial user gesture. Feature detection alone does not prove that hardware exists or that a write succeeded. [MDN describes the API as experimental and limited availability](https://developer.mozilla.org/en-US/docs/Web/API/NDEFReader).
- An ordinary readable NDEF tag is not a secret store: nearby readers can copy its bearer code, and an unlocked tag can be overwritten. A future implementation would need explicit staff review, verification of the intended tag, safe lifecycle/erase/revocation rules, and actual device tests. Do not use a public shared tag to distribute live codes.

NFC radio transfer and internet connectivity are separate. A future system might exchange local tag data without internet after appropriate setup, but that does **not** prove this laptop/app/attendee-device combination can do it. No offline NFC route has been verified. A URL on a tag can still require a network to open, and a phone cannot reach this laptop's loopback address. Do not weaken the one-authority custody model or expose the local server merely to add NFC. Production sharing would need a separately evaluated compatible device/browser or native implementation, while all releases still go through the single custody authority.

## Security and duplicate protection

- Collection codes use 12 characters from a 32-character nonambiguous alphabet: **60 bits**. They are pseudorandom HMAC-SHA-256 output derived from a cryptographically random deposit ID, event ID and 256-bit local secret. They are not counters, phone digits or predictable short PINs.
- The database stores an event-bound keyed code digest, never the plaintext collection code. The app does not log request URLs/bodies, attempted codes, claim tokens or phones. A matching secret key can regenerate codes for idempotent code-display recovery; anyone with both database and key has that capability.
- Failed verification is limited to **five per rolling minute for the whole desk**, not per code/event. Timestamps persist across restarts. The sixth check is blocked even for a correct code until the window clears. This simple limit can cause a local denial of service; there is no staff override in the demo.
- Successful verification creates a signed, event/deposit-bound claim valid for two minutes. Restarting the server invalidates uncommitted claims. Event closure blocks new verification, deposits and releases.
- SQLite `BEGIN IMMEDIATE` transactions serialize every mutation. Version checks, nonnegative balance constraints, exact category validation and physical packet matching prevent stale and over-limit releases.
- Every mutation has a persistent idempotency key and payload fingerprint. The same request replays its **current** result without a second subtraction. A committed request can be recovered after token expiry or restart. Changed payloads under an existing key are blocked, not guessed at.
- The UI retains only an interrupted mutation body in that tab's session storage. It may contain a short-lived claim token, never a raw collection code or phone. Only a definitive `not_applied` response clears an uncommitted action. Authentication or ambiguous failures preserve it for reconciliation.
- Pending releases are not automatically returned to inventory. Only the original staff label may confirm their handover. Labels are **not authenticated identities**, so this is procedural protection only.
- State reads use a consistent snapshot. The UI ignores older versions and invalidates stale collection screens. Lost connection or uncertain writes hide physical handover instructions.
- Same-origin headers, Host validation, HttpOnly same-site cookies and CSRF tokens reduce cross-site attacks on the local service. They do not authenticate staff or protect a compromised/unlocked laptop.

No software transaction can make a physical handover atomic. Staff must reconcile ambiguity. The demo cannot stop someone bypassing procedure, stealing physical passes, editing SQLite directly, impersonating a staff label or using a shared code before its intended recipient.

## Audit and privacy

The audit records event, staff label, time, public packet ID, categories and quantities when a code is generated, each release is reserved, and each handover is confirmed. It never records the raw code or recipient phone. Current-event UI shows the latest 100 audit entries; the database retains all entries. Staff labels are unverified, and the audit is not tamper-evident or access-controlled.

No guest names, ID images/numbers, birthdays, payment data or biometrics are needed. There is no analytics, telemetry, external font or automatic third-party request. The optional WhatsApp link is the only external handoff. Runtime data and the verification secret are **not encrypted by the app**. Protect the trusted laptop, browser session and backups; full-disk encryption and a locked device are prerequisites for any later deployment. No automatic retention/deletion is implemented.

## Recovery

**Internet outage:** Local custody operations continue. WhatsApp does not. A stopped local server is a different problem and blocks release.

**Response lost or server restarted:** Do not hand out from a stale screen. Restart the same server/database/key pair, reload the home page, and use **Recover saved request** in the original tab. A previously committed action returns without repeating it. If an uncommitted claim expired, verify the code again only after the recovery response proves it was not applied. Closing the original tab may lose request recovery data; then stop and reconcile the administrative record and physical stock with a supervisor.

**Release recorded, physical handover unknown:** Counts are already reserved/subtracted. The original operator checks the exact categories, recorded collection and physical stock. If already handed over, confirm the existing handover. If still held and the original intended handover can be safely established, complete that same handover once. If uncertain, stop. Do not issue replacements, give reserved stock to a different arriving person, create another release, or restore the balance automatically.

**Total outage:** A supervisor must stop all digital release points before switching to one controlled paper ledger at one counter. Record event, packet ID, categories/counts, operator and time without public code exposure. Reconcile all paper actions and remaining physical stock before restarting digital releases. **Paper reconciliation/import is not implemented; this demo is not approved for live fallback operations.**

**Backup:** Create an online SQLite snapshot rather than copying a live WAL database file:

```sh
python3 app.py --backup /path/to/new/snapshot.sqlite3
```

This produces the snapshot **and its matching secret `.verification.key` companion**, refusing overwrites and checking database integrity. Protect both together. A missing, malformed or mismatched key is refused at startup. Backups are not encrypted and can restore old balances that have since been collected. Never restore and resume without reconciling every subsequent release and physical stock. There is no automatic restore/failover.

## Tests

```sh
python3 -m unittest discover -s tests -v
node --check static/app.js
node tests/ui_state_test.cjs
```

Python domain/API tests cover code generation, event isolation, shared partial balances, concurrent releases, repeated requests, restart/expiry recovery, invalid inputs, failed-attempt throttling, matching backup keys and local HTTP protections. Node tests use a minimal DOM stub for recovery/race checks, **not a browser**. Accessibility checks verify selected contrast values and focus/reduced-motion contracts, not full WCAG compliance.

The redesigned public demo was tested in the actual in-app browser at desktop and phone widths. See `TEST_REPORT.md` for the exact scenarios and limits. The older optional `python3 tests/browser_smoke.py` remains a separate local harness; it was not used for this browser review. No physical scanner, power-loss hardware or throughput validation is claimed.

## Public demonstration source

`public-demo/dist/` contains the buildless synthetic public demonstration, with its own model checks in `public-demo/tests/`. Serve that folder with a static HTTP server; run `node public-demo/tests/demo-store.test.cjs` for its model checks. The matching Sites manifest is in `public-demo/.openai/hosting.json`. The hosted demo resets on reload and has independent inventory in every tab. Publishing that static folder never exposes the Python server, its database or its verification key. The local Python app remains loopback-only.

## Before live use

- Agree physical ticket validity/transfer rules, code-sharing liability, lost/stolen-code exceptions, category definitions, unclaimed stock policy, retention and legal notices.
- Add authenticated staff accounts, admin/supervisor roles, device security, access revocation, audited correction/revocation workflows, tamper-evident audit, encrypted backups and supervised restore/reconciliation.
- Add issuer-authorized validity checks without prematurely redeeming admission. Physical custody does not prove a pass is authentic or transferrable.
- For multiple counters, use **one authoritative onsite service** on a protected local network with properly provisioned HTTPS. Independent offline writers cannot safely prevent double collection. A signed QR alone does not prove it was not redeemed elsewhere.
- Define real event creation/closure, reliable clocks, capacity and throughput. Complete browser accessibility review, device/scanner tests, crash-and-recovery drills and a full event rehearsal.
- Verify branding, asset rights and license choice. No software license is implied by public source visibility.

Only source, synthetic fixtures, tests and documentation belong in the public repository. Never publish runtime databases, verification keys, code captures, logs, backups, guest data or real-event screenshots. `.gitignore` is a guardrail, not a substitute for reviewing every published file.

## Documentation handbook

See the [documentation index](docs/README.md) for development commands, architecture, the local API, recovery operations, contribution guidance and a source-linked project history. The handbook distinguishes the reviewed `main` application from the separate unmerged Android-emulator preview in [draft PR #1](https://github.com/Namdev90/bullseye-box-office/pull/1).
