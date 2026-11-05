# Redesign validation — 5 November 2026

## Automated checks

- `node --check dist/app.js`, `node --check dist/demo-store.js`, `node --check dist/desk-enhancements.js`: syntax checks.
- `node tests/demo-store.test.cjs`: 20 model checks, including mixed-category partial pickup, replay/idempotency, exhausted balances, expiry, wrong packet, over-collection, event separation and throttling.
- Primary Python repository: `python -X utf8 -m unittest discover -s tests -v`: 42 checks for domain logic, HTTP security and selected accessibility contracts.
- Primary repository: `node tests/ui_state_test.cjs`: 18 state checks covering interrupted requests, stale responses, disconnection, recovery and secret clearing.
- No package-based lint, TypeScript or framework build exists. This is buildless static HTML/CSS/JS; the deployment archive packages the exact tested static files. Node syntax checking is not a full linter.

## Actual browser checks

Tested through the in-app browser at 1440×1000, default desktop width (~857px), 390×844 and 320×720. Screenshots were visually inspected. At 320px, DOM bounds showed no child extending beyond the viewport. Physical mobile hardware and a full screen-reader audit were not tested.

- Deposit of 3 Normal, 2 VIP and 1 VVIP at synthetic shelf B-04, including double-click Save: one packet created and one private code shown.
- Sample partial pickup: 2 Normal + 1 VIP leaves 4 Normal + 1 VIP + 1 VVIP; wrong packet ID is rejected without mutation.
- A second mixed pickup scenario: 2 Normal + 1 VIP + 1 VVIP leaves 4 Normal + 1 VIP + 0 VVIP. The same code verifies again against the reduced balance.
- Attempting 7 Normal against a balance of 6 triggers the number input range validation. Model tests separately verify server/store rejection.
- Recording release via double-click subtracts once. Closing the pending handover, attempting collection, and reopening the packet confirms the pending lock and reconciliation path.
- Handover checkbox and confirmation complete the recorded release. Repeated rapid confirmation retains the completion screen after fixing click-through between successive dialog steps.
- Exhausting all categories causes the next code verification to show “All passes ... already been collected.”
- Cancel deposit, close dialogs, Escape from code verification, invalid code error, empty second event, no-match search, clear filters, Activity and Desk guide navigation, and `/` search keyboard focus checked.
- Public demo reload resets changes as disclosed. No real names, phone numbers, pass records, or messages used.

## Fixes found during validation

Restored an event-name UI binding required during initialization. Added an explicit rapid double-click guard so the second click cannot operate the next dialog step. Added the new local script/logo to the Python static allowlist. Closed the SQLite backup destination explicitly so the Windows backup test can release its file handle. Existing selected-color tests were updated to cover the new palette. All local runtime and verification-key files remain excluded from publication.

Production security, multiple-device coordination, hardware crash/power recovery, load/throughput, offline installation and complete accessibility conformance are outside this demonstration.
