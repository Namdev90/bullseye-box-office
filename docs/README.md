# SharePass documentation

SharePass is a physical-pass custody **training prototype** in the `bullseye-box-office` repository. Use synthetic passes and staff labels only. It does not sell tickets, validate admission or provide a production event service.

This handbook describes default-branch source at [`4561791`](https://github.com/Namdev90/bullseye-box-office/commit/456179176674d8576c4ba25cb8ff3e07853fbbda), reviewed on **9 November 2026 (UTC)**. It adds navigation and implementation detail without replacing the existing safety and design records.

## Read by task

| Task | Start here |
| --- | --- |
| Understand the product and staff workflow | [Project README](../README.md) |
| Choose the local application or disposable browser demo | [Development and checks](DEVELOPMENT.md) |
| Understand modules, storage and custody transitions | [Architecture](ARCHITECTURE.md) |
| Inspect the local JSON API | [API reference](API.md) |
| Run, back up or troubleshoot synthetic practice | [Operations](OPERATIONS.md) |
| Trace how the repository developed | [Verified project history](HISTORY.md) |
| Prepare a safe contribution | [Contributing](../CONTRIBUTING.md) |
| Review current design and prior validation | [SharePass release notes](../SHAREPASS_RELEASE.md), [test report](../TEST_REPORT.md) |
| Review branding and event-reference boundaries | [References](../REFERENCES.md), [Oktoberfest sources](../OKTOBERFEST_SOURCES.md) |
| Review proposals that are not implemented | [Future features](../FUTURE_FEATURES.md) |

## Which application are you looking at?

| Surface | Implementation on the reviewed `main` | Persistence and limits |
| --- | --- | --- |
| Local laptop desk | `app.py` plus `static/`, served on loopback | SQLite database and matching verification key; 12-character private collection codes; unverified staff labels |
| Static public practice demo | `public-demo/dist/`, with `DemoStore` in browser memory | Four-character practice codes; reset on reload; each tab/device has independent inventory |
| Proposed shared Android-emulator preview | Separate draft [PR #1](https://github.com/Namdev90/bullseye-box-office/pull/1) | Not part of reviewed `main`; do not apply its launcher, SDK or emulator flags to this branch |

The two implementations on `main` do **not** synchronize. Never serve the repository root with a generic static server: it can contain runtime data. Serve only `public-demo/dist/` for the disposable demo, or run `app.py` for the local desk.

## Documentation boundaries

- [History](HISTORY.md) distinguishes commits already on `main` from unmerged work. Dates are UTC unless explicitly stated.
- Existing release/test reports describe their historical verification. A fresh documentation check does not repeat or certify browser, device, production, load or physical-handover testing.
- Future features remain proposals. Photos, automated notifications, NFC, authenticated staff and production multi-device operation are not supplied by this documentation.
- No software licence is present in the reviewed tree. Public source access does not grant an open-source licence. Asset permissions have their own limits in [References](../REFERENCES.md).
