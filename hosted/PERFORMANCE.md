# Scoped message-read performance

Baseline: current main `db0c7ca4fd0d31b046f590dc4bdc1768d77dbb24`, observed live web v36 on 14 November 2026. No frontend appearance or custody transition is changed by this patch.

The administrator feed returned its latest 50 messages, then fetched recipients separately for every per-person message. The revised handler reads recipients once for only those visible message IDs and the authenticated workspace. Legacy messages retain their original fields and response semantics. The page limit, ordering, identity checks and inbox query remain unchanged.

Migration `0016_staff_prompt_recent.sql` adds `(workspace, created_at DESC, id DESC)`. With 1,000 retained messages, the original recent-message query used the primary-key workspace prefix and a temporary sort. The revised plan reads the new index in result order and stops at the existing 50-row limit. Existing recipient primary-key and inbox indexes already cover the joins; no additional recipient index was added.

## Comparable measurements

The benchmark alternates baseline and candidate reads in the same Node process, with identical synthetic databases, 10 warmups and 60 samples per variant. The larger case contains 1,000 retained messages, 50 current per-person messages and 12 recipients per message, plus matching message IDs in an unrelated workspace. Every compared response is byte-identical, including ordering and legacy fields.

| Latest 50 per-person messages | Before | After |
| --- | ---: | ---: |
| API requests per read | 1 | 1 |
| SQL executions | 54 | 5 |
| Recipient queries | 50 | 1 |
| JSON response bytes | 74,374 | 74,374 |
| Local median | 2.631 ms | 2.413 ms |
| Local p95 | 9.692 ms | 8.970 ms |

With 10 per-person messages, SQL executions fall from 14 to 5. Legacy-only pages stay at 4 queries and perform no recipient query. Payload size is deliberately unchanged because the existing interface needs the scoped recipient responses; it is not truncated to improve a benchmark.

These are in-memory SQLite fixture timings, including Worker request handling and JSON serialization. They are not production D1 latency, network or capacity measurements. Shared-host timing has variance; the deterministic evidence is the query reduction, unchanged payload, permission regressions and removal of the recent-feed temporary sort. The benchmark reports all cases rather than assuming every timing percentile improves.

Build the baseline Worker in a separate preserved checkout, then from this directory:

```sh
node scripts/build.mjs
node scripts/measure-reads.mjs /absolute/path/to/baseline/dist/server/index.js
node --test tests/read-performance.test.mjs
```

The comparison fixture removes only the candidate index from the baseline's disposable in-memory database. It never connects to a hosted database. The reported `rowsReturned` counts result rows, not database pages or D1 rows scanned.

## Existing optimizations retained

- Static assets already use version/content fingerprints, immutable caching and conditional responses. Authenticated APIs remain `no-store`.
- Android's approved artwork already uses a single process bitmap cache. First-screen branding and scanner readiness are not delayed by new lazy loading.
- Booth reference data and screen results already have session/device scope. Normal visible queue fallback is 60 seconds and background polling pauses.
- Current pickup and stock mutations still obtain server state, validate claims/versions and preserve atomic, idempotent recovery. No cached result or optimistic success authorizes access or a physical handover.
- The legacy complete-state endpoint and existing pagination contracts are preserved for old clients.

## Release boundary

This candidate is not deployed. After required review/approval: take and restore-check a fresh encrypted live backup, apply the additive index migration through the existing Sites workflow, publish the reviewed Worker with unchanged web assets, then verify the deployment and register integrity. Keep physical device and production latency acceptance distinct from fixture results.
