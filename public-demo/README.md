# Bullseye Pass Desk: hosted interactive demonstration

Primary project: https://github.com/Namdev90/bullseye-box-office, originally adapted from commit `127faf3f713100d1f8ab893738ed64ed1989c49d`. GitLab is a secondary backup.

The interface has been substantially redesigned around collection, deposit and the custody register. Shared-code, category balances, partial release and pending handover protections are retained. The genuine Bullseye logo is used with the user's permission; see REFERENCES.md for source and rights limits. The Python/SQLite backend is NOT hosted or included in the deployed artifact. Instead `dist/demo-store.js` supplies an ephemeral browser-memory simulation.

## Boundaries
- Synthetic examples only. No real passes, names, phone numbers or sensitive data.
- All mutable app state stays in this page's memory. It disappears on reload or closing the tab. No local storage, session storage or server writes.
- Independent tabs/devices have independent inventories. No real multi-counter or offline durability guarantee.
- Codes, labels and client-side checks are NOT production security. Anyone controlling their browser can inspect or alter this simulation.
- Sharing preview is local text only. No phone field, WhatsApp URL, external messaging, NFC or permissions.
- No admission validation, authenticated staff, encrypted storage, durable audit, recovery backups or real event handover.
- This existing Site is public at the user's explicit request. Source repository identity is in `.openai/hosting.json`.

## Run model checks
`node tests/demo-store.test.cjs`

Static files require no build. The hosted entrypoint is `dist/index.html`.
