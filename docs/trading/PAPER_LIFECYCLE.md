# Connected paper lifecycle

This implementation adds a local paper workspace at `/?paper=1` and preserves `/?demo=1` as isolated simulation. The original planner and cloud Journal remain available outside paper mode. Paper campaigns and their Journal rows use the same server ledger; browser storage is not the execution authority. A prepared ticket is not an order, an acknowledgement is not a fill, and an unfilled entry is excluded from the paper Journal.

## Execution boundary

- The existing operator-verified account/client/endpoint binding is mandatory. The official TWS SDK is installed from the local IBKR distribution, not an unofficial package. A new process/connection starts disarmed even when server submissions are enabled.
- `BRONTIDE_IBKR_SUBMISSIONS_ENABLED=false` remains the default. TWS Read-Only stays enabled through preparation. No web endpoint changes either server configuration or the operator's approval file.
- Prepare fresh session-specific tickets, review their complete prices and exit rules, and approve the exact batch/source/account/connection before arming. Old September 10 tickets are not repriced or reused.
- The small acceptance policy allows three shares per campaign, two simultaneous campaigns, $500 simultaneous entry notional, $10 planned technical-stop risk per campaign and $20 total. These are test limits, not application trading defaults or guaranteed loss limits.
- Pre-existing positions and working orders exclude a candidate. PL and AMD are explicitly excluded. Commands target only ledger-owned order IDs, exact contract IDs, account/client identity and order references; there is no global cancellation, order binding, live mode, or market-order cleanup.

Each campaign uses one-share entry/protection brackets, with the parent staged and its child transmitted last. This is a deliberate adaptation for the three-share test ceiling: each filled share keeps its own broker-held stop. After entry finalization, deterministic largest-remainder allocation assigns targets and up to two independent runners. Each share's stop and optional target/cleanup limit share one OCA type-1 (cancel with block) group. Stops are never cancelled simply to create room for exits. Every active leg needs a share. If a cancelled partial entry leaves too few shares, exits remain staged until an explicit amendment simplifies the allocation; initial protection remains in place.

The broker must acknowledge order fields, quantity and the OCA relationship; connected paper evidence is still required for actual activation, trigger/fill and OCA cancellation. See [IBKR bracket transmission](https://interactivebrokers.github.io/tws-api/bracket_order.html) and [OCA types](https://interactivebrokers.github.io/tws-api/oca.html). These official legacy references describe the fields exposed by the installed 10.30.1 SDK; contract/session eligibility is refreshed at runtime.

Short calculations are implemented and tested symmetrically, but actual short submissions remain blocked because the existing acceptance ticket cannot enforce both fill bounds. Opening auctions and both overnight modes remain blocked. Regular-hours Limit, capped midpoint and stop-limit breakout preparation are supported; regular-plus-extended requires independent LMT entry and STP LMT protection eligibility. Planned stop risk does not guarantee execution of a triggered stop-limit.

## State, persistence and automation

`BRONTIDE_PAPER_DATABASE` selects a private SQLite ledger. Default: `%LOCALAPPDATA%\Brontide\paper-lifecycle.sqlite3`, separate from the EOD database. It persists campaigns, exact commands, acknowledgements, execution identities, fees and amendment drafts with full synchronous transactions. Initial command/order identities are durable before socket transmission. Unknown outcomes cannot be resubmitted under a new key. Replaced orders remain attributable so late executions cannot disappear.

The service owns a serialized background worker and a dedicated TWS client. It consumes callbacks and periodically completes account/position/open-order and execution snapshots. Position absence never invents a closing execution. Unexplained position differences, unexpected order fields, persistence errors and identity conflicts pause execution for reconciliation. Reconnect imports actual events idempotently and does not automatically arm the previous batch.

Targets stay staged until every entry share is filled or its remainder reaches a broker terminal state. Execution R freezes from actual average entry and the original stop. Breakeven and independent dollar/percentage/manual/SMA/day-extreme runner calculations use fresh live executable-side quotes. SMA/day-extreme inputs come from current-session IBKR daily bars and are cached for at most 60 seconds; missing references pause that trailing rule. No EOD quote substitutes for an execution quote. Tighter confirmed stops are never loosened. One rejected stop permits one reconciled replacement; a second rejection remains visibly Unprotected.

An amendment is saved separately from application, bound to campaign revision and quantity, and requires its exact digest in the approval receipt. Applying it updates automation policy; each resulting order change remains pending until broker confirmation. Working exits must first be cancelled and reconciled before reallocation. Initial ticket intent remains immutable.

Cleanup first cancels batch-owned targets and waits for confirmation. It keeps each share's protective stop, uses a fresh tick-valid DAY limit at or above the immutable cleanup floor and any tighter confirmed stop, and joins the same OCA-with-block group. It permits two attempts per remaining one-share tranche, cancelling an unfilled attempt after 60 seconds before replacement. No market fallback or lower floor is available. A flat campaign remains Closing until sibling orders also reach terminal states.

Net realized P&L and final net R stay unavailable until commissions are complete; late fees revise the same campaign. Repeated execution IDs have one economic effect. Conflicting corrections require review rather than silently rewriting history. External manual executions not attributable to the owned campaign are surfaced as a reconciliation mismatch, not automatically associated or fabricated.

## Local API and review receipt

All routes are under `/v1/ibkr/paper`. Mutations require `X-Brontide-Local: 1`; cross-origin and non-loopback access are rejected.

| Method / route | Effect |
| --- | --- |
| GET `/status` | Masked account, connection/batch state, campaign revisions and Journal summaries |
| POST `/connect`, `/disconnect`, `/reconcile` | Owned paper connection and completed broker reads; disconnect retains broker-held stops |
| GET `/quote/{symbol}` | Qualified contract and fresh TWS bid/ask |
| POST `/batches` | Freeze one or two exact tickets for review; no order |
| POST `/batches/{id}/arm`, `/disarm` | Validate private approval / lock all new commands |
| POST `/submit` | Approved batch ID, ticket index and unique command ID; one economic campaign per ticket |
| POST `/campaigns/{id}/actions` | Revision/key-bound entry cancellation, exit cancellation, cleanup, draft save/apply and rule resume |

Set `BRONTIDE_PAPER_APPROVAL_FILE` to a private local receipt **only after the operator approves the exact batch**. It contains `batchId`, `ticketDigest`, `sourceIdentity`, `accountBinding`, `connectionId`, and timezone-qualified `approvedAt`; approved amendments additionally require `approvedAmendmentDigests`. Status exposes only a hash of the account binding, never the full account ID. Receipt creation is not itself user approval. An expired batch cannot arm or submit new entries. An already armed batch may finish protected cleanup during eligible sessions.

## Verification and outstanding acceptance

`tests/test_paper_lifecycle.py` covers durable-before-send behavior, idempotency, transport uncertainty, partial-entry finalization, independent protection, one stop replacement, amendment approval, late fees, snapshot absence, restart replay, external-position mismatch and API origin checks. Shared JSON fixtures verify server/browser allocation and risk calculations. Browser tests cover the distinct paper mode, locked controls, errors, dialog Escape/focus, empty Journal, and wide/narrow/wide layout. Run the repository's `npm run verify`; use direct browser inspection and match the served source identifier before handoff.

The historical 38-scenario matrix remains authoritative about prior evidence. This implementation adds deterministic integration evidence, not a claim of paper executions. Actual acknowledgements, fills, stop activation/trigger/fill, target/runner exits, cancellation timing and reconnect with working orders require the fresh exact approved batch. Precise race/partial-fill/rejection timing remains deterministic evidence where it cannot be safely induced. Short, auction and overnight cases remain explicitly blocked; unexpected external manual executions require operator reconciliation.
