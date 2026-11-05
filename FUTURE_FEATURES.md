# Future requirements

These items are recorded for future work. They do not add controls, accounts, services, photo capture, messaging, or production storage to the current app.

- **Collection photo evidence.** Associate a photo with each completed pickup. Before implementation, define who may take, view, share, and delete photos; what the photo should contain; and how staff explain its use. Retention remains undecided: **two days or the end of the event**. Choose the rule and its exact timing before storing real photos; neither option is currently implemented.
- **One shared custody authority.** Support multiple staff members and devices against one authoritative database, with authenticated access, atomic category balances, duplicate-action protection, and an understandable custody history. Define offline and reconciliation behavior so independent devices cannot release the same stock twice.
- **Friends collecting in parts.** Keep one shared code usable for different friends collecting different Normal, VIP, and VVIP quantities at different times, without requiring a named collector by default. The current single-session app already demonstrates this workflow; coordinated collection across devices and durable recovery are future work.
- **One WhatsApp notification per pickup.** Plan one pickup notification, including that pickup's collection photo, to the approved recipient after a completed collection. Sending must be manually initiated or follow an explicitly approved user policy. Define recipient selection, photo-sharing access, duplicate-send handling, and retention before implementation. No automatic sending, WhatsApp account connection, paid API, or delivery tracking is added now.

The hosted app currently keeps records in one tab's memory. Reloading discards changes, and other tabs or devices have separate inventories. It does not store collection photos, coordinate staff, or provide production custody security. Use practice data only.

For future validation, consider [Grafana k6](https://k6.io/open-source/) for controlled synthetic load tests on an expressly authorized, isolated test instance. No load test is being run against the public Site, a live service, or a third-party service now, and no capacity claim is made.

## Further notification planning

- Consider notifying the depositor after each relevant custody action through the approved WhatsApp, SMS or email channel. Define which actions qualify, the recipient, message contents, consent/preferences and duplicate-send handling before implementation.
- A **one-time-view collection photo is a concept only**. Actual support through the chosen messaging platform or API has not been verified and is not promised.
- Photo capture, shared synchronization and notifications remain deferred. No related app controls, services, accounts or automatic sending are added now. The existing manually initiated code-sharing feature remains separate from these future notification plans.

## Booth and remaining-balance requirements

- Record a booth/counter identifier with custody actions so staff can distinguish the relevant desk during lookup, history review and reconciliation. Its assignment and access rules remain future design work; no booth control is added now.
- Include the depositor's remaining **Normal, VIP and VVIP** balances in the approved notification after each relevant collection or custody action. Define recipient, timing, channel and duplicate-send handling before implementation. These notifications remain deferred.
