# Pass Desk: DEMO ONLY, not production-ready

A staff-only, single-laptop prototype for depositing physical event passes and handing them to a named collector later. It needs **no internet, attendee app, attendee website, SMS, or OTP**. It is not a ticket issuer or admission scanner.

**Training only. Use synthetic data. Not production-approved.** This project has temporary neutral styling, not verified Bullseye branding. This public repository contains only the synthetic-data training prototype. No existing project was modified.

## Run

Requires Python 3.10 or newer. There are no third-party runtime packages or installation steps.

```sh
python3 app.py --demo
```

On Windows, use `py app.py --demo`. Open the printed address, normally `http://127.0.0.1:8765`, on the **same laptop**. Set a demo operator name. `--demo` creates three fictitious example packets and is safe to repeat. Without `--demo`, a new database begins empty. `Ctrl+C` stops the app; data persists locally in `_runtime/training.sqlite3`.

The service binds only to loopback. Do not change it to a public/LAN address, expose it with a tunnel, run separate copies of the inventory, or deploy this prototype publicly.

## Try the workflow

1. Select **New deposit**. Enter synthetic depositor and collector names, category, quantity, and a unique shelf slot.
2. Count the passes and place one sealed packet in that slot. Confirm custody and save.
3. Write the generated packet code on the physical envelope. Print its receipt/label if useful. The receipt is not admission and does not replace an identity check.
4. Search by collector, depositor, packet code, or shelf. Open **Collect**.
5. Check accepted photo ID visually. Do not scan, photograph, or enter ID numbers. Type the physical packet code or use a keyboard-wedge scanner.
6. **Record release** before handing out the packet. Then physically hand it over exactly once and **Confirm handover**.

One packet has one collector. Separate independently arriving friends into separate packets. This prototype does not support partial pickup or reusing a shelf-slot identifier during an event.

## What prevents a duplicate handover record?

- SQLite `BEGIN IMMEDIATE` transactions serialize mutations even across browser tabs.
- Version checks reject stale actions. Valid transitions are `READY → RELEASE_RECORDED → HANDED_OVER`. There is no reset or undo endpoint.
- Every mutation has a persistent idempotency key and payload fingerprint. Repeating the same request returns the packet’s **current** status without repeating the action. Reusing a key with changed information is rejected.
- A lost network response leaves the original request in that tab’s session storage. **Recover saved request** retries exactly that request. It never instructs staff to repeat a physical handover.
- A release is committed before the handover screen appears. A power failure or interruption between database commit and physical delivery leaves an explicit unresolved state, not an automatically reusable packet.
- The final handover confirmation must use the original operator label. These labels are not authenticated identities; this is a procedural guard only.
- Host checking, same-site cookies, a random CSRF token, and strict same-origin browser headers limit cross-site attacks on the local service. They are not a replacement for production authentication or endpoint security.

The software cannot make a physical act atomic with a database update. Staff must reconcile uncertain handovers. It cannot prevent someone physically giving away the wrong item or bypassing procedure.

## Recovery

**Internet failure:** No effect. All app resources, requests and data are local.

**Local server failure:** Do not hand out passes from a stale screen. Restart the same server/database and refresh the home page. Session tokens rotate on restart. Recover any saved interrupted request, then inspect the packet’s current status and physical location. Do not start a new request with new data to guess whether an earlier deposit succeeded.

**Release recorded, handover unknown:** The original operator checks the actual packet. If already handed over, confirm that existing handover. If still held, hand over that same packet once and confirm. If custody cannot be established, stop and involve the supervisor. Never issue a replacement automatically.

**Total outage:** Supervisor stops all digital release points and switches to one paper custody ledger at one counter. Record packet ID, collector, quantity, operator and time. Reconcile the paper ledger against physical stock and database before reopening digital releases. **The reconciliation/import workflow is not implemented here, so do not use this prototype for live paper-fallback operations.**

**Backup:** An online SQLite snapshot can be created without copying an inconsistent WAL file:

```sh
python3 app.py --backup /path/to/new/snapshot.sqlite3
```

The command refuses to overwrite a destination and runs an integrity check. Backups are **not encrypted by the app**. Protect them as sensitive data. A snapshot may omit later releases: never restore and resume without a supervisor reconciliation. No automatic restore/failover is provided.

## Tests

```sh
python3 -m unittest discover -s tests -v
node --check static/app.js
node tests/ui_state_test.cjs
```

Tests cover deposit/release/handover, input validation, repeated requests, conflicting request IDs, simultaneous releases, restarting and retrying, wrong packet labels, identity checkbox requirements, stale versions, missing packets, duplicate slots, backup integrity, session requirements, CSRF, foreign origins, host rebinding, content types, path traversal and browser security headers.

The Node tests exercise UI state transitions with a minimal stub, not a real browser. They cover lost-response recovery, authentication failure during recovery, deposit receipt presentation, changed handover records, out-of-order responses, and disabling unsafe actions. The optional browser smoke test in `tests/browser_smoke.py` uses Playwright if already installed; it is not a runtime requirement.

**Verification limits in the build environment:** Domain/API tests and UI state tests passed. Real-browser smoke checks could not start because Chromium was denied its local process socket; the separate cloud browser could not reach the loopback server. Visual layout, real printer output, actual barcode hardware, camera scanning and power-loss-on-hardware remain unverified. Do not treat the included browser test script as a passed test.

## Data and privacy

Only names, staff labels, pass counts/categories, packet/shelf IDs and action times are needed. No phone numbers, ID images/numbers, birth dates, payment information or biometric data are collected. Prototype records and request recovery bodies are stored on this laptop; successful request bodies are removed from session storage. There is no analytics, telemetry, external font, external image or third-party request.

The database is not encrypted or tamper-proof. No automated retention/deletion policy is implemented. Do not put real guest information into it. Production retention, secure deletion, backups and access controls need an agreed event policy.

## Before production or a public repository

- Confirm physical vs digital passes, transferability, ticket validity checks, security boundary, quantity/peak throughput, hardware, accepted identity evidence, exceptions and unclaimed-pass policy.
- Add authenticated staff identities, role separation, supervisor workflows, device security, access revocation, durable tamper-evident audit, event scoping, retention, encrypted backups and restore/reconciliation tooling.
- Add event-authorized ticket validation without admission redemption. Holding a digital screenshot does not stop the original from being reused.
- For multiple counters, use one authoritative onsite service on a private network with properly provisioned HTTPS and no independent offline releases. A signed QR proves authenticity, not that it has not already been redeemed elsewhere.
- Test actual hardware, label printers, keyboard scanners, power loss and a full event rehearsal. No camera/QR integration or direct printer driver is included here.
- Confirm official branding and licensing. The live first-party website did not yield a trustworthy current logo. Neutral branding is deliberate.
- Approve the target repository owner/name, public scope, software license and brand-asset rights. Publish only source, synthetic fixtures and documentation. Exclude `_runtime`, databases, backups, logs, credentials, real guest records, claim codes and production screenshots. `.gitignore` is a guardrail, not a substitute for reviewing the complete publishable bundle.

## Structure

```
app.py                 Local HTTP service and transactional SQLite domain model
static/index.html      Staff interface
static/style.css       Temporary neutral responsive styling
static/app.js          Offline local workflow and interrupted-request recovery
tests/test_app.py      Standard-library domain/API tests
tests/ui_state_test.cjs Zero-dependency UI state regression tests
tests/browser_smoke.py Optional browser workflow checks
```

Design reference: pretix’s official documentation explains [duplicate redemption while multiple scanners are offline](https://docs.pretix.eu/guides/pretixscan/android/) and [the difference between ticket authenticity and prior use](https://docs.pretix.eu/guides/ticket-secrets/).
