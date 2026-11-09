# Architecture

[Documentation index](README.md) · [API](API.md) · [Operations](OPERATIONS.md)

Scope: default-branch source at `4561791`. Source links below point to files in the same checkout.

## Local application

The browser loads [`static/index.html`](../static/index.html), styles and plain JavaScript from [`app.py`](../app.py). `Handler` serves an explicit static allowlist and JSON routes. `Server` is a standard-library `ThreadingHTTPServer`; the CLI binds it to `127.0.0.1`. `Store` owns database access, validation, code verification, mutations and backups. There is no package install, framework build, external database server or background messaging worker.

[`static/app.js`](../static/app.js) manages the staff label, selected event, dialogs, version-aware caches and interrupted-action recovery. [`static/desk-enhancements.js`](../static/desk-enhancements.js) manages opening/desk transitions, gesture interruption and rapid-click guards. CSS supplies layout, material styling, focus and reduced-motion rules.

### Local data model

The schema is created by `Store.__init__` in `app.py`:

| Table | Purpose |
| --- | --- |
| `metadata` | Fingerprint tying the database to its verification key |
| `events` | Synthetic event names, active flags and closure times |
| `deposits` | Public packet ID, event/shelf slot, initial and remaining category counts, version and keyed code digest |
| `collections` | Quantities reserved for one pickup, operator labels, timestamps, status and version |
| `actions` | Persistent request ID and payload fingerprint for mutation replay |
| `audit` | Custody actions and category details; no raw collection code |
| `verification_failures` | Failed verification timestamps for the desk-wide rolling limit |

The category keys are exactly `normal`, `vip` and `vvip`. A packet ID identifies the physical envelope but cannot authorize collection. A deposit's shelf location is unique within its event, even after the balance is exhausted. There is no shelf-reuse, deletion or balance-editing endpoint.

SQLite uses WAL mode, foreign keys and `synchronous=FULL`. Mutations use `BEGIN IMMEDIATE` and roll back on exceptions. State reads use one read transaction so balances, collections and audit entries form a consistent snapshot. This supports the local demonstration; it is not a hardware crash or throughput certification.

### Custody transitions

1. **Deposit:** validate positive total quantities, a fresh shelf slot and explicit custody confirmation. Store the deposit and audit event; return a generated private collection code.
2. **Verify:** check the event-bound code and desk-wide failed-attempt limit. Issue a signed claim bound to the deposit, event and current server verification session, expiring after 120 seconds. Verification itself does not subtract stock.
3. **Record release:** validate the claim, deposit version, physical packet ID, category balances and absence of a pending handover. Subtract the selected counts and create a `RELEASE_RECORDED` collection in the same transaction.
4. **Confirm handover:** the original operator label confirms that the recorded quantities were physically handed over once. Mark the collection `HANDED_OVER` and advance its version and the deposit version. This does not subtract again.
5. **Later pickup:** remaining stock is collectable under the same code after the prior handover is resolved. There is no undo, automatic restock or per-friend allocation.

New deposits and releases require an open event. Handover reconciliation remains possible after closure. Existing matching committed requests can replay their current result before new-action checks run. Staff labels are procedural labels, not authenticated people.

### Duplicate and uncertain requests

Each mutation carries a `request_id`. `Store.mutate` fingerprints the action, target and full payload. An identical committed request returns current records with `replayed: true`; a changed payload under the same ID produces `REQUEST_CONFLICT`. A new ID is a new action, not a safe retry strategy.

The local browser saves the pending mutation URL/body in that tab's `sessionStorage`. A pending release may contain a short-lived claim token, but not the raw collection code or recipient phone. The staff label is also stored in `sessionStorage`. Uncertain outcomes keep the saved request and block further work. A successful replay or explicit `not_applied: true` permits the UI to resolve it. Version-aware caches reject older responses and invalidate stale collection screens.

Closing a tab can lose recovery data. Server restart rotates the local session/CSRF values and invalidates uncommitted claims; it does not erase committed actions. See [Operations](OPERATIONS.md) before retrying anything involving physical stock.

### Trust boundaries

The database and `.verification.key` companion must stay together and private. The key is 32 random bytes; the application checks its size and stored fingerprint at startup. Codes are derived with HMAC from the event/deposit and key; the database holds a keyed digest. Anyone with both files can reconstruct codes. Neither file is encrypted by the app.

The server checks Host, local session cookie, optional Origin and CSRF token. The cookie is HttpOnly and SameSite Strict. These measures reduce browser-origin attacks but do not authenticate staff or secure a compromised laptop. API state is available to a local session and must not be made publicly reachable.

## Disposable browser demonstration

[`public-demo/dist/demo-store.js`](../public-demo/dist/demo-store.js) supplies `DemoStore`, an in-memory simulation. Its `request()` method resembles the local routes but does not make HTTP API calls. [`public-demo/dist/app.js`](../public-demo/dist/app.js) substitutes an in-memory map for browser recovery storage. Reloading loses mutations, claims, failed-attempt history and pending handovers.

The public fixture uses a fictional Oktoberfest 2027 event and four-character practice codes. Its code and stock checks run in a browser controlled by the person using it. It has no real custody authority, durable audit or synchronization, and is not an offline-installable app. The separate local service keeps the 12-character code model.

Both interfaces can preview code-sharing text and offer an explicit WhatsApp handoff. No message is sent automatically. Opening the external draft transmits its recipient/code to that service; do not use real details during practice.

## Source and test map

- [`tests/test_app.py`](../tests/test_app.py): domain, backup, concurrency and HTTP behavior.
- [`tests/test_accessibility.py`](../tests/test_accessibility.py): selected contrast, keyboard, focus and reduced-motion contracts.
- [`tests/ui_state_test.cjs`](../tests/ui_state_test.cjs): local JavaScript state/recovery with DOM stubs.
- [`public-demo/tests/`](../public-demo/tests/): disposable model, interrupted workflow and short-code behavior.
- [`tests/browser_smoke.py`](../tests/browser_smoke.py): optional browser harness, separate from the automated suites.

The Android-emulator integration and its workflow exist on the unmerged branch recorded in [History](HISTORY.md), not in this architecture snapshot.
