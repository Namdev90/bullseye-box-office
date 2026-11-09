# Contributing to SharePass

Start with the [documentation index](docs/README.md), [architecture](docs/ARCHITECTURE.md) and [development checks](docs/DEVELOPMENT.md). This is a public, synthetic training prototype with two deliberately separate implementations.

## Scope and safety

- Work on a separate branch and inspect open PRs before overlapping active feature work.
- Use synthetic passes, shelf slots and staff labels only. Do not add real guest data, runtime databases, verification keys, request logs, private codes or screenshots containing credentials.
- Keep `app.py` loopback-only. Do not expose the training service or weaken Host, origin, session, CSRF, transaction, version or replay checks to make a preview work.
- Preserve the separation between `static/` (Python/SQLite client) and `public-demo/dist/` (disposable browser simulation). Do not copy short practice-code behavior into the custody engine.
- Keep physical release and confirmation separate. No automatic restock or repeated handover after an uncertain response.
- Treat photos, messaging, NFC and multi-device production work as proposals until implementation, permissions and verification are explicitly addressed.

## Change checklist

1. Read the existing workflow, safety notes and relevant tests before editing.
2. Add regression coverage for changed domain/API/UI behavior. Include duplicate, stale, interrupted and cancelled paths where relevant.
3. Run the [automated commands](docs/DEVELOPMENT.md#run-the-automated-checks). Record exact results and any checks not run.
4. Review browser behavior separately for UI changes. DOM/model tests do not certify rendering, accessibility or physical hardware.
5. Update relevant docs, with source-linked history when the change introduces a new capability or changes a boundary.
6. Run `git diff --check` and inspect every staged path and diff. `.gitignore` is not a secret review.
7. Open a focused PR against the intended base. Summarize changes, verification and remaining limits. Do not treat an open or draft PR as merged or deployed.

For documentation-only changes, verify referenced paths, commands and branch status, distinguish observed behavior from proposals, and avoid changing source or dependencies just to make claims true.

## Reporting a problem

For ordinary reproducible bugs, include the branch/commit, OS/runtime versions, synthetic reproduction steps, expected/observed behavior and whether a mutation's outcome was uncertain. Do not include a database/key pair, code/token, real guest detail or private screenshot. Describe sensitive concerns privately through an existing trusted maintainer channel rather than publishing exploitable details or secrets; no dedicated security contact or response SLA is established here.

## Rights

There is no software licence in the reviewed repository. Do not add a licence, grant broad redistribution rights or assume third-party art is freely reusable without an explicit maintainer decision. Existing asset context and permission limits are recorded in [REFERENCES.md](REFERENCES.md).
