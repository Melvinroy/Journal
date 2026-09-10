# Gate 2 QC status

Branch: `codex/trading-plan-position-journal`

Status: **Blocked for complete Gate 2 passage.** The operator-verified TWS paper session is reachable read-only through the private binding, and account summary, two existing positions and a completed-empty open-order snapshot were observed. Submission remains disabled, TWS Read-Only remains enabled and no broker order was submitted, modified or cancelled. Every execution result therefore remains Blocked. A deterministic Pass or read-only observation is not execution evidence.

Evidence command: `node --test tests/ibkr-paper-adapter.test.mjs`

Current execution-package evidence on 2026-09-10:

- Pass — P01–P28 construction, safety and failure simulations remain intact.
- Pass — restart-safe execution-state helpers distinguish validated, submitting, acknowledged, filled, exit, cancellation, rejection, unknown and reconciliation states; intent/idempotency compare-and-set persistence fails closed.
- Pass — final-entry Execution R, deferred threshold touches, one-stop retry, persistent Unprotected, offline automation, stale amendment rejection and quantity-conserving exits are deterministic tests.
- Pass — official `ibapi` SDK is installed in the repository service environment and the exact private paper binding was revalidated over client ID 71.
- Pass (read-only broker evidence) — account summary completed, two existing 100-share positions were retained as unlinked and open orders completed successfully with zero rows.
- Blocked — broker quote entitlement/freshness and every order/execution scenario until the reviewed batch is explicitly approved and TWS Read-Only is deliberately disabled for that session.

| ID | Simulated result | Actual paper result |
| --- | --- | --- |
| P01 | Pass — capped long MIDPRICE and full-share stop constructed | Blocked — no paper gateway/order evidence |
| P02 | Pass — short entry/protection mirrored; invalid stop rejected | Blocked — no paper gateway, permission or borrow evidence |
| P03 | Pass — MIDPRICE ticket has no market fallback | Blocked — no observed working paper order |
| P04 | Pass — cent changes within cap remain eligible | Blocked — no live paper quote/submission evidence |
| P05 | Pass — quote crossing cap becomes ineligible | Blocked — no broker submission observation |
| P06 | Pass — STP LMT trigger and separate worst price constructed | Blocked — no paper trigger/fill evidence |
| P07 | Pass — gap beyond cap is ineligible; no market conversion | Blocked — no paper gap observation |
| P08 | Pass — exact `LMT` + `OPG` construction; submission fails closed | Blocked — IBKR documents Auction as unsupported in paper; unvalidated auction submission disabled |
| P09 | Pass — every Gate 2 entry/protection ticket is RTH-only | Blocked — no broker rejection/compatibility evidence |
| P10 | Pass — cumulative fills require equal stop coverage; targets staged | Blocked — no fragmented broker fills |
| P11 | Pass — final protected partial quantity alone activates exits | Blocked — no broker cancel/expire evidence |
| P12 | Pass — edited one-target + runner allocation conserves shares | Blocked — no paper target execution |
| P13 | Pass — 35/35/30 allocation and rounding conserve shares | Blocked — no paper target execution |
| P14 | Pass — partial-entry threshold touches are recorded while initial protection remains; advanced rules stay deferred | Blocked — no broker touch/partial-entry evidence |
| P15 | Pass — after entry finalization, only a fresh qualifying bid/ask against frozen Execution R can advance protection; target fills are irrelevant | Blocked — no qualifying paper quote/modify evidence |
| P16 | Pass — tighter long/short stops are never loosened and market-invalid proposals fail closed | Blocked — no broker modification evidence |
| P17 | Pass — SMA10/20/50, day extreme, dollar, percentage and manual rules tested | Blocked — no working paper runner orders |
| P18 | Pass — first stop rejection produces exactly one retry action | Blocked — no broker reject/accept evidence |
| P19 | Pass — second rejection persists Unprotected; no auto-market-close | Blocked — no repeated broker rejection evidence |
| P20 | Pass — duplicate idempotency key submits once | Blocked — no duplicate-click broker order comparison |
| P21 | Pass — timeout reconciles broker reference before retry | Blocked — no accepted-then-timeout broker evidence |
| P22 | Pass — reconnect state reconstructs cumulative fill/protection | Blocked — no gateway disconnect/restart evidence |
| P23 | Pass — broker quantity wins race and delta is imported once | Blocked — no broker cancel/replace race evidence |
| P24 | Pass — external liquidation reaches zero and closes campaign | Blocked — no manual paper liquidation evidence |
| P25 | Pass — external quantity delta receives Changed in IBKR semantics | Blocked — no manual paper modification evidence |
| P26 | Pass — EOD fallback is dated/non-executable; absence is not fabricated | Blocked — no connected stale/missing data observation |
| P27 | Pass — equity accepted only for exact active connection; stale connection rejected | Blocked — no paper account-value stream/failure evidence |
| P28 | Pass — warning remains pending until explicit confirm/cancel | Blocked — no IBKR precautionary warning evidence |

P08 sources: IBKR's API order-type documentation specifies Limit-on-Open as a limit order with `orderType=LMT`, `tif=OPG`, quantity and limit price. IBKR's paper-account guide says some order types, including Auction, are unsupported. These simulated checks do not prove opening-auction execution.

## Requirement mapping added after P01–P28

| Requirement | Scenarios and evidence | Current result |
| --- | --- | --- |
| Durable intent and idempotency before submit | P20–P22 plus execution-store compare-and-set/restart tests | Pass simulated; actual submission Blocked |
| Precise acknowledgement, fill, cancellation and unknown states | P10–P11, P18–P23 plus lifecycle transition tests | Pass simulated; actual callbacks Blocked |
| Full confirmed protection before advanced exits | P10, P11, P14, P18, P19 | Pass simulated; actual fragmented fills/rejections Blocked |
| Frozen Execution R and executable-side trigger quotes | P14–P17 plus final-average risk-freeze tests | Pass simulated; actual quote/modify evidence Blocked |
| Quantity conservation and race safety | P12, P13, P23–P25 | Pass simulated; actual concurrent broker events Blocked |
| Explicit, revision-safe amendments | P23–P25 plus unapplied/applying/confirmed/stale tests | Pass simulated/local; actual broker apply Blocked |
| One Journal campaign and fixed-risk accounting | Shared campaign tests and the $80-risk example: $10 gross − $2 costs = $8 / +0.10R | Pass simulated/local; actual executions/commissions Blocked |
| Read-only identity/account/position/order inspection | P26–P27 and connected smoke/UI refresh | Pass actual read-only; not execution evidence |

The two existing external positions (100 shares each) are excluded from the execution batch by exact broker instrument identity. They must not be auto-associated, amended, cancelled, liquidated or used as order test instruments.

## Session-extension scenarios

These extend rather than renumber P01–P28. “Pass” below is deterministic construction/state evidence only; no session is broker-validated until an order is actually observed during that session under a separately approved numeric ticket.

| ID | Requirement | Deterministic result | Actual paper result |
| --- | --- | --- | --- |
| P29 | Regular-hours defaults remain SMART MIDPRICE, independent DAY/GTC and RTH-only protection | Pass | Blocked — no new order submitted |
| P30 | Premarket explicit LMT entry and independently flagged STP LMT protection | Pass — contract types/schedule, tick and direction required | Blocked — no premarket order evidence |
| P31 | Postmarket explicit LMT entry and independently flagged STP LMT protection | Pass — same fail-closed rules as P30 | Blocked — no postmarket order evidence |
| P32 | Unsupported order/session combinations | Pass — extended MIDPRICE/STP and invalid duration are rejected before persistence/submission | Blocked — no broker rejection evidence required or induced |
| P33 | Partial entry at expiry | Pass — confirmed protected shares remain one campaign; remainder finalizes without automatic recreation | Blocked — no boundary fill/expiry observed |
| P34 | Stop-limit triggered but unfilled | Pass — distinct state retains exposure and never claims protection fill | Blocked — no actual stop-limit trigger |
| P35 | Inactive protection and disconnected automation | Pass — broker-held/currently eligible/inactive/unknown and offline application automation are distinct | Blocked — no actual session transition |
| P36 | Overnight protection boundary | Pass — OVERNIGHT and Overnight+Day remain planning-only with precise reasons | Blocked — no overnight order permitted |
| P37 | DST, holiday/early-close and overnight trade date | Pass — America/New_York schedule parsing uses broker windows; DST UTC shift, CLOSED omission, early expiry and separate broker trade date tested | Blocked — no actual special-session execution |
| P38 | Reconnect, duplicate callbacks and Position/Journal equality across a boundary | Pass — existing idempotent event/accounting and reconciliation tests apply without creating a new campaign at midnight | Blocked — no broker boundary/restart evidence |

Capability sources and installed-version evidence are recorded in `IBKR_SESSION_CAPABILITIES.md`. The revised RTH batch and deliberately separate session-extension batches are in `IBKR_PAPER_ACCEPTANCE_BATCH.md`.

The current single classification matrix for P01–P38 is [IBKR_PAPER_ACCEPTANCE_QC.md](IBKR_PAPER_ACCEPTANCE_QC.md). The machine-readable immutable tickets and selected-batch preflight/evidence workflow are [IBKR_PAPER_ACCEPTANCE_PACKAGE.json](IBKR_PAPER_ACCEPTANCE_PACKAGE.json) and [IBKR_PAPER_ACCEPTANCE_TOOLING.md](IBKR_PAPER_ACCEPTANCE_TOOLING.md).
