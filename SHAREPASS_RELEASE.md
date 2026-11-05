# SharePass — current release, 5 November 2026

Product name: **SharePass**. Endorsement: **brought to you by Bullseye Entertainment**. The existing Bullseye logo remains the genuine GEVA-hosted asset used with the user's permission. A new logo is still under review; no new logo, trademark clearance or real event announcement is claimed.

## Current design and behavior

- A distinct opening screen morphs into the same physical desk frame. Raised controls expand into native dialogs; the same dialog surface transitions through selection and handover. Native View Transitions are used when supported, with an immediate/reduced-motion fallback. Incoming pointer/keyboard gestures interrupt visual interpolation without cancelling custody operations.
- Deep olive, amber/brass and red materials follow approximate user-sampled 2026 references (#191E0A, #EAA80B, #B81601, #FFEECB, #FDE7BE), not an official brand manual. Cream is used for text rather than large white panels. Shadows, bevels, stitching and category stubs are code-native UI materials, not purported authentic event imagery.
- **Oktoberfest 2027 is fictional.** No actual 2027 dates, venue, lineup, sale or sponsorship is asserted. Historical 2026 posters/maps were inspected as references and are not included in the public deployment or reworked into a 2027 announcement. See OKTOBERFEST_SOURCES.md.
- The hosted practice app issues four-character alphanumeric codes, including sample code **K7M4**. Collision retry is event-scoped; the single-tab failed-attempt limit remains five per minute. A four-character code has limited entropy and is not secure custody authorization. These browser checks can be bypassed by a person controlling the browser. Real operation would require authenticated staff, server-enforced rate limits, atomic collision/stock handling, durable records and supervised exceptions.
- The separate Python custody engine retains its original 12-character code scheme, local database/key model, idempotency, transaction and recovery protections. It was not exposed to the public Site or weakened to accept short codes.
- Mixed Normal/VIP/VVIP balances, repeated partial pickups, physical packet matching, custody history and explicit handover confirmation remain. There is no printed receipt or default named collector. Recorded releases and physical handovers have no undo; ambiguity requires reconciliation.
- Optional manual code-sharing can preview a recipient/message and open a separately reviewed WhatsApp draft. Nothing is sent automatically. No actual WhatsApp draft was opened or message sent during validation; no phone/code is persisted by the app.
- One persistent practice disclosure states the fictional event and code limits, reload reset and lack of device sync. No real passes or personal data are appropriate. No fake loading screen or artificial skeleton delay was added; actual mutations disable controls and expose busy state.

## Validation of this release

JavaScript syntax checks passed. Automated checks: **42 Python, 18 UI state, 20 demo model, 12 interrupted/stale workflow, 5 short-code**. Selected accessibility contracts inspect actual final material endpoints for text contrast, field boundaries, focus and reduced motion; this is not full accessibility certification. Static source has no package lint, TypeScript or framework build; Sites packages the tested buildless files.

Actual in-app browser review covered desktop 1440×1000 and phones 390×844 / 320×720. Checked opening/navigation, native dialog transitions, repeated deposit/release/confirmation clicks, reduced-motion emulation, wrong packet, category limits, mixed pickup, repeated code verification against reduced stock, interrupted handover across opening/desk navigation, confirmation recovery, search/empty-state recovery and generated four-character codes. The rapid-click guard was narrowed after discovering it could suppress a legitimate click in a later workflow step. Native morph support was confirmed in the browser; reduced-motion checks reported animation `none` and transition `0s`. At 320px, primary controls were 46px high and no horizontal overflow was detected.

No load test was run and no capacity claim is made. Physical phone hardware, multiple staff devices, power failure and production security were not validated.

## Proposed only

Photo evidence, retention choice, booth identifiers, synchronized staff/devices and action/balance notifications by WhatsApp/SMS/email remain in **FUTURE_FEATURES.md only**. One-time-view photo delivery is an unverified concept, not a supported capability. No camera permissions, real photos, synchronization service, notification integration, paid API or automatic sending were added. k6 is recorded as future isolated-test planning only.
