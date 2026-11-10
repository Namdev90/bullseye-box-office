# Hosted collection-code refresh recovery

The staff counter records a pending refresh before sending it. The record uses the existing `sessionStorage` journal keyed by the authenticated staff context. It contains only the operation path, random request ID and packet identifier. Collection codes, receipts, contacts and sharing drafts are not added to this journal.

## Interrupted requests

- Retry and Cancel → reopen retain the same request ID. Pending refreshes block new custody mutations through the existing recovery gate. The saved receipt hides its old code, and Share first recovers the pending refresh.
- Returning to the desk or reloading the same tab exposes **Recover last action**. A committed refresh returns its original replacement code and the current packet balance. It does not allocate another code.
- If no committed request is found, the journal remains pending. Absence cannot prove failure while a request may still be in flight. After a reload, staff can enter the original code and retry the same packet/request ID. The code is sent in the POST body only and is not saved to browser storage.
- If the original code is unavailable and the server has no matching request, leave the action pending and ask the supervisor to reconcile the packet. Do not create a fresh refresh request or repeat a physical handover to work around it.
- A definitive initial rejection releases the journal. Authentication failures during recovery do not. A confirmed replay whose code was subsequently replaced releases only that matching journal and invalidates the obsolete receipt, without revealing the supervisor's replacement.
- A response arriving after newer navigation, a newer recovery or a different staff context cannot replace that screen or clear a newer pending operation. Unshown successful results remain recoverable.
- If the journal cannot be saved, no refresh is sent. If cleanup fails, the same saved request remains recoverable.

## Read-only replay boundary

`POST /api/codes/refresh/recover` requires normal staff authentication and same-origin checks. Its body contains only the request and packet identifiers. The ledger lookup is workspace-scoped and validates the exact original refresh operation, original operator, booth, event and packet against the current deposit. Another operator, including a supervisor, cannot use this endpoint to recover someone else's refresh.

The route reads one committed ledger snapshot and invokes the existing in-memory replay validation. It does not call the mutation or receipt-alert helpers, write the ledger, allocate codes, send notifications, renew alert consent or recreate stopped/expired subscriptions. A missing record is reported as pending, not as a new action. A later code replacement is a terminal error rather than an obsolete or newly substituted code.

No schema migration, live database action, dependency, permission, APK/version change or deployment is part of this patch. Deploy counter HTML/JavaScript and Worker together through the existing reviewed release process. An older Worker cannot serve the new recovery route; the updated counter retains its journal rather than treating that failure as successful recovery. Older clients keep their existing behavior until reloaded.

## Verification and limits

`hosted/tests/counter-refresh.test.mjs` executes the actual counter script with a DOM/transport model and the built Worker against disposable in-memory SQLite. It covers lost requests/responses, repeated submissions, Cancel/reopen, desk navigation, same-tab reload, different packets, session changes, storage failures, out-of-order responses, terminal replacement, scope/session rejection, and unchanged ledger/receipt-alert state.

Run the hosted build, generated Worker syntax check, all hosted tests and browser-script syntax checks before publication. These are source/model/in-memory integration checks. Supported-browser rendering, keyboard/accessibility, mobile WebView and physical-device acceptance remain separate gates and were not performed here.

The journal lasts only for the browser's tab session. Closing the tab, clearing site data or changing browser profiles can discard it. This does not add cross-tab or cross-device recovery, new code-returning inventory endpoints, or permission to bypass a failed session.
