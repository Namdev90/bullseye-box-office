# Bullseye Pass Desk redesign — 5 November 2026

This public prototype demonstrates physical pass custody, not admission or ticket sales. The existing Site is reused. All records are synthetic and remain in browser memory; reloading discards changes. This public app has no authenticated staff, durable storage, multi-device synchronization, offline installation, production audit, or production code secrecy. The separate Python application retains its local SQLite engine and recovery protections; it is not exposed by the Site.

## Assets and permission

- Genuine Bullseye Entertainment logo: https://www.geva.online/images/member-logo/50-bullseye-entertainment.jpg?v=12
- Association context: https://www.geva.online/ lists BullsEye Entertainment and displays this member logo. The page reserves content rights. Association listing establishes a credible brand reference, not copyright-free status or current-master status.
- The user explicitly authorized use of Bullseye's logo and photos in this public demo in this chat on 5 November 2026. The original logo file is included locally and is not redrawn or generated. No event photographs were needed for the staff workflow. No general redistribution licence, ownership adjudication, official endorsement, or verified current master is claimed. Third-party marks remain with their owners.
- The apparent company website https://www.bullseyeentertainment.in returned a gateway failure. The Instagram reel https://www.instagram.com/reel/DfUe1XXx6Jw/ was throttled and could not be viewed. The design does not claim to reproduce its contents.

## Workflow references and what was adapted

| Reference | Actual documented capability | Bullseye adaptation |
| --- | --- | --- |
| [Broadway Sacramento box office](https://www.broadwaysacramento.com/broadway-on-tour-2-2/ot-box-office-info/) | Accepts third-party/drop-off will-call beginning 30 minutes before performance for late members of a party. | Physical envelope custody with clear shelf and packet handling. The page does not establish shared-code category-level partial pickup software. |
| [Ticketor operator guide](https://www.ticketor.com/help/adminhelp) | Event-selected gate control, manual code entry/scanning, valid/invalid/duplicate states; online synchronization and offline limitations. | Event-first actions, prominent verification, explicit errors, and repeat protection. Bullseye is custody release, not admission scanning. |
| [Yapsody will-call guidance](https://support.yapsody.com/hc/en-us/articles/9479400641305-How-to-Print-Will-Call-Pick-Up-Tickets) and [delivery options](https://www.yapsody.com/ticketing/features/ticket-delivery-method/) | Event-specific will-call pickup, printing fulfillment, and the option to specify who collects. | Event-scoped custody register and deliberate completion. Printing and named collectors are excluded from Bullseye's default workflow. |
| [Ticket Tailor features](https://www.tickettailor.com/features) | QR scanning, external scanners and operation after loss of internet. | Fast operator action and clear offline boundaries; no QR admission or scanner support is claimed here. |
| [pretixSCAN desktop on GitHub](https://github.com/pretix/pretixscan-desktop), [check-in algorithms](https://github.com/pretix/pretix/blob/master/doc/development/algorithms/checkin.rst), [redemption API](https://docs.pretix.eu/dev/api/resources/checkin.html) | Open-source desktop attendee check-in, offline validation approaches, duplicate nonce handling and reasoned errors. | Idempotent mutations and fail-closed transitions are preserved from Bullseye's existing engine; clear partial balances and human-readable statuses added. No source code, artwork or branding copied. |

The broad idea is an established will-call/guest collection workflow. Bullseye is a focused variation: staff hold pre-existing physical passes, issue one shared private group code, and release mixed categories in multiple pickups. The sources reviewed do not prove that every competitor supports this exact combination. This is a product comparison, not a patent-novelty assessment.

## Implementation

The sidebar dashboard is replaced with a horizontal desk shell and two task areas. Category counts are labeled individually in stock, register and dialogs. Phone register rows become packet cards. Collection previews the remaining category quantities; the record distinguishes partly collected, unconfirmed and completed states. A typed physical packet match remains mandatory before recording release. Pending handovers continue to block new releases. Activity text now describes the physical operation. Search has a keyboard shortcut and explicit empty-state recovery. Native labeled dialogs, visible focus, 44px action targets, contrast checks, reduced-motion and forced-color rules are included. This is not a full WCAG certification.

The public demo remains deliberately disposable. Codes generated for new deposits use browser cryptographic randomness; the published sample code is a fixture. Browser memory is inspectable and not secure storage. Refreshing resets inventory; separate tabs/devices are independent. Once loaded, simulation actions do not require network calls, but offline reload/install is not provided. The Python app's offline behavior requires its local server and matching database/key on one laptop. Neither implementation is approved for real events.

Optional sharing remains manual: the hosted demo only previews text locally; the local Python version can open a staff-reviewed WhatsApp draft. No messages were sent, accounts connected, paid APIs added, or real data entered. There is no printed receipt.
