# SharePass hosted register

The Worker serves the guest intake, staff desk and owner administration pages and stores custody state in Cloudflare D1. The private Sites project binds its database as `DB`. Site-verified identity or a paired staff device is required for staff access. Register releases preserve the physical packet check, idempotent custody operations and partial handovers.

## Build and test

From this directory, use Node 22 or later with `node:sqlite`.

```sh
node scripts/build.mjs
node --check dist/server/index.js
node --test tests/*.test.mjs tests/*.test.cjs
```

Interrupted collection-code refreshes use the [code-free recovery journal and read-only replay](../docs/refresh-recovery.md).

The public clone builds with a synthetic code catalogue, neutral artwork and a Site configuration that lacks a production project ID. The tests use disposable records. They never use the live register.

## Private release inputs

- `SHAREPASS_HOSTING_CONFIG_PATH` points to the authorized Sites configuration file. The build copies it into the output only. A private Sites build also requires the two inputs below.
- `SHAREPASS_CODE_MASTER_PATH` points to the approved private catalogue JSON. Set it for build and test so both use the same catalogue.
- `SHAREPASS_ARTWORK_PATH` points to the approved JPEG for the opening and staff screens.
- Configure owner identity, password-login handle and pepper, and optional notification credentials in private Site runtime settings. Variable names are `SHAREPASS_OWNER_EMAIL`, `SHAREPASS_OWNER_HANDLE`, `SHAREPASS_OWNER_PASSWORD_PEPPER`, `SHAREPASS_FCM_SERVICE_ACCOUNT`, `SHAREPASS_WEB_PUSH_PUBLIC_KEY` and `SHAREPASS_WEB_PUSH_PRIVATE_JWK`.
- Code reuse is enabled unless `SHAREPASS_ALLOW_CODE_REUSE` is exactly `0`. Before deployment, verify the intended value in protected operational configuration and confirm every staff client supports receipt-bound verification. Set it to `0` during a staged rollout when needed. This source default is not evidence of the live configuration.
- Numeric allocation and legacy lookup compatibility are separate concerns: verification, refresh and admin reissue reject letter codes. Before deploying, complete or reconcile outstanding letter-code pickups using the current desk, as required by the release workflow. Synthetic tests establish this boundary, not whether any live records need reconciliation.

The release owner sets their password only in the deployed site's verified owner account. Keep production inputs, signed packages and database exports outside Git. Follow the [release workflow](../docs/sharepass-release-workflow.md) for migration, backup, restore and hosted checks.

Receipt-alert maintenance runs independently after the current receipt is loaded.
Each visit samples at most 16 cached scopes, advancing a local cursor for later
visits. It takes only available per-receipt Web Locks, verifies the cached booth,
ticket hash and exact worker scope, and asks that receipt's own booth for read-only
alert status. Only an explicit inactive response permits cleanup of matching
browser resources. Automatic page/worker checks retain inactive proof as a cleanup
index rather than orphaning an undiscoverable registration. An endpoint-free
teardown marker is saved before unsubscribe so later visits can retry a failed
unregister, including after reload. Unmarked missing subscriptions remain
uncertain; live renewal clears the marker. Live server extensions,
offline/uncertain responses, malformed
proof, busy locks and replaced resources are preserved. Local expiry alone is
never revocation. Without Web Locks maintenance is nondestructive; without local
storage its cursor lasts only for the page lifetime. This is opportunistic cleanup
on visits, not a guarantee that an unopened browser removes dormant registrations.
