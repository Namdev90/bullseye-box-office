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
- Leave `SHAREPASS_ALLOW_CODE_REUSE` unset until the deployed staff clients support receipt-bound verification and the operator enables reuse.

The release owner sets their password only in the deployed site's verified owner account. Keep production inputs, signed packages and database exports outside Git. Follow the [release workflow](../docs/sharepass-release-workflow.md) for migration, backup, restore and hosted checks.
