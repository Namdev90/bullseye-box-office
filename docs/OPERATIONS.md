# Local operations and recovery

> **Current integration branch:** The handbook below records the reviewed main snapshot. See [cloud reconciliation](CLOUD_RECONCILIATION.md) and [START_HERE](../START_HERE.md) for the newly combined emulator feature, fixes, verification and outstanding laptop comparison.

[Documentation index](README.md) · [Development](DEVELOPMENT.md) · [Staff workflow](../README.md#staff-workflow)

These instructions are for the synthetic training application on `main` at `4561791`. They are not authorization or a runbook for a live event. Keep the laptop trusted and the server on loopback.

## Start and stop

From the repository root, with Python 3.10+:

```sh
python3 app.py
```

Windows: `py app.py`. Open the address printed by the process, normally `http://127.0.0.1:8765`. Stop the server with Ctrl+C. An internet outage does not stop local custody operations, but stopping the Python process does. WhatsApp still requires its own connectivity.

CLI options are confirmed by `python3 app.py --help`:

| Option | Behavior |
| --- | --- |
| `--port PORT` | Local port, default `8765`; does not change the loopback bind |
| `--db PATH` | Database path; default `_runtime/shared-code-training.sqlite3` beside `app.py` |
| `--demo` | Seed three synthetic deposits; repeated seeding replays the same actions and does not print private codes |
| `--backup PATH` | Create an integrity-checked SQLite snapshot and matching key companion, then exit |

There is no `--android-emulator` option on this reviewed branch. It belongs to [unmerged PR #1](https://github.com/Namdev90/bullseye-box-office/pull/1).

For a separate practice exercise, select a **new filename**, for example:

```sh
python3 app.py --db _runtime/practice-session-02.sqlite3 --port 8766
```

Do not delete or overwrite an existing database/key to obtain fresh examples. New databases get two synthetic events that close seven days after creation. Existing events are not automatically reopened; no event-management endpoint exists.

## Files to protect

- The chosen database and its `-wal` / `-shm` sidecars while SQLite is running.
- The matching `<database-filename>.verification.key` file.
- Backups, temporary exports and any screenshots showing a collection code.
- The browser tab holding a pending mutation and its session storage.

The app does not encrypt runtime data or backups. The database and key together allow code recovery. Never attach them to a public issue/PR or include them in an archive of source. `.gitignore` excludes common runtime paths and extensions, but review every staged file.

## Backup

Use the application's SQLite online-backup routine, with a new destination:

```sh
python3 app.py --db _runtime/practice-session-02.sqlite3 --backup /private/path/new-snapshot.sqlite3
```

Replace the example destination with an appropriate private location outside a published directory. This creates both `new-snapshot.sqlite3` and `new-snapshot.sqlite3.verification.key`. It refuses to overwrite either target and runs `PRAGMA integrity_check` on the snapshot. Do not substitute a plain copy of a live WAL database.

There is no automated restore/failover command. A backup can contain balances that were later collected. Keep the matching pair intact, reconcile subsequent releases and physical stock, and never run restored and original copies as independent authorities. A missing, wrong-size or mismatched key is a stop condition, not a reason to generate a replacement.

## Recovery decision guide

| Situation | Safe response |
| --- | --- |
| Port already in use | Check which process owns the desk; do not accidentally create a second inventory. A different port is appropriate only for an intentional separate synthetic exercise. |
| Home/API says local session required | Open the printed home address again. If a request was interrupted, retain its original body and use recovery after session refresh. |
| Request timed out or server restarted | Do not hand over from stale instructions. Restart the same database/key pair, keep the original tab and use **Recover saved request**. |
| Recovery returns `not_applied: true` | The rejected request did not apply; follow the UI to reverify if needed before starting a new action. |
| Recovery conflicts or remains uncertain | Stop and reconcile recorded actions with stock. Do not replace the request ID to force it through. |
| Release recorded, handover unconfirmed | Quantities are already subtracted. Original operator checks the exact collection and physical stock, then completes/confirms that same handover once only if established. |
| Key missing, invalid or mismatched | Stop and locate the matching backup pair; do not generate a replacement or edit the database fingerprint. |
| Event expired or shelf occupied | Use a separate new synthetic database for a fresh exercise, or a fresh slot as appropriate. Do not edit live-style ledger records to bypass checks. |
| Too many failed code checks | Wait for the rolling one-minute budget to clear. Changing event does not reset the local desk-wide limit. |

An original browser tab may be the only place retaining an uncommitted request body. If it is lost, stop and reconcile the administrative record and stock with a supervisor. The application cannot infer whether passes physically changed hands. Never automatically restore reserved quantities or issue replacements.

## Public demo and publication boundary

For a local disposable browser demonstration, serve only its static folder:

```sh
python3 -m http.server 8080 --bind 127.0.0.1 --directory public-demo/dist
```

Open `http://127.0.0.1:8080`. Reloading resets it; another tab starts another inventory. This server is for local preview, not a production service. Deployment metadata lives in `public-demo/.openai/hosting.json`; this documentation does not deploy or reconfigure the Site.

A static deployment must contain only `public-demo/dist/`. Do not publish `app.py`, runtime databases or keys as a web-hosting workaround. Do not expose the Python training server with LAN binding, a tunnel or a public reverse proxy. Real multi-counter operation needs the separate production requirements in the [project README](../README.md#before-live-use).
