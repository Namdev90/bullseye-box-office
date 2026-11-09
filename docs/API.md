# Local API reference

[Documentation index](README.md) · [Architecture](ARCHITECTURE.md)

This describes [`app.py`](../app.py) at `4561791` for local development and synthetic tests. It is an internal training API, not a public integration or production authentication contract. The static browser demo simulates similar routes without a backend.

## Session and request requirements

1. Start `python3 app.py` and open `/` at the printed loopback address. The response establishes the `custody_session` cookie.
2. `GET /api/state` requires that cookie and returns the current `csrf` value.
3. Every POST, including verification, requires the session cookie, `X-CSRF-Token`, `Content-Type: application/json` and a JSON body of 1–16,384 bytes. If an Origin header is present, it must exactly match `http://` plus the accepted Host.

Accepted Host values on this branch are `127.0.0.1:<port>` and `localhost:<port>`. The CLI binds only to IPv4 loopback. Restarting changes session and CSRF values. Reload the home page before recovering an interrupted request, keeping the original mutation body unchanged. Do not log cookies, tokens, codes or request bodies.

All successful API responses use HTTP 200. Errors contain `error` (human-readable), `code` and `not_applied`. Never infer whether a mutation committed from HTTP status alone. `not_applied: false` means the caller must preserve/reconcile the original request; it does not mean the mutation definitely occurred.

## Routes

| Method and path | Required request data | Result |
| --- | --- | --- |
| `GET /api/state?event_id=<id>` | Optional event query; defaults to `training-event-001` | Selected event, event list, deposits, collections, latest 100 audit entries, aggregate counts and CSRF value |
| `POST /api/verify` | `event_id`, `collection_code` | Deposit, `claim_token`, `expires_in` (120 seconds) |
| `POST /api/deposits` | Mutation common fields plus `location`, `quantities`, `custody_confirmed: true` | Deposit, private `collection_code`, `collection: null`, replay flag |
| `POST /api/deposits/<deposit_id>/release` | Mutation common fields plus `claim_token`, deposit `version`, `packet_id`, `quantities` | Updated deposit, recorded collection and replay flag |
| `POST /api/collections/<collection_id>/handover` | Mutation common fields plus collection `version`, `handover_confirmed: true` | Updated deposit, confirmed collection and replay flag |

There are no event create/edit/reopen, cancellation, deletion, correction, code rotation, code revocation, photo or notification routes. Backup is a CLI operation.

### Mutation common fields and validation

- `request_id`: nonempty string up to 100 characters; retain the exact ID/body for retry.
- `operator`: nonempty staff label up to 80 characters; no identity authentication.
- `event_id`: nonempty string up to 60 characters.
- Required text is trimmed and rejects control characters.
- `location`: nonempty string up to 30 characters; stored uppercase and unique in the event.
- `quantities`: exactly the keys `normal`, `vip`, `vvip`; each must be an integer from 0 to 100, with a positive total. Booleans are not integers for this validator.
- `version`: must be an integer matching the relevant current deposit or collection.
- Confirmation fields must be the JSON boolean `true`.

Example deposit body, using synthetic labels only:

```json
{
  "request_id": "replace-with-a-new-unique-request-id",
  "operator": "Practice operator",
  "event_id": "training-event-001",
  "location": "TRAINING-01",
  "quantities": {"normal": 2, "vip": 1, "vvip": 0},
  "custody_confirmed": true
}
```

Generate a fresh ID for each new action; preserve it for identical retries. Do not paste generated private code/token responses into issues or documentation.

### Response records

A deposit includes its internal `id`, `event_id`, public `packet_id`, `location`, `created_by`, `created_at`, `version`, `initial` and `remaining` quantity objects, and `pending_collection` or `null`. It omits the stored code digest. The code appears only in the deposit action result, including an identical replay.

A collection includes `id`, `event_id`, `deposit_id`, `packet_id`, `quantities`, `status`, `version`, creation operator/time and handover operator/time. Status is `RELEASE_RECORDED` or `HANDED_OVER`.

State aggregate counts are `DEPOSITS`, `PASSES_REMAINING`, `UNCONFIRMED` (collection count) and `HANDED_OVER` (pass quantity). They should not be confused with UI counts or with each other.

## Verification and release semantics

Local collection codes have 12 characters from the nonambiguous alphabet, displayed in three four-character groups. Verification normalizes case, spaces and hyphens and is event-bound. Five failed attempts in a rolling 60-second window block further checks until the window clears, including correct codes. The budget is shared across the local desk and persists in SQLite.

Verification produces a claim, not a guarantee that a later release will succeed. The local API can return a valid deposit with a pending handover or exhausted balance; the UI and release checks determine what can happen next. The claim expires after two minutes and is invalidated by a server restart. Recording a release also checks current version, packet match, positive available quantities and no pending handover.

A successful release subtracts stock before physical handover. Confirmation records the handover without subtracting again. The original operator label is required for confirmation. Never turn a transport retry into another physical handover.

## Important errors

| Code | Typical status | Meaning / response |
| --- | --- | --- |
| `REQUEST_REJECTED` | 401, 403, 404 or 415 | Session, host, origin, CSRF, route or content-type rejection; inspect `not_applied` and preserve uncertain work |
| `INVALID_REQUEST` | Usually 400 | Input or unsupported operation; follow the message |
| `EVENT_NOT_FOUND` / `DEPOSIT_NOT_FOUND` / `COLLECTION_NOT_FOUND` | 404 | Resource absent from the selected event |
| `EVENT_CLOSED` | 409 | No new deposit/release; pending handover reconciliation remains available |
| `CODE_NOT_ACCEPTED` | 404 | Code/event combination not accepted; counts toward failed attempts |
| `RATE_LIMITED` | 429 | Wait for the rolling failure window; do not bypass it by resetting records |
| `CLAIM_EXPIRED` | 401 | Uncommitted claim invalid/expired; resolve the saved request before verifying again |
| `SLOT_OCCUPIED` | 409 | Use a new synthetic shelf slot |
| `STALE_BALANCE` | 409 | Refresh and verify against current balances after resolving any pending request |
| `HANDOVER_PENDING` | 409 | Reconcile the existing collection before another release |
| `WRONG_PACKET` | 400 | Physical packet ID does not match |
| `OVER_RELEASE` | 409 | Requested counts exceed the remaining categories |
| `STALE_HANDOVER` / `OPERATOR_MISMATCH` | 409 | Reconcile the existing collection; do not repeat handover |
| `REQUEST_CONFLICT` | 409 | Same request ID with different payload; `not_applied` is false |
| `UNCERTAIN_OUTCOME` | 500 | Preserve the exact saved request and reconcile; `not_applied` is false |

Use the executable examples in [`tests/test_app.py`](../tests/test_app.py), especially `HTTPTests.test_full_http_workflow`, to inspect exact request/response handling without introducing real records.
