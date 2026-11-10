# Receipt alert lifetime and rollout

Receipt alerts follow an explicitly enabled receipt subscription through the current collection-code lifetime. Confirming a 48-hour code or extending a code aligns only an existing, still-live subscription with the authoritative ledger expiry. Replaying an action can repair a transient post-commit lifetime-update failure without resending notifications. Expired, stopped, missing or differently scoped consent is never recreated automatically.

The same-origin status action is read-only and checks the exact ticket and browser push endpoint. The page and receipt service worker use it to refresh stale cached expiry. Notifications remain generic; cache records contain only the existing receipt path and expiry, not collection codes, contact details or push endpoints. Permission denial, missing/replaced subscriptions and Stop are respected. Offline status failures preserve proof for a later retry but suppress background notifications and receipt opening.

## Compatibility and deployment gates

- Deploy the backend, intake page and receipt service worker together. Mixing old and new versions is not supported as a completed rollout.
- Verify that existing service-worker registrations install and activate the new worker, not only that newly enabled subscriptions work. The page requests registration updates, but actual activation must be checked in supported browsers.
- Web Locks coordinate page/worker cache changes. Without Web Locks, automatic cache renewal, background notifications and notification-click opening are disabled. New enable is rejected; existing Stop and manual receipt access remain available. This is degraded behavior, not full browser support.
- An already-expired server subscription requires a fresh explicit user opt-in. Do not migrate it back into live consent.
- Perform genuine supported-browser and device acceptance before promotion: stale cache, 48-hour confirmation, extension, closed-tab push/click, permission changes, offline recovery, Stop races, receipt navigation during enable, and service-worker upgrades.
- Preserve production databases. Validate with an isolated synthetic fixture before any approved deployment. These source checks do not establish live Site/source mapping, APK verification, or overall release readiness.

## Validation and boundaries

The hosted build, generated Worker and changed browser-script syntax checks, and all 127 hosted tests passed on base `bcc207e31464ed6b241b01f432e1b4f3ef4f8aad`. An independent review and full rerun also passed. Tests use synthetic in-memory SQLite and browser/service-worker mocks; they are not browser/device acceptance.

Coverage includes confirmation and extensions, expiry boundaries, stopped and absent consent, ownership and endpoint isolation, pending handover, transient failure/replay repair, stale authoritative responses, transport failure, missing Web Locks, permission revocation, Stop races and interrupted enable cleanup. Existing and replacement subscriptions are not torn down by another interrupted enable attempt.

This change does not modify Android, counter layout/QR behavior, recipient allocation sharing or code-refresh request recovery. It requires no database migration and does not deploy a Site or distribute an APK.
