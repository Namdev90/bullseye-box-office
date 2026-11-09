# Development and verification

[Documentation index](README.md) · [Contributing](../CONTRIBUTING.md)

## Prerequisites and layout

The local runtime requires **Python 3.10+** and the standard library, including SQLite. There is no `requirements.txt`, package-based frontend build or `package.json` on reviewed `main` at `4561791`.

Use a recent Node.js version for the JavaScript checks. The repository does not declare a minimum Node version; the documentation audit ran them with Node **v24.22.1** and Python **3.12.14**. Those are observed test versions, not newly established support guarantees.

| Path | Role |
| --- | --- |
| `app.py` | CLI, local HTTP service, domain rules and SQLite storage |
| `static/` | Frontend served by the local Python application |
| `tests/` | Python contracts, Node state checks and optional browser harness |
| `public-demo/dist/` | Buildless disposable browser demo; its own in-memory model |
| `public-demo/tests/` | Model, interrupted workflow and short-code regression checks |
| Root Markdown documents | Product workflow, safety, references and historical validation |
| `docs/` | Implementation handbook and source-linked history |

The static frontend copies are related but not interchangeable. `static/app.js` uses the HTTP API and session recovery; `public-demo/dist/app.js` uses disposable memory. Preserve that distinction when changing shared design or workflow behavior.

## Run the automated checks

Run from the repository root:

```sh
python3 -m unittest discover -s tests -v
node tests/ui_state_test.cjs
node public-demo/tests/demo-store.test.cjs
node public-demo/tests/tactile-flow.test.cjs
node public-demo/tests/short-code.test.cjs
node --check static/app.js
node --check static/desk-enhancements.js
node --check public-demo/dist/app.js
node --check public-demo/dist/demo-store.js
node --check public-demo/dist/desk-enhancements.js
```

On Windows, substitute `py` for `python3`. The Python suites use temporary synthetic databases and local HTTP servers. Node model/state checks are not real-browser tests; `node --check` validates syntax, not lint/style or behavior. No TypeScript check, package linter or framework build exists on this branch.

### Documentation-audit verification, 9 November 2026 UTC

Executed against source `4561791` in an isolated checkout:

| Check | Result |
| --- | --- |
| Python unittest discovery | 42 passed |
| Local UI state checks | 18 passed |
| Disposable demo model checks | 20 passed |
| Tactile/interrupted workflow model checks | 12 passed |
| Four-character practice-code checks | 5 passed |
| Syntax checks for all five JavaScript files above | Passed |
| `python3 app.py --help` | Confirmed the documented CLI options |

No application source changed in this documentation update. Earlier browser observations remain in [TEST_REPORT.md](../TEST_REPORT.md) and [SHAREPASS_RELEASE.md](../SHAREPASS_RELEASE.md); they were not rerun for this audit. There is no GitHub Actions workflow in the reviewed `main` tree. The workflow and Android build evidence in [History](HISTORY.md) belong to separate draft work.

## Optional browser harness

[`tests/browser_smoke.py`](../tests/browser_smoke.py) requires already-installed Playwright and Chromium. It is outside unittest discovery:

```sh
python3 tests/browser_smoke.py
```

`CHROMIUM_PATH` selects an existing browser executable; `SMOKE_ARTIFACTS` selects a private screenshot directory. Do not install browsers or bypass environment restrictions just to claim this check passed. The harness is older than later UI revisions, so validate its selectors and assumptions before treating its result as current UI coverage. It was **not run** for this documentation audit.

For intentional UI changes, test opening/desk navigation, keyboard focus, reduced motion, narrow screens, repeated clicks, cancel/close/back actions, interrupted handovers, stale balances, server disconnects and restart recovery. Use only synthetic data. Never open a real WhatsApp handoff to test a preview; no third-party send is required.

## Documentation review checklist

1. Confirm commands and paths exist in the target branch.
2. Distinguish source behavior from historical test reports, proposed changes and deployments.
3. Link dated history to exact commits or PRs. Do not convert commit dates into an unsupported public release claim.
4. Check relative Markdown targets and run `git diff --check`.
5. Review `git diff --name-only` and staged contents for source changes, runtime data and secrets.
6. Keep manual/browser/device checks explicitly passed, failed, blocked or not run.
7. Recheck the remote base and active PRs before opening or updating the documentation PR.
