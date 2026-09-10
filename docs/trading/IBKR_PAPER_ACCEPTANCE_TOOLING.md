# Paper acceptance tooling

The canonical preparation package is [IBKR_PAPER_ACCEPTANCE_PACKAGE.json](IBKR_PAPER_ACCEPTANCE_PACKAGE.json). It preserves the approved R2 prices and cleanup floors, holds the separately identified premarket ticket, leaves postmarket numeric fields pending same-session evidence, and keeps both overnight modes blocked.

`scripts/ibkr-paper-acceptance.py` extends the existing read-only service and `prepare_paper_intent` validator. It contains no submission, modification or cancellation command. TWS Read-Only and `BRONTIDE_IBKR_SUBMISSIONS_ENABLED=false` remain unchanged while using it.

## Immutable approval binding

From the repository root, calculate a selected batch digest:

```powershell
services\eod\.venv\Scripts\python.exe scripts\ibkr-paper-acceptance.py digest --batch BRONTIDE-RTH-20260910-R2
```

An approval receipt is a local JSON file containing only:

```json
{
  "batchId": "exact batch ID",
  "sourceIdentity": "exact served/source preview identity",
  "ticketDigest": "full digest printed by the command above",
  "approvedTicketIds": ["the exact executable ticket IDs and no others"],
  "approvedAt": "timezone-qualified timestamp"
}
```

The receipt contains no account ID or credential and must not be committed. Any source-identity, ticket-content, ticket-set or batch mismatch stops preflight. Batch validity windows reject future or expired tickets; prices are never refreshed into the manifest.

## Read-only selected-batch preflight

Start the local preview from the intended checkout with the verified private binding and submissions disabled. Then run:

```powershell
services\eod\.venv\Scripts\python.exe scripts\ibkr-paper-acceptance.py preflight --batch BRONTIDE-RTH-20260910-R2 --base-url http://127.0.0.1:8765 --approval C:\private\r2-approval.json --output artifacts\ibkr-paper\r2-preflight.json
```

Omit `--approval` only for preparation; the result is labelled `preparation-only` and cannot establish approval. Add `--persist-intents` only when the exact eligible intent should be retained by the existing private intent store. Intent persistence still cannot submit an order.

Preflight compares the current source identifier with the served preview, reuses the operator-verified account binding, and requires fresh completed account/position/open-order snapshots. It verifies exact PL/AMD exclusions, rejects any candidate symbol already present in a position or working order, classifies the current phase from broker trading/liquid schedules, and checks contract identity, route, order types, minimum tick, live type-1 quote, drift and immutable entry bound through the existing intent validator. Wrong-session candidates remain pending; changed, expired, unsupported, stale or out-of-bounds candidates fail without repricing.

Exit code 0 means every executable ticket in the selected batch validated read-only. Exit code 2 means blocked. Exit code 3 means a required session is pending. A passing preflight is not order acknowledgement or fill evidence.

## Private event evidence

The future approved execution adapter can persist each received callback or reconciliation observation as a small local JSON event, then append it with:

```powershell
services\eod\.venv\Scripts\python.exe scripts\ibkr-paper-acceptance.py record --event C:\private\event.json --state C:\private\brontide-paper-evidence.json
```

Required event fields are `eventId`, `batchId`, `ticketId`, `scenarioId`, `kind`, `occurredAt` and `provenance`. Actual evidence provenance (`IBKR callback`, `IBKR read-only reconciliation`, or `TWS operator observation`) additionally requires a broker order or execution identifier. Supported kinds cover submission, acknowledgement, entry/finalization, protection, target, runner, breakeven, amendment, cleanup, cancellation, unknown outcome, reconciliation, connection, fees and expiry. Duplicate identities are idempotent only when their complete contents match. A conflicting duplicate stops, and a `submission-unknown` prevents a new submission request until `reconciliation-order-found` or `reconciliation-no-order` is recorded.

Generate a report without exposing full broker identifiers:

```powershell
services\eod\.venv\Scripts\python.exe scripts\ibkr-paper-acceptance.py report --batch BRONTIDE-RTH-20260910-R2 --state C:\private\brontide-paper-evidence.json --output artifacts\ibkr-paper\r2-evidence-masked.json
```

The private state keeps broker identifiers for reconciliation. The report replaces them with short one-way references and classifies scenario evidence by provenance. Manually supplied or simulated events never become broker-observed merely because they were recorded.

## Execution boundary after a future approval

This preparation tool deliberately does not place orders. For an approved run:

1. Reconfirm TWS's visible Simulated Trading session, exact paper account, localhost socket and Read-Only setting. Do not infer paper mode from the port or account prefix.
2. Save the exact approval receipt and run the selected-batch preflight above. Stop on any nonzero result; do not edit prices or the receipt.
3. Only after preflight passes and the user separately authorizes that run, temporarily disable TWS Read-Only and enable the existing adapter's submission lock for the exact approved source/batch. Submit through the existing bracket adapter—never through this read-only tool.
4. Feed its broker callbacks and reconciliations into the private evidence ledger. Treat acknowledgement, fill, protection and cleanup as separate observations. Reconcile an unknown result before any retry.
5. Apply the manifest's exact quantity/OCA cleanup policy. If bounded cleanup fails, retain valid protection, block new entries and report the unresolved position.
6. After batch positions are confirmed flat and batch orders cleared, disable submissions and restore TWS Read-Only. Never change, bind, cancel or close PL, AMD or unrelated orders.

There is intentionally no blanket command that can execute future-priced or incomplete tickets. Postmarket requires a newly fixed, separately digested ticket and approval after a same-session quote; overnight modes remain planning-only.
